/**
 * Multi-bot Zello runtime — N accounts on one channel.
 * Only the listen-owner feeds AudioPipeline (shared STT).
 * Each bot speaks with its own WebSocket / TX lock.
 */
const { ZelloRuntimeService } = require('./zello-runtime-service');

class MultiBotRuntime {
  constructor(settingsStore, audioPipelineService) {
    this.settingsStore = settingsStore;
    this.audioPipelineService = audioPipelineService;
    /** @type {Map<string, ZelloRuntimeService>} */
    this.runtimes = new Map();
    this.listenOwnerId = '';
    /** @type {Map<string, Promise>} */
    this.txLocks = new Map();
    this.cutInAggressive = true;
    this.textMessageHandler = null;
    this.imageMessageHandler = null;
  }

  setCutInAggressive(enabled) {
    this.cutInAggressive = enabled !== false;
  }

  setTextMessageHandler(handler) {
    this.textMessageHandler =
      typeof handler === 'function' ? handler : null;
    this.wireListenOwnerText();
    this.wireListenOwnerImage();
  }

  setImageMessageHandler(handler) {
    this.imageMessageHandler =
      typeof handler === 'function' ? handler : null;
    this.wireListenOwnerImage();
  }

  wireListenOwnerText() {
    const owner = this.getRuntime(this.listenOwnerId);
    if (!owner || typeof owner.setTextMessageHandler !== 'function') {
      return;
    }
    owner.setTextMessageHandler((msg) => {
      if (typeof this.textMessageHandler === 'function') {
        return this.textMessageHandler(msg);
      }
    });
  }

  wireListenOwnerImage() {
    const owner = this.getRuntime(this.listenOwnerId);
    if (!owner || typeof owner.setImageMessageHandler !== 'function') {
      return;
    }
    owner.setImageMessageHandler((msg) => {
      if (typeof this.imageMessageHandler === 'function') {
        return this.imageMessageHandler(msg);
      }
    });
  }

  abortForeignTransmitters(from) {
    const settings = this.settingsStore.read();
    if (settings?.multiBot?.interruptReset === false) {
      return;
    }

    const peer =
      String(from || '').trim().toLowerCase();
    const ours = new Set(this.getBotUsernames());
    if (peer && ours.has(peer)) {
      return;
    }

    // Music: optional grace before a foreign key-up can cut us (default 0 = immediate).
    const musicStartedAt = Number(this._youtubeTxStartedAt) || 0;
    const graceMs = Math.max(
      0,
      Number(process.env.YOUTUBE_INTERRUPT_GRACE_MS) || 0
    );
    if (graceMs > 0 && musicStartedAt && Date.now() - musicStartedAt < graceMs) {
      return;
    }

    let aborted = false;
    for (const runtime of this.runtimes.values()) {
      if (runtime.getStatus().transmitting) {
        runtime.requestTxAbort();
        aborted = true;
      }
    }
    if (aborted && musicStartedAt) {
      this._youtubeTxStartedAt = 0;
    }
  }

  /** Called by voice-bot when YouTube audio TX starts/ends. */
  setYoutubeTxActive(active) {
    this._youtubeTxStartedAt = active ? Date.now() : 0;
  }

  wireListenOwnerInterrupt() {
    const handler = (from) => {
      this.abortForeignTransmitters(from);
    };
    // Wire every connected bot — whoever hears the channel key-up can abort TX
    for (const runtime of this.runtimes.values()) {
      if (typeof runtime.setForeignStreamStartHandler === 'function') {
        runtime.setForeignStreamStartHandler(handler);
      }
    }
  }

  readEnabledBots() {
    const settings = this.settingsStore.read();
    const primaryChannel =
      typeof settings?.zello?.channelName === 'string'
        ? settings.zello.channelName.trim()
        : '';
    const channelNames = Array.isArray(settings?.zello?.channelNames)
      ? settings.zello.channelNames
          .map((c) => String(c || '').trim())
          .filter(Boolean)
      : primaryChannel
        ? [primaryChannel]
        : [];
    const fallbackChannel = channelNames[0] || primaryChannel;

    let bots = Array.isArray(settings?.bots) ? settings.bots : [];

    // Back-compat: single zello.* account when bots[] empty
    if (!bots.length && settings?.zello?.botUsername) {
      bots = [
        {
          id: 'primary',
          enabled: true,
          canSpeak: true,
          username: settings.zello.botUsername,
          password: settings.zello.password || '',
          token: settings.zello.token || '',
          identityName: settings.ai?.identityName || settings.zello.botUsername,
          omnivoiceVoice: settings.speech?.omnivoiceVoice || '',
          channelName: fallbackChannel,
          behaviorMode: settings.ai?.behaviorMode || 'nice',
        },
      ];
    }

    const enabled = bots
      .filter((b) => b && b.enabled !== false && b.username && b.password && b.token)
      .map((b) => {
        const own =
          typeof b.channelName === 'string' ? b.channelName.trim() : '';
        return {
          ...b,
          resolvedChannel: own || fallbackChannel
        };
      });

    return {
      channelName: fallbackChannel,
      channelNames,
      bots: enabled
    };
  }

  getBotUsernames() {
    return this.readEnabledBots().bots.map((b) =>
      String(b.username || '').trim().toLowerCase()
    );
  }

  getRuntime(botId) {
    return this.runtimes.get(String(botId)) || null;
  }

  getStatus() {
    const bots = [];
    for (const [id, runtime] of this.runtimes) {
      const st = runtime.getStatus();
      bots.push({
        id,
        ...st,
      });
    }

    const connected = bots.filter((b) => b.status === 'connected').length;
    const transmitting = bots.some((b) => b.transmitting);
    const first = bots[0] || null;
    const owner =
      bots.find((b) => String(b.id) === String(this.listenOwnerId)) ||
      first;

    return {
      status:
        connected === 0
          ? first?.status || 'disconnected'
          : connected === bots.length
            ? 'connected'
            : 'partial',
      channelName: owner?.channelName || first?.channelName || '',
      botUsername: owner?.botUsername || first?.botUsername || '',
      channelStatus: owner?.channelStatus || first?.channelStatus || 'offline',
      usersOnline: owner?.usersOnline || first?.usersOnline || 0,
      transmitting,
      lastError: bots.map((b) => b.lastError).filter(Boolean).join('; '),
      lastEventAt: new Date().toISOString(),
      bots,
      connectedCount: connected,
      totalCount: bots.length,
      listenOwnerId: this.listenOwnerId,
      listenOwnerChannel: owner?.channelName || '',
      listenOwnerUsername: owner?.botUsername || '',
    };
  }

  async connect() {
    const { channelName, bots } = this.readEnabledBots();
    if (!channelName && !bots.some((b) => b.resolvedChannel)) {
      throw new Error('No active Zello channel is configured.');
    }
    if (!bots.length) {
      throw new Error('No enabled bots. Turn on at least one bot in the roster.');
    }
    const missingChannel = bots.find((b) => !b.resolvedChannel);
    if (missingChannel) {
      throw new Error(
        'Bot "' +
          (missingChannel.username || missingChannel.id) +
          '" has no channel. Pick channels on the Channel tab or assign one on Roster.'
      );
    }

    // Already connected with same roster → diff-sync instead of mass logout
    if (this.runtimes.size > 0) {
      await this.syncRosterConnections({ forceReconnectMismatch: true });
      const connected = [...this.runtimes.values()].filter(
        (r) => r.getStatus().status === 'connected'
      ).length;
      if (connected > 0) {
        return this.getStatus();
      }
    }

    await this.disconnect();

    this.listenOwnerId = String(bots[0].id);
    const results = await this.connectBotBatch(bots, channelName);

    const okCount = results.filter((r) => r.ok).length;
    if (okCount === 0) {
      throw new Error(
        'No bots connected. ' +
          results.map((r) => `${r.username}: ${r.error || 'failed'}`).join(' | ')
      );
    }

    // If listen owner failed, reassign pipeline to first connected
    if (!results.find((r) => r.id === this.listenOwnerId && r.ok)) {
      const firstOk = results.find((r) => r.ok);
      if (firstOk) {
        await this.promoteListenOwner(firstOk.id, true);
      }
    }

    this.wireListenOwnerInterrupt();
    this.wireListenOwnerText();
    this.wireListenOwnerImage();

    return this.getStatus();
  }

  async connectBotBatch(bots, channelName) {
    const results = [];
    const BATCH = 4;
    for (let i = 0; i < bots.length; i += BATCH) {
      const chunk = bots.slice(i, i + BATCH);
      const chunkResults = await Promise.all(
        chunk.map(async (bot) => {
          const id = String(bot.id);
          const isOwner = id === this.listenOwnerId;
          const runtime = new ZelloRuntimeService(
            this.settingsStore,
            isOwner ? this.audioPipelineService : null
          );

          this.runtimes.set(id, runtime);
          const botChannel = bot.resolvedChannel || channelName;

          try {
            await runtime.connect({
              channelName: botChannel,
              botUsername: bot.username,
              password: bot.password,
              token: bot.token
            });
            return {
              id,
              ok: true,
              username: bot.username,
              channelName: botChannel
            };
          } catch (err) {
            if (runtime && typeof runtime.failConnection === 'function') {
              try {
                runtime.failConnection(err?.message || String(err));
              } catch {
                /* ignore */
              }
            } else if (runtime && runtime.state) {
              runtime.state.status = 'error';
              runtime.state.lastError = err?.message || String(err);
              runtime.state.channelName = botChannel;
            }
            return {
              id,
              ok: false,
              username: bot.username,
              channelName: botChannel,
              error: err?.message || String(err)
            };
          }
        })
      );
      results.push(...chunkResults);
    }
    return results;
  }

  /**
   * Attach audio pipeline to an existing (or freshly reconnected) bot
   * so STT / interrupt / text keep working after Join handoff.
   */
  async promoteListenOwner(botId, reconnectIfNeeded = false) {
    const id = String(botId || '');
    if (!id || !this.runtimes.has(id)) {
      return;
    }

    for (const [oid, rt] of this.runtimes) {
      if (oid !== id && rt) {
        rt.audioPipelineService = null;
      }
    }

    let runtime = this.runtimes.get(id);
    const st = runtime.getStatus();
    const needsReconnect =
      reconnectIfNeeded ||
      st.status !== 'connected' ||
      !runtime.audioPipelineService;

    if (needsReconnect && reconnectIfNeeded) {
      const { channelName, bots } = this.readEnabledBots();
      const bot = bots.find((b) => String(b.id) === id);
      if (bot) {
        try {
          await runtime.disconnect();
        } catch {
          /* ignore */
        }
        runtime = new ZelloRuntimeService(
          this.settingsStore,
          this.audioPipelineService
        );
        this.runtimes.set(id, runtime);
        await runtime.connect({
          channelName: bot.resolvedChannel || channelName,
          botUsername: bot.username,
          password: bot.password,
          token: bot.token
        });
      }
    } else {
      runtime.audioPipelineService = this.audioPipelineService;
    }

    this.listenOwnerId = id;
    this.wireListenOwnerInterrupt();
    this.wireListenOwnerText();
    this.wireListenOwnerImage();
  }

  async disconnect() {
    const all = [...this.runtimes.values()];
    await Promise.all(
      all.map(async (runtime) => {
        try {
          await runtime.disconnect();
        } catch {
          /* ignore */
        }
      })
    );
    this.runtimes.clear();
    this.listenOwnerId = '';
    this.txLocks.clear();
    return this.getStatus();
  }

  assertBotMayTransmit(bot, botId, options = {}) {
    if (!bot) return;
    if (bot.enabled === false) {
      throw new Error(
        `Bot ${bot.identityName || bot.username || botId} has Join off.`
      );
    }
    // Manual Speak-as from Live bypasses Speak/Name (listen-only roster)
    if (options && options.manual === true) {
      return;
    }
    const mayTx =
      bot.canSpeak !== false || bot.calledByName === true;
    if (!mayTx) {
      throw new Error(
        `Bot ${bot.identityName || bot.username || botId} has Speak and Name-call off.`
      );
    }
  }

  /**
   * Hot-apply Join / channel / credential changes while connected.
   * Speak / Name alone should not call this (handled in main).
   */
  async syncRosterConnections(options = {}) {
    if (!this.runtimes.size) {
      return this.getStatus();
    }

    const { channelName, bots } = this.readEnabledBots();
    const wanted = new Map(bots.map((b) => [String(b.id), b]));
    const force = options.forceReconnectMismatch === true;

    // Drop Join-off bots in parallel
    const toDrop = [...this.runtimes.entries()].filter(
      ([id]) => !wanted.has(id)
    );
    await Promise.all(
      toDrop.map(async ([id, runtime]) => {
        try {
          await runtime.disconnect();
        } catch {
          /* ignore */
        }
        this.runtimes.delete(id);
        this.txLocks.delete(id);
        if (this.listenOwnerId === id) {
          this.listenOwnerId = '';
        }
      })
    );

    // Reconnect bots whose channel/credentials changed
    const toReconnect = [];
    for (const [id, runtime] of [...this.runtimes.entries()]) {
      const bot = wanted.get(id);
      if (!bot) continue;
      const st = runtime.getStatus() || {};
      const channelMismatch =
        String(st.channelName || '') !==
        String(bot.resolvedChannel || channelName || '');
      const userMismatch =
        String(st.botUsername || '').toLowerCase() !==
        String(bot.username || '').toLowerCase();
      const dead = st.status !== 'connected' && st.status !== 'connecting';
      if (force && (channelMismatch || userMismatch || dead)) {
        toReconnect.push(bot);
        try {
          await runtime.disconnect();
        } catch {
          /* ignore */
        }
        this.runtimes.delete(id);
        this.txLocks.delete(id);
        if (this.listenOwnerId === id) {
          this.listenOwnerId = '';
        }
      } else if (channelMismatch || userMismatch) {
        toReconnect.push(bot);
        try {
          await runtime.disconnect();
        } catch {
          /* ignore */
        }
        this.runtimes.delete(id);
        this.txLocks.delete(id);
        if (this.listenOwnerId === id) {
          this.listenOwnerId = '';
        }
      }
    }

    // Connect newly Join-checked + reconnected bots in batches
    const toAdd = [
      ...bots.filter((b) => !this.runtimes.has(String(b.id))),
      ...toReconnect.filter((b) => !this.runtimes.has(String(b.id)))
    ];
    // Dedupe by id
    const addMap = new Map();
    for (const b of toAdd) {
      addMap.set(String(b.id), b);
    }
    const addList = [...addMap.values()];

    const BATCH = 4;
    // Assign listen owner synchronously before parallel connects
    if (!this.listenOwnerId && addList.length) {
      this.listenOwnerId = String(addList[0].id);
    }
    for (let i = 0; i < addList.length; i += BATCH) {
      const chunk = addList.slice(i, i + BATCH);
      await Promise.all(
        chunk.map(async (bot) => {
          const id = String(bot.id);
          const botChannel = bot.resolvedChannel || channelName;
          if (!botChannel) return;
          const isOwner = id === this.listenOwnerId;
          const runtime = new ZelloRuntimeService(
            this.settingsStore,
            isOwner ? this.audioPipelineService : null
          );
          this.runtimes.set(id, runtime);
          try {
            await runtime.connect({
              channelName: botChannel,
              botUsername: bot.username,
              password: bot.password,
              token: bot.token
            });
            if (isOwner) {
              this.wireListenOwnerInterrupt();
              this.wireListenOwnerText();
              this.wireListenOwnerImage();
            }
          } catch (err) {
            if (runtime && typeof runtime.failConnection === 'function') {
              try {
                runtime.failConnection(err?.message || String(err));
              } catch {
                /* ignore */
              }
            }
          }
        })
      );
    }

    // Promote listen owner if missing / dropped
    if (
      this.listenOwnerId &&
      !this.runtimes.has(this.listenOwnerId)
    ) {
      this.listenOwnerId = '';
    }
    if (!this.listenOwnerId && this.runtimes.size) {
      // Prefer a connected runtime
      let pick =
        [...this.runtimes.entries()].find(
          ([, r]) => r.getStatus().status === 'connected'
        )?.[0] || [...this.runtimes.keys()][0];
      if (pick) {
        await this.promoteListenOwner(pick, true);
      }
    } else if (this.listenOwnerId) {
      // Ensure owner still has the pipeline wired
      const owner = this.runtimes.get(this.listenOwnerId);
      if (owner && !owner.audioPipelineService) {
        await this.promoteListenOwner(this.listenOwnerId, false);
      } else {
        this.wireListenOwnerInterrupt();
        this.wireListenOwnerText();
        this.wireListenOwnerImage();
      }
    }

    return this.getStatus();
  }

  /** Back-compat for VoiceBotService single-bot calls */
  async sendPcmAudio(pcm) {
    const owner =
      this.getRuntime(this.listenOwnerId) ||
      [...this.runtimes.values()][0];
    if (!owner) {
      throw new Error('No connected bot to transmit.');
    }
    return owner.sendPcmAudio(pcm);
  }

  async sendPcmAs(botId, pcm, options = {}) {
    const settings = this.settingsStore.read();
    const bot = (Array.isArray(settings.bots) ? settings.bots : []).find(
      (b) => String(b.id) === String(botId)
    );
    this.assertBotMayTransmit(bot, botId, options);

    const runtime = this.getRuntime(String(botId));
    if (!runtime) {
      throw new Error(`Bot ${botId} is not connected.`);
    }
    return this.withTransmitLock(String(botId), () =>
      runtime.sendPcmAudio(pcm)
    );
  }

  async sendImageAs(botId, imageOpts = {}) {
    const settings = this.settingsStore.read();
    const bot = (Array.isArray(settings.bots) ? settings.bots : []).find(
      (b) => String(b.id) === String(botId)
    );
    this.assertBotMayTransmit(bot, botId, { manual: true });

    const runtime = this.getRuntime(String(botId));
    if (!runtime || typeof runtime.sendImage !== 'function') {
      throw new Error(`Bot ${botId} cannot send images.`);
    }
    return this.withTransmitLock(String(botId), () =>
      runtime.sendImage(imageOpts)
    );
  }

  async sendImage(imageOpts = {}) {
    const owner =
      this.getRuntime(this.listenOwnerId) ||
      [...this.runtimes.values()][0];
    if (!owner || typeof owner.sendImage !== 'function') {
      throw new Error('No connected bot to send images.');
    }
    return owner.sendImage(imageOpts);
  }

  async sendTextAs(botId, text, options = {}) {
    const settings = this.settingsStore.read();
    const bot = (Array.isArray(settings.bots) ? settings.bots : []).find(
      (b) => String(b.id) === String(botId)
    );
    this.assertBotMayTransmit(bot, botId, { manual: true });
    const runtime = this.getRuntime(String(botId));
    if (!runtime || typeof runtime.sendText !== 'function') {
      throw new Error(`Bot ${botId} cannot send text.`);
    }
    return runtime.sendText(text, options);
  }

  async sendText(text, options = {}) {
    const owner =
      this.getRuntime(this.listenOwnerId) ||
      [...this.runtimes.values()][0];
    if (!owner || typeof owner.sendText !== 'function') {
      throw new Error('No connected bot to send text.');
    }
    return owner.sendText(text, options);
  }

  /**
   * Key up as soon as the channel is free; hold with silence while
   * producePcm() finishes STT/LLM/TTS, then send real speech.
   */
  async seizeAndSpeak(botId, producePcm, options = {}) {
    const settings = this.settingsStore.read();
    const bot = (Array.isArray(settings.bots) ? settings.bots : []).find(
      (b) => String(b.id) === String(botId)
    );
    this.assertBotMayTransmit(bot, botId);

    const runtime = this.getRuntime(String(botId));
    if (!runtime) {
      throw new Error(`Bot ${botId} is not connected.`);
    }

    // Build FULLY outside the TX lock so picture/play/ack can sendImage/sendPcm
    // without deadlocking against this same lock.
    const pcm = await Promise.resolve().then(() => producePcm());
    if (pcm && pcm.commandHandled) {
      return { ok: true, commandHandled: true, framesSent: 0 };
    }
    if (!Buffer.isBuffer(pcm) || !pcm.length) {
      throw new Error('No speech audio was produced.');
    }

    return this.withTransmitLock(String(botId), async () => {
      const live = this.settingsStore.read();
      const liveBot = (Array.isArray(live.bots) ? live.bots : []).find(
        (b) => String(b.id) === String(botId)
      );
      this.assertBotMayTransmit(liveBot, botId);
      return runtime.sendPcmAudio(pcm);
    });
  }

  async withTransmitLock(botId, fn) {
    const prev = this.txLocks.get(botId) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    this.txLocks.set(
      botId,
      prev.then(() => gate).catch(() => gate)
    );
    await prev.catch(() => {});
    try {
      // Race hard for the free gap after key-up
      const waitMs = this.cutInAggressive ? 20000 : 45000;
      const pollMs = this.cutInAggressive ? 40 : 100;
      await this.waitChannelClear(waitMs, pollMs);
      return await fn();
    } finally {
      release();
    }
  }

  async waitChannelClear(timeoutMs, pollMs = 200) {
    const start = Date.now();
    const poll = Math.max(20, Number(pollMs) || 200);
    while (Date.now() - start < timeoutMs) {
      let busy = false;
      for (const runtime of this.runtimes.values()) {
        if (runtime.getStatus().transmitting) {
          busy = true;
          break;
        }
      }
      if (
        !busy &&
        this.audioPipelineService &&
        typeof this.audioPipelineService.isRemoteChannelBusy ===
          'function' &&
        this.audioPipelineService.isRemoteChannelBusy()
      ) {
        busy = true;
      }
      if (!busy) return;
      await new Promise((r) => setTimeout(r, poll));
    }
  }

  isAnyTransmitting() {
    for (const runtime of this.runtimes.values()) {
      if (runtime.getStatus().transmitting) return true;
    }
    return false;
  }
}

module.exports = { MultiBotRuntime };
