/**
 * Multi-bot Zello runtime — N accounts on one channel.
 * Only the listen-owner feeds AudioPipeline (shared STT).
 * Each bot speaks with its own WebSocket / TX lock.
 */
const { ZelloRuntimeService } = require('./zello-runtime-service');

const GRAB_ONLY_HOLD_MS = 1500;

// Continuous floor hold (grab-only): keep taking the channel so nobody else can.
const FLOOR_HOLD_MS = 50000; // hold each outgoing stream this long, then refresh (keep under Zello's cap)
const FLOOR_REGRAB_GAP_MS = 15; // how fast to re-try taking the button when we don't hold it (lower = more aggressive)
const FLOOR_WIN_INFLIGHT = 4; // parallel start_stream attempts while racing others for the button
// Back off when Zello pushes back (flood / rate-limit style refusals) so the account isn't kicked
const FLOOR_BACKOFF_MIN_MS = 300;
const FLOOR_BACKOFF_MAX_MS = 5000;
const FLOOR_RATE_LIMIT_RE = /flood|rate|too many|limit|throttl|spam|slow down|banned|blocked|kick/i;
const FLOOR_ERROR_LOG_EVERY_MS = 30000;
// DJ: a refresh waits this long at most for a talkover line to finish
const DJ_REFRESH_DEFER_MS = 5000;

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
    /** @type {Map<string, { release: boolean }>} bots holding the button in grab mode */
    this.grabHolds = new Map();
    /** @type {Set<Function>} waitChannelClear sleepers, woken on a remote key-release */
    this.channelWakers = new Set();
    this.preGrab = null;
    this.textMessageHandler = null;
    this.imageMessageHandler = null;
    /**
     * Continuous floor hold loop (one at a time): 'grab' = Grab: ONLY with any
     * bot; 'constant' = Constant requests with one chosen bot, no fallback.
     */
    this.floor = null;
    /** The stream the floor loop currently holds ({ runtime, bot, streamId }) */
    this.floorHold = null;
    /** Who last keyed us off ({ from, at }) — to log how long they really talked */
    this.floorKeyOff = null;
    this.floorBackoff = { ms: 0, until: 0 };
    /** @type {Map<string, { count: number, loggedAt: number }>} */
    this.floorErrorSeen = new Map();
  }

  get grabFloorActive() {
    return Boolean(this.floor && this.floor.active && this.floor.kind === 'grab');
  }

  /** Any floor loop (Grab: ONLY or Constant requests) is running. */
  get floorActive() {
    return Boolean(this.floor && this.floor.active);
  }

  /**
   * Constant requests' / DJ mode's chosen bot (lowercase username) — its
   * streams are our own hold, not traffic.
   */
  constantHolderUsername() {
    const f = this.floor;
    if (!f || !f.active || (f.kind !== 'constant' && f.kind !== 'dj')) return '';
    const rt = this.getRuntime(f.botId);
    return String(rt?.getStatus().botUsername || f.username || '')
      .trim()
      .toLowerCase();
  }

  /** The runtime Constant requests / DJ mode is holding right now (ignored by busy checks). */
  constantHoldRuntime() {
    const f = this.floor;
    if (!f || !f.active || (f.kind !== 'constant' && f.kind !== 'dj')) return null;
    return this.floorHold ? this.floorHold.runtime : null;
  }

  get djActive() {
    return Boolean(this.floor && this.floor.active && this.floor.kind === 'dj');
  }

  /** DJ engine when DJ mode is on for this bot — its transmits go through the mixer. */
  djEngineFor(botId) {
    const f = this.floor;
    if (!this.djActive || !f.dj?.engine || String(botId) !== f.botId) return null;
    return f.dj.engine;
  }

  /** DJ engine while DJ mode is on (any bot), else null. */
  getDjEngine() {
    return this.djActive ? this.floor.dj?.engine || null : null;
  }

  /** True for the DJ bot's own stream (also a few seconds after DJ off). */
  isDjSpeaker(from) {
    const who = String(from || '').trim().toLowerCase();
    if (!who) return false;
    if (this.djActive && who === this.constantHolderUsername()) return true;
    const last = this.lastDj;
    return Boolean(last && last.username === who && Date.now() - last.at < 8000);
  }

  getDjStatus() {
    const f = this.floor;
    if (!this.djActive) return { on: false, state: 'off' };
    return {
      on: true,
      botId: f.botId,
      botName: f.botName,
      state: f.state,
      sampleRate: f.dj?.sampleRate || 16000,
      onAirSince: f.dj?.onAirSince || 0,
      refreshes: f.dj?.refreshes || 0,
      keyOffs: f.dj?.keyOffs || 0
    };
  }

  /**
   * DJ mode: the chosen bot holds the channel continuously and streams
   * engine.frame() (music + talkover) into it; refreshes the stream before
   * Zello's length cap and grabs the button back when keyed off.
   * Replaces any Constant-requests / Grab floor until stopDj().
   */
  async startDj(options = {}) {
    if (this.isAnonymousListen()) {
      throw new Error(
        'Anonymous listen mode cannot transmit. Turn it off on Live and reconnect.'
      );
    }
    const botId = String(options.botId ?? '').trim();
    if (!botId) throw new Error('Pick a bot for DJ mode first.');
    const engine = options.engine;
    if (!engine || typeof engine.frame !== 'function') {
      throw new Error('DJ mixer is not ready.');
    }
    while (this.floor) {
      await this.stopFloor();
    }
    const sampleRate = Number(options.sampleRate) || 16000;
    const refreshMs = Math.min(85000, Math.max(10000, Number(options.refreshMs) || FLOOR_HOLD_MS));
    this.startFloor({
      kind: 'dj',
      botId,
      extra: {
        log: typeof options.log === 'function' ? options.log : null,
        startOptions: { sampleRate },
        dj: {
          engine,
          sampleRate,
          bitrate: Number(options.bitrate) || 0,
          refreshMs,
          onAirSince: 0,
          refreshes: 0,
          keyOffs: 0
        }
      }
    });
    return this.getDjStatus();
  }

  async stopDj() {
    const f = this.floor;
    if (f && f.kind === 'dj') {
      this.lastDj = { username: this.constantHolderUsername(), at: Date.now() };
      await this.stopFloor();
    }
    // Constant requests was on before DJ mode — pick it back up
    if (this.constantWanted && !this.floor) {
      this.startFloor({ kind: 'constant', botId: this.constantWanted });
    }
    this.syncGrabFloor();
    return this.getDjStatus();
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
    if (
      settings?.multiBot?.interruptReset === false ||
      settings?.multiBot?.grabMode === true
    ) {
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
    // Constant requests' own key-off detection handles its hold
    const constantHold = this.constantHoldRuntime();
    for (const runtime of this.runtimes.values()) {
      if (runtime === constantHold) continue;
      if (runtime.getStatus().transmitting) {
        runtime.requestTxAbort();
        aborted = true;
      }
    }
    if (aborted && musicStartedAt) {
      this._youtubeTxStartedAt = 0;
    }
  }

  /** Explicit "stop": cut every bot that is currently transmitting (DJ mode keeps its stream). */
  abortAllTx() {
    const djHold = this.djActive ? this.constantHoldRuntime() : null;
    for (const runtime of this.runtimes.values()) {
      if (runtime === djHold) continue;
      if (runtime.getStatus().transmitting) runtime.requestTxAbort();
    }
    this.getDjEngine()?.cancelBotVoices?.();
    this._youtubeTxStartedAt = 0;
  }

  /** Called by voice-bot when YouTube audio TX starts/ends. */
  setYoutubeTxActive(active) {
    this._youtubeTxStartedAt = active ? Date.now() : 0;
  }

  wireListenOwnerInterrupt() {
    // Wire every connected bot — whoever hears the channel key-up can abort TX
    for (const [id, runtime] of this.runtimes) {
      if (typeof runtime.setForeignStreamStartHandler === 'function') {
        runtime.setForeignStreamStartHandler((from, channel) => {
          this.abortForeignTransmitters(from);
          if (String(id) === String(this.listenOwnerId)) {
            this.onForeignStreamStart(from, channel);
          }
        });
      }
      if (typeof runtime.setForeignStreamStopHandler === 'function') {
        runtime.setForeignStreamStopHandler((info) => {
          if (String(id) === String(this.listenOwnerId)) {
            this.onForeignStreamStop(info);
          }
        });
      }
    }
  }

  setGrabLogger(fn) {
    this.grabLogger = typeof fn === 'function' ? fn : null;
  }

  grabLog(message) {
    try {
      if (this.grabLogger) this.grabLogger(message);
    } catch {
      /* ignore */
    }
  }

  /** Grab-mode settings, or null when grab mode is off / speaker is our own bot. */
  readGrabSettings(from) {
    let settings;
    const now = Date.now();
    if (this._grabSettingsCache && now - this._grabSettingsCache.at < 200) {
      settings = this._grabSettingsCache.settings;
    } else {
      try {
        settings = this.settingsStore.read();
      } catch {
        return null;
      }
      this._grabSettingsCache = { at: now, settings };
    }
    const grabOnly = settings?.multiBot?.grabOnly === true;
    if (
      settings?.multiBot?.grabMode !== true ||
      (!grabOnly && settings?.ai?.autoReply === false)
    ) {
      return null;
    }
    const bots = Array.isArray(settings.bots) ? settings.bots : [];
    if (from !== undefined) {
      const who = String(from || '').trim().toLowerCase();
      if (
        !who ||
        bots.some((b) => String(b?.username || '').trim().toLowerCase() === who)
      ) {
        return null;
      }
    }
    return { settings, bots, grabOnly };
  }

  /** Someone else keyed up → keep requesting the button until it frees. */
  onForeignStreamStart(from, channel) {
    // Floor loop: someone keyed up over our hold → drop it and race straight back
    if (this.floorActive) {
      const hold = this.floorHold;
      const who = String(from || '').trim();
      const holder = String(hold?.runtime?.getStatus?.().botUsername || '')
        .trim()
        .toLowerCase();
      if (
        hold &&
        who &&
        who.toLowerCase() !== holder &&
        typeof hold.runtime.markFloorLost === 'function'
      ) {
        hold.runtime.markFloorLost({ reason: 'foreign-start', from: who });
      }
      return;
    }
    if (!this.readGrabSettings(from)) return;
    // After this tick the pipeline has registered the stream as busy
    queueMicrotask(() => this.startHammer(channel));
  }

  /**
   * Someone just let go → (re)start the hammer in this same tick, before
   * decode/STT. The reply pipeline claims the hold via seizeAndSpeak;
   * unclaimed holds are dropped by releaseUnclaimedPreGrab().
   */
  onForeignStreamStop(info) {
    for (const wake of [...this.channelWakers]) wake();
    if (this.floorActive) {
      const ko = this.floorKeyOff;
      const who = String(info?.from || '').trim();
      if (ko && who && who.toLowerCase() === ko.from.toLowerCase()) {
        this.floorKeyOff = null;
        this.grabLog(
          who + ' let go ' + (Date.now() - ko.at) + ' ms after keying us off.'
        );
      }
      return;
    }
    if (!this.readGrabSettings(info?.from)) return;
    this.lastForeignStopAt = Date.now();
    if (this.hammer) this.hammer.poke();
    else this.startHammer(info?.channel);
  }

  /**
   * Fire start_stream over and over — a new request every ~15ms, up to
   * HAMMER_IN_FLIGHT at once — while someone else holds the channel, it just
   * freed, or a reply is waiting. First accepted stream becomes the pre-grab
   * hold; any later acceptance is stopped straight away.
   */
  startHammer(channel) {
    if (this.hammer) return;
    const HAMMER_IN_FLIGHT = 3;
    const HAMMER_GAP_MS = 15;
    const h = { attempts: 0, won: false, burst: false };
    h.poke = () => {
      h.burst = true;
      if (wake) wake();
    };
    this.hammer = h;
    const startedAt = Date.now();
    const inFlight = new Set();
    let wake = null;
    const nap = (ms) =>
      new Promise((resolve) => {
        const t = setTimeout(done, ms);
        function done() {
          clearTimeout(t);
          wake = null;
          resolve();
        }
        wake = done;
      });

    (async () => {
      while (!h.won && Date.now() - startedAt < 120000) {
        const grab = this.readGrabSettings();
        if (!grab) break;
        if (this.preGrab && !this.preGrab.failed) break;

        const remoteBusy =
          typeof this.audioPipelineService?.isRemoteChannelBusy === 'function' &&
          this.audioPipelineService.isRemoteChannelBusy();
        const justFreed = Date.now() - (this.lastForeignStopAt || 0) < 1500;
        if (!remoteBusy && !justFreed && !this.grabHolds.size) break;

        // Our own bot is talking — nothing to fight for yet
        if (this.isAnyTransmitting({ ignoreConstantHold: true })) {
          await nap(5);
          continue;
        }

        const pick = this.pickGrabBot(grab.bots, channel);
        if (!pick || typeof pick.runtime.requestStartStream !== 'function') break;

        if (inFlight.size < HAMMER_IN_FLIGHT || h.burst) {
          h.burst = false;
          if (h.attempts === 0) {
            this.grabLog(
              'Hammering for the button as ' +
                (pick.bot.identityName || pick.bot.username) +
                '…'
            );
          }
          h.attempts += 1;
          const req = pick.runtime
            .requestStartStream()
            .then(
              (streamId) => {
                const stillWanted =
                  this.grabHolds.size > 0 ||
                  Date.now() - (this.lastForeignStopAt || 0) < 1500 ||
                  (typeof this.audioPipelineService?.isRemoteChannelBusy === 'function' &&
                    this.audioPipelineService.isRemoteChannelBusy());
                if (
                  h.won ||
                  !stillWanted ||
                  (this.preGrab && !this.preGrab.failed)
                ) {
                  pick.runtime.releaseStreamId(streamId);
                  return;
                }
                h.won = true;
                this.startPreGrab(
                  String(pick.bot.id),
                  pick.runtime,
                  streamId,
                  grab.grabOnly
                );
                const stopAt = this.lastForeignStopAt || 0;
                const sinceRelease =
                  stopAt && Date.now() - stopAt < 5000 ? Date.now() - stopAt : -1;
                this.grabLog(
                  'Got the button (' +
                    (pick.bot.identityName || pick.bot.username) +
                    ') after ' +
                    h.attempts +
                    (h.attempts === 1 ? ' try' : ' tries') +
                    (sinceRelease >= 0
                      ? ', ' + sinceRelease + ' ms after release.'
                      : '.')
                );
                if (wake) wake();
              },
              () => {}
            )
            .finally(() => {
              inFlight.delete(req);
            });
          inFlight.add(req);
        }
        await nap(HAMMER_GAP_MS);
      }
    })()
      .catch(() => {})
      .finally(() => {
        if (this.hammer === h) this.hammer = null;
      });
  }

  pickGrabBot(bots, channelName) {
    const channel = String(channelName || '').trim().toLowerCase();
    const candidates = [];
    for (const bot of bots) {
      if (!bot || bot.enabled === false) continue;
      const runtime = this.getRuntime(String(bot.id));
      if (!runtime || typeof runtime.sendPcmHoldingWhile !== 'function') continue;
      const st = runtime.getStatus();
      if (st.status !== 'connected') continue;
      const botChannel = String(st.channelName || '').trim().toLowerCase();
      if (channel && botChannel && botChannel !== channel) continue;
      candidates.push({ bot, runtime });
    }
    const freeTalk = candidates.filter((c) => c.bot.canSpeak !== false);
    const pool = freeTalk.length
      ? freeTalk
      : candidates.filter((c) => c.bot.calledByName === true);
    if (!pool.length) return null;

    // A reply already waiting decides the bot; else stick with the last one
    const waitingId = [...this.grabHolds.keys()][0] || '';
    const waiting = waitingId
      ? candidates.find((c) => String(c.bot.id) === waitingId)
      : null;
    const sticky = pool.find((c) => String(c.bot.id) === this.lastGrabBotId);
    const pick =
      waiting || sticky || pool[Math.floor(Math.random() * pool.length)];
    this.lastGrabBotId = String(pick.bot.id);
    return pick;
  }

  /** Hold a stream the hammer already won (silence until a reply claims it). */
  startPreGrab(botId, runtime, streamId, grabOnly = false) {
    let supply;
    const supplied = new Promise((resolve) => {
      supply = resolve;
    });
    const pg = {
      botId,
      claimed: false,
      release: false,
      failed: false,
      started: true,
      grabOnly,
      wonAt: Date.now(),
      supply: (fn) => supply(fn || null)
    };
    // Nobody claimed it (stream ignored / no reply) — let go.
    // Grab-only never gets a reply, so it only holds briefly.
    pg.timer = setTimeout(() => {
      if (!pg.claimed) pg.supply(null);
    }, grabOnly ? GRAB_ONLY_HOLD_MS : 6000);
    this.preGrab = pg;
    pg.done = runtime
      .sendPcmHoldingWhile(
        async () => {
          const fn = await supplied;
          return fn ? fn() : Buffer.alloc(0);
        },
        {
          streamId,
          holdSilence: true,
          maxHoldMs: 45000,
          shouldRelease: () => pg.release
        }
      )
      .then(
        (result) => ({ result }),
        (error) => {
          pg.failed = true;
          return { error };
        }
      )
      .finally(() => {
        clearTimeout(pg.timer);
        if (this.preGrab === pg) this.preGrab = null;
      });
  }

  getPreGrabBotId() {
    const pg = this.preGrab;
    return pg && !pg.claimed && !pg.failed ? pg.botId : '';
  }

  /** Drop a won-but-unused hold once the stream it was grabbed for is handled. */
  releaseUnclaimedPreGrab(streamStoppedAt) {
    const pg = this.preGrab;
    if (!pg || pg.claimed || !pg.started || pg.grabOnly) return;
    const stoppedAt = Number(streamStoppedAt) || 0;
    // Won after a later key-up than this stream — belongs to a newer message
    if (stoppedAt && pg.wonAt > stoppedAt + 2000) return;
    pg.supply(null);
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

    const anonymousListen = settings?.zello?.anonymousListen === true;

    // Back-compat: single zello.* account when bots[] empty
    if (
      !bots.length &&
      (settings?.zello?.botUsername ||
        (anonymousListen && settings?.zello?.token))
    ) {
      bots = [
        {
          id: 'primary',
          enabled: true,
          canSpeak: !anonymousListen,
          username: settings.zello.botUsername || '(anonymous)',
          password: settings.zello.password || '',
          token: settings.zello.token || '',
          identityName:
            settings.ai?.identityName ||
            settings.zello.botUsername ||
            'Anonymous',
          omnivoiceVoice: settings.speech?.omnivoiceVoice || '',
          channelName: fallbackChannel,
          behaviorMode: settings.ai?.behaviorMode || 'nice',
        },
      ];
    }

    const enabled = bots
      .filter((b) => {
        if (!b || b.enabled === false || !b.token) return false;
        // Anonymous F&F listen: JWT only — username/password optional
        if (anonymousListen) return true;
        return !!(b.username && b.password);
      })
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
      bots: enabled,
      anonymousListen
    };
  }

  isAnonymousListen() {
    try {
      return this.settingsStore.read()?.zello?.anonymousListen === true;
    } catch {
      return false;
    }
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
      anonymousListen: this.isAnonymousListen(),
      constantRequests: this.getConstantRequestsStatus(),
      dj: this.getDjStatus(),
    };
  }

  async connect() {
    const { channelName, bots, anonymousListen } = this.readEnabledBots();
    if (!channelName && !bots.some((b) => b.resolvedChannel)) {
      throw new Error('No active Zello channel is configured.');
    }
    if (!bots.length) {
      throw new Error(
        anonymousListen
          ? 'No enabled bots with a JWT token. Anonymous listen needs at least one token.'
          : 'No enabled bots. Turn on at least one bot in the roster.'
      );
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
    this.syncGrabFloor();

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
              token: bot.token,
              anonymousListen: this.isAnonymousListen()
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
          token: bot.token,
          anonymousListen: this.isAnonymousListen()
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
    // Constant requests stays ON and shows its bot offline until it reconnects
    if (this.grabFloorActive) this.stopFloor();
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
              token: bot.token,
              anonymousListen: this.isAnonymousListen()
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

    this.syncGrabFloor();
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
    const ownerId =
      [...this.runtimes.entries()].find(([, r]) => r === owner)?.[0] || '';
    const dj = this.djEngineFor(ownerId);
    if (dj) return dj.playVoice(pcm, { source: 'Bot reply' });
    const resume = await this.pauseFloorFor(ownerId);
    try {
      return await owner.sendPcmAudio(pcm, { fastStop: Boolean(resume) });
    } finally {
      if (resume) resume();
    }
  }

  async sendPcmAs(botId, pcm, options = {}) {
    const settings = this.settingsStore.read();
    const bot = (Array.isArray(settings.bots) ? settings.bots : []).find(
      (b) => String(b.id) === String(botId)
    );
    this.assertBotMayTransmit(bot, botId, options);

    // DJ mode on this bot: mix it over the music instead of fighting for the button
    const dj = this.djEngineFor(botId);
    if (dj) {
      return dj.playVoice(pcm, { source: options.manual ? 'Speak-as' : 'Bot reply' });
    }

    const runtime = this.getRuntime(String(botId));
    if (!runtime) {
      throw new Error(`Bot ${botId} is not connected.`);
    }
    // Handing back to a Constant-requests hold: its start_stream queues right behind our stop
    return this.withTransmitLock(
      String(botId),
      () => runtime.sendPcmAudio(pcm, { fastStop: this.floorYieldsTo(botId) }),
      { handoff: true }
    );
  }

  /** Push-to-talk (Voice Changer): fail fast when the floor is taken instead of queueing. */
  async liveTransmitAs(botId, feed, options = {}) {
    const settings = this.settingsStore.read();
    const bot = (Array.isArray(settings.bots) ? settings.bots : []).find(
      (b) => String(b.id) === String(botId)
    );
    this.assertBotMayTransmit(bot, botId, { manual: true });

    const dj = this.djEngineFor(botId);
    if (dj) return dj.playLiveVoice(feed, options);

    const runtime = this.getRuntime(String(botId));
    if (!runtime || typeof runtime.sendPcmLive !== 'function') {
      throw new Error(`Bot ${botId} is not connected.`);
    }
    if (runtime.getStatus().status !== 'connected') {
      throw new Error(`Bot ${bot?.identityName || botId} is not connected.`);
    }
    // Constant requests holding as this same bot hands the channel to the mic
    const resume = await this.pauseFloorFor(String(botId));
    try {
      if (this.isRemoteBusyForUs()) {
        throw new Error('Channel busy — someone else is talking.');
      }
      // Our own grab-mode silence hold gives way to the human at the mic
      const busyOpts = { ignoreConstantHold: true };
      if (this.isAnyTransmitting(busyOpts) && (this.preGrab || this.grabHolds.size)) {
        for (const hold of this.grabHolds.values()) hold.release = true;
        if (this.preGrab) {
          this.preGrab.release = true;
          this.preGrab.supply(null);
        }
        const until = Date.now() + 1000;
        while (this.isAnyTransmitting(busyOpts) && Date.now() < until) {
          await new Promise((r) => setTimeout(r, 20));
        }
      }
      if (this.isAnyTransmitting(busyOpts)) {
        throw new Error(
          this.grabFloorActive
            ? 'Channel busy — Grab only is holding the floor. Turn Grab off first.'
            : 'Channel busy — another bot is transmitting.'
        );
      }
      return await this.withTransmitLock(String(botId), () =>
        runtime.sendPcmLive(feed, options)
      );
    } finally {
      if (resume) resume();
    }
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

    if (this.djEngineFor(botId)) {
      const pcm = await Promise.resolve().then(() => producePcm());
      if (pcm && pcm.commandHandled) {
        return { ok: true, commandHandled: true, framesSent: 0 };
      }
      if (!Buffer.isBuffer(pcm) || !pcm.length) {
        throw new Error('No speech audio was produced.');
      }
      // DJ may have stopped while the reply was building
      const dj = this.djEngineFor(botId);
      if (dj) return dj.playVoice(pcm, { source: 'Bot reply' });
      return this.withTransmitLock(
        String(botId),
        () => this.getRuntime(String(botId)).sendPcmAudio(pcm, { fastStop: this.floorYieldsTo(botId) }),
        { handoff: true }
      );
    }

    const runtime = this.getRuntime(String(botId));
    if (!runtime) {
      throw new Error(`Bot ${botId} is not connected.`);
    }

    // Constant requests already holds the channel for this bot — speak via hand-off instead
    if (
      settings?.multiBot?.grabMode === true &&
      typeof runtime.sendPcmHoldingWhile === 'function' &&
      !this.floorYieldsTo(String(botId))
    ) {
      return this.grabAndSpeak(String(botId), runtime, producePcm, options);
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

    return this.withTransmitLock(
      String(botId),
      async () => {
        const live = this.settingsStore.read();
        const liveBot = (Array.isArray(live.bots) ? live.bots : []).find(
          (b) => String(b.id) === String(botId)
        );
        this.assertBotMayTransmit(liveBot, botId);
        return runtime.sendPcmAudio(pcm, { fastStop: this.floorYieldsTo(botId) });
      },
      { handoff: true }
    );
  }

  /**
   * Grab mode: the hammer keeps requesting the button for this bot; the
   * first accepted stream is held with silence while producePcm() builds
   * the reply. Runs outside the TX lock; any locked transmit releases the hold.
   */
  async grabAndSpeak(botId, runtime, producePcm, options = {}) {
    const hold = { release: false };
    this.grabHolds.set(botId, hold);

    let produced = null;
    const producing = Promise.resolve()
      .then(() => producePcm())
      .then(
        (value) => {
          produced = { value };
        },
        (error) => {
          produced = { error };
        }
      );
    const nothingToSay = () =>
      produced &&
      (produced.error ||
        (produced.value && produced.value.commandHandled));
    const producedPcm = async () => {
      await producing;
      if (produced.error) throw produced.error;
      const v = produced.value;
      return Buffer.isBuffer(v) ? v : Buffer.alloc(0);
    };

    let result = null;
    let done = false;
    try {
      const deadline = Date.now() + 60000;

      // A hammer/stop-event hold for this bot → speak through it; another bot's → drop it
      const claimPreGrab = async () => {
        const pg = this.preGrab;
        if (!pg || pg.claimed || pg.failed) return;
        if (pg.botId !== botId) {
          pg.release = true;
          pg.supply(null);
          return;
        }
        pg.claimed = true;
        clearTimeout(pg.timer);
        pg.supply(producedPcm);
        const out = await pg.done;
        if (!out.error) {
          result = out.result;
          done = true;
        } else if (produced && out.error === produced.error) {
          throw out.error;
        }
        // else start_stream was refused — keep hammering below
      };

      // The hammer fires start_stream for this bot until it wins; we speak through that hold
      while (!done && !nothingToSay() && Date.now() < deadline) {
        await claimPreGrab();
        if (done) break;
        if (hold.release) {
          throw new Error('Grab released for another transmit.');
        }
        if (
          !this.hammer &&
          !this.preGrab &&
          !this.isAnyTransmitting({ ignoreConstantHold: true })
        ) {
          this.startHammer(runtime.getStatus().channelName);
        }
        await new Promise((r) => setTimeout(r, 5));
      }

      await producing;
      if (produced.error) throw produced.error;
      const v = produced.value;
      if (v && v.commandHandled) {
        return { ok: true, commandHandled: true, framesSent: 0 };
      }
      if (!Buffer.isBuffer(v) || !v.length) {
        throw new Error('No speech audio was produced.');
      }
      if (!result) {
        throw new Error('channel busy — could not get the button in 60s');
      }
      return result;
    } finally {
      if (this.grabHolds.get(botId) === hold) this.grabHolds.delete(botId);
      // Nothing was spoken through it — don't leave a won button held
      const pg = this.preGrab;
      if (!done && pg && !pg.claimed && pg.botId === botId) pg.supply(null);
    }
  }

  /** options.handoff: pause a Constant-requests hold on this same bot while fn transmits. */
  async withTransmitLock(botId, fn, options = {}) {
    for (const hold of this.grabHolds.values()) hold.release = true;
    if (this.preGrab) {
      this.preGrab.release = true;
      this.preGrab.supply(null);
    }
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
      const resume = options.handoff ? await this.pauseFloorFor(botId) : null;
      try {
        return await fn();
      } finally {
        if (resume) resume();
      }
    } finally {
      release();
    }
  }

  async waitChannelClear(timeoutMs, pollMs = 200) {
    const start = Date.now();
    const poll = Math.max(20, Number(pollMs) || 200);
    while (Date.now() - start < timeoutMs) {
      // Our own Constant-requests hold isn't someone talking; Zello itself decides that clash
      const busy =
        this.isAnyTransmitting({ ignoreConstantHold: true }) ||
        this.isRemoteBusyForUs();
      if (!busy) return;
      await new Promise((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          this.channelWakers.delete(wake);
          resolve();
        };
        const timer = setTimeout(wake, poll);
        this.channelWakers.add(wake);
      });
    }
  }

  isAnyTransmitting(options = {}) {
    const skip = options.ignoreConstantHold ? this.constantHoldRuntime() : null;
    for (const runtime of this.runtimes.values()) {
      if (runtime === skip) continue;
      if (runtime.getStatus().transmitting) return true;
    }
    return false;
  }

  /** Someone keyed up on the channel — not counting Constant requests' own bot. */
  isRemoteBusyForUs() {
    const ap = this.audioPipelineService;
    if (!ap || typeof ap.isRemoteChannelBusy !== 'function') return false;
    if (!ap.isRemoteChannelBusy()) return false;
    const ignore = this.constantHolderUsername();
    if (!ignore) return true;
    const owner = this.getRuntime(this.listenOwnerId);
    const active = ap.activeStreams instanceof Map ? ap.activeStreams : new Map();
    const keyed = ap.remoteStillKeyed instanceof Set ? ap.remoteStillKeyed : new Set();
    for (const id of new Set([...active.keys(), ...keyed])) {
      const from =
        active.get(id)?.from || owner?.remoteStreamInfo?.get(id)?.from || '';
      if (String(from).trim().toLowerCase() !== ignore) return true;
    }
    return false;
  }

  /** Start/stop the Grab: ONLY floor loop to match settings (Constant requests takes priority). */
  syncGrabFloor() {
    if (this.isAnonymousListen()) {
      if (this.floor && this.floor.kind === 'grab') {
        this.stopFloor();
      }
      return;
    }
    // DJ mode owns the channel until it's switched off
    if (this.djActive) return;
    if (this.constantWanted) {
      if (this.grabFloorActive) this.stopFloor();
      return;
    }
    let want = false;
    try {
      const s = this.settingsStore.read();
      want =
        s?.multiBot?.grabMode === true &&
        s?.multiBot?.grabOnly === true &&
        this.runtimes.size > 0;
    } catch {
      want = false;
    }
    if (want && !this.floorActive) {
      this.startFloor({ kind: 'grab' });
    } else if (!want && this.grabFloorActive) {
      this.stopFloor();
    }
  }

  _napFloor(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _makeFloor(kind, botId) {
    const f = {
      kind,
      botId: botId ? String(botId) : '',
      botName: '',
      username: '',
      active: true,
      /** >0 while a transmit on the same bot borrows the channel */
      pauses: 0,
      inFlight: 0,
      winning: false,
      state: 'requesting',
      run: null,
      wakers: new Set()
    };
    f.sleep = (ms) =>
      new Promise((resolve) => {
        const done = () => {
          clearTimeout(timer);
          f.wakers.delete(done);
          resolve();
        };
        const timer = setTimeout(done, ms);
        f.wakers.add(done);
      });
    f.wake = () => {
      for (const done of [...f.wakers]) done();
    };
    return f;
  }

  startFloor({ kind, botId, extra } = {}) {
    if (this.floor && this.floor.active) return this.floor;
    const f = this._makeFloor(kind, botId);
    // Before runFloorLoop: its first start_stream goes out synchronously
    if (extra) Object.assign(f, extra);
    this.floor = f;
    this.floorBackoff = { ms: 0, until: 0 };
    f.run = this.runFloorLoop(f);
    return f;
  }

  /** Stop the floor loop: no more requests, the hold sends stop_stream on its next frame. */
  stopFloor() {
    const f = this.floor;
    if (!f || !f.active) return f?.run || Promise.resolve();
    f.active = false;
    f.wake();
    for (const wake of [...this.channelWakers]) {
      try {
        wake();
      } catch {
        /* ignore */
      }
    }
    return f.run || Promise.resolve();
  }

  /** Only Constant requests steps aside, and only for its own bot. */
  floorYieldsTo(botId) {
    const f = this.floor;
    return Boolean(
      f && f.active && f.kind === 'constant' && String(botId) === f.botId
    );
  }

  /**
   * Hand the channel from the silent hold to a real transmit on the same bot:
   * stop requesting, let go of the hold, and wait until it's gone.
   * Returns resume() (call when the transmit ends), or null when nothing to pause.
   */
  async pauseFloorFor(botId) {
    if (!this.floorYieldsTo(botId)) return null;
    const f = this.floor;
    if (f.pauses === 0 && f.state === 'holding') {
      this.grabLog(
        'Releasing the hold — ' + (f.botName || f.botId) + ' is transmitting; holding again right after.'
      );
    }
    f.pauses += 1;
    f.wake();
    let resumed = false;
    const resume = () => {
      if (resumed) return;
      resumed = true;
      f.pauses = Math.max(0, f.pauses - 1);
      if (f.pauses === 0) f.wake();
    };
    const until = Date.now() + 2000;
    while (
      Date.now() < until &&
      (this.floorHold || f.winning || f.inFlight > 0)
    ) {
      await this._napFloor(5);
    }
    return resume;
  }

  /** Bot to hold with: Constant requests = its chosen bot only; Grab: ONLY = any free bot. */
  pickFloorBot(f) {
    if (f.kind === 'constant' || f.kind === 'dj') {
      let bot = null;
      try {
        const bots = this.settingsStore.read()?.bots;
        bot = (Array.isArray(bots) ? bots : []).find(
          (b) => String(b?.id) === f.botId
        ) || null;
      } catch {
        bot = null;
      }
      if (bot) {
        f.botName = bot.identityName || bot.username || f.botId;
        f.username = String(bot.username || '');
      }
      const runtime = this.getRuntime(f.botId);
      if (
        !bot ||
        bot.enabled === false ||
        !runtime ||
        typeof runtime.requestStartStream !== 'function' ||
        runtime.getStatus().status !== 'connected'
      ) {
        return { offline: true };
      }
      return { bot, runtime };
    }
    const grab = this.readGrabSettings();
    if (!grab || !grab.grabOnly || !this.runtimes.size) return { stop: true };
    const pick = this.pickGrabBot(grab.bots, this.readEnabledBots().channelName);
    if (!pick || typeof pick.runtime.requestStartStream !== 'function') {
      return { offline: true };
    }
    return pick;
  }

  getConstantRequestsStatus() {
    let savedBotId = '';
    try {
      savedBotId = String(this.settingsStore.read()?.multiBot?.constantBotId || '');
    } catch {
      /* ignore */
    }
    const f = this.floor;
    if (this.constantWanted && this.djActive) {
      return { on: true, botId: this.constantWanted, botName: '', state: 'dj' };
    }
    if (!f || !f.active || f.kind !== 'constant') {
      return { on: false, botId: savedBotId, botName: '', state: 'off' };
    }
    return { on: true, botId: f.botId, botName: f.botName, state: f.state };
  }

  /** Live-tab toggle: one chosen bot requests the button non-stop and holds it silently. */
  async setConstantRequests(options = {}) {
    const enabled = options.enabled === true;
    const botId = String(options.botId ?? '').trim();
    if (!enabled) {
      this.constantWanted = '';
      if (this.floor && this.floor.kind === 'constant') await this.stopFloor();
      this.syncGrabFloor();
      return this.getConstantRequestsStatus();
    }
    if (this.isAnonymousListen()) {
      throw new Error(
        'Anonymous listen mode cannot transmit. Turn it off on Live and reconnect.'
      );
    }
    if (!botId) throw new Error('Pick a bot for Constant requests first.');
    this.constantWanted = botId;
    // DJ mode holds the channel; Constant requests resumes when DJ stops
    if (this.djActive) return this.getConstantRequestsStatus();
    while (
      this.floor &&
      !(
        this.floor.active &&
        this.floor.kind === 'constant' &&
        this.floor.botId === botId
      )
    ) {
      await this.stopFloor();
    }
    if (!this.floor) this.startFloor({ kind: 'constant', botId });
    return this.getConstantRequestsStatus();
  }

  /** How long to hold each outgoing stream before refreshing (settings override, else default). */
  grabHoldMs() {
    try {
      const sec = Number(this.settingsStore.read()?.multiBot?.grabHoldSec);
      if (Number.isFinite(sec) && sec >= 5 && sec <= 85) {
        return Math.round(sec * 1000);
      }
    } catch {
      /* ignore */
    }
    return FLOOR_HOLD_MS;
  }

  /** Log what Zello says when it refuses start_stream; back off on flood/rate-limit replies. */
  noteFloorError(error) {
    const text = String(error?.message || error || 'unknown error').slice(0, 200);
    const now = Date.now();
    if (FLOOR_RATE_LIMIT_RE.test(text)) {
      if (now < this.floorBackoff.until) return;
      const ms = Math.min(
        FLOOR_BACKOFF_MAX_MS,
        Math.max(FLOOR_BACKOFF_MIN_MS, this.floorBackoff.ms * 2)
      );
      this.floorBackoff = { ms, until: now + ms };
      this.grabLog('Zello pushed back ("' + text + '") — pausing requests ' + ms + ' ms.');
      return;
    }
    const seen = this.floorErrorSeen.get(text) || { count: 0, loggedAt: 0 };
    seen.count += 1;
    if (now - seen.loggedAt >= FLOOR_ERROR_LOG_EVERY_MS) {
      this.grabLog(
        'Zello refused the button: "' +
          text +
          '"' +
          (seen.loggedAt ? ' (x' + seen.count + ' in the last 30 s).' : '.')
      );
      seen.loggedAt = now;
      seen.count = 0;
    }
    this.floorErrorSeen.set(text, seen);
  }

  /**
   * Fire start_stream non-stop (one every FLOOR_REGRAB_GAP_MS, up to
   * FLOOR_WIN_INFLIGHT waiting on Zello) until one is accepted; resolves that
   * stream id, or null when the floor loop stops / pauses or the bot disconnects.
   * stats.tries counts requests sent.
   */
  winButton(runtime, f, stats = { tries: 0 }) {
    const wanted = () => f.active && f.pauses === 0 && this.floor === f;
    return new Promise((resolve) => {
      let settled = false;
      let inFlight = 0;
      const finish = (val) => {
        if (settled) return;
        settled = true;
        resolve(val);
      };
      const pump = () => {
        if (settled) return;
        if (!wanted()) return finish(null);
        // Let the loop re-pick a connected bot (reconnects create new runtimes)
        if (runtime.getStatus().status !== 'connected') return finish(null);
        // Don't fight our own transmit (e.g. a manual Speak-as)
        if (this.isAnyTransmitting()) {
          setTimeout(pump, 20);
          return;
        }
        const backoff = this.floorBackoff.until - Date.now();
        if (backoff > 0) {
          setTimeout(pump, Math.min(backoff, 250));
          return;
        }
        if (inFlight < FLOOR_WIN_INFLIGHT) {
          inFlight += 1;
          f.inFlight += 1;
          stats.tries += 1;
          runtime
            .requestStartStream(f.startOptions || {})
            .then(
              (streamId) => {
                if (settled || !wanted()) {
                  runtime.releaseStreamId(streamId);
                } else {
                  finish(streamId);
                }
              },
              (err) => {
                if (!settled) this.noteFloorError(err);
              }
            )
            .finally(() => {
              inFlight -= 1;
              f.inFlight -= 1;
            });
        }
        setTimeout(pump, FLOOR_REGRAB_GAP_MS);
      };
      pump();
    });
  }

  describeFloorLoss(lost) {
    if (lost.reason === 'foreign-start') {
      return 'Keyed off by ' + (lost.from || 'someone') + ' — re-grabbing…';
    }
    if (lost.reason === 'stream-stopped') {
      return 'Zello stopped our stream (on_stream_stop for our stream) — re-grabbing…';
    }
    if (lost.reason === 'disconnected') {
      return 'Connection dropped during the hold — re-grabbing once a bot is connected…';
    }
    if (lost.reason === 'channel-offline') {
      return 'Channel went offline during the hold ("' + (lost.error || '') + '") — re-grabbing…';
    }
    return 'Zello error during the hold: "' + (lost.error || lost.reason) + '" — re-grabbing…';
  }

  /**
   * DJ hold: stream the mixer into the won stream until the refresh is due
   * (deferred while a talkover is playing), DJ stops, or we're keyed off.
   */
  djHold(f, pick, streamId) {
    const dj = f.dj;
    const startedAt = Date.now();
    const refreshDue = () =>
      Date.now() - startedAt >= dj.refreshMs &&
      (!dj.engine.voiceBusy || Date.now() - startedAt >= dj.refreshMs + DJ_REFRESH_DEFER_MS);
    return pick.runtime.sendPcmLive(
      {
        take: () => dj.engine.frame(),
        isFinished: () => !f.active || this.floor !== f
      },
      {
        streamId,
        sampleRate: dj.sampleRate,
        music: true,
        bitrate: dj.bitrate,
        maxMs: dj.refreshMs + DJ_REFRESH_DEFER_MS + 2000,
        abortOnFloorLoss: true,
        fastStop: true,
        shouldRelease: () => !f.active || this.floor !== f || refreshDue()
      }
    );
  }

  /**
   * Hold the channel continuously: win the button, hold silence, refresh,
   * repeat; re-grab at once when keyed off. Shared by Grab: ONLY,
   * Constant requests and DJ mode (f.kind) — DJ streams the mixer instead of silence.
   */
  async runFloorLoop(f) {
    const djMode = f.kind === 'dj';
    const constant = f.kind === 'constant' || djMode;
    const log = (message) => (f.log ? f.log(message) : this.grabLog(message));
    if (djMode) {
      this.pickFloorBot(f);
      log('DJ mode ON — requesting the button as ' + (f.botName || f.botId) + '…');
    } else if (constant) {
      this.pickFloorBot(f);
      log('Constant requests ON as ' + (f.botName || f.botId) + '.');
    } else {
      log('Grab floor ON — holding the channel until you switch it off.');
    }
    let announceHold = true;
    let offline = false;
    /** Set while we're winning the button back after being cut off */
    let regain = null;
    /** DJ: set when we let go to refresh the stream */
    let refreshAt = 0;
    try {
      while (f.active && this.floor === f) {
        if (f.pauses > 0) {
          f.state = 'paused';
          announceHold = true;
          regain = null;
          await f.sleep(250);
          continue;
        }

        const pick = this.pickFloorBot(f);
        if (pick.stop) break;
        if (pick.offline) {
          f.state = 'offline';
          if (constant && !offline) {
            log(
              (f.botName || f.botId) +
                ' is offline — waiting for it to connect (no other bot will be used).'
            );
          }
          offline = true;
          refreshAt = 0;
          await f.sleep(300);
          continue;
        }
        if (constant && offline) {
          log((f.botName || f.botId) + ' is online — requesting the button.');
        }
        offline = false;
        f.state = 'requesting';

        const stats = { tries: 0 };
        let streamId = null;
        f.winning = true;
        try {
          streamId = await this.winButton(pick.runtime, f, stats);
        } finally {
          f.winning = false;
        }
        if (regain) regain.tries += stats.tries;
        if (streamId == null) {
          await f.sleep(FLOOR_REGRAB_GAP_MS);
          continue;
        }
        this.floorBackoff.ms = 0;

        const botName = pick.bot.identityName || pick.bot.username;
        if (regain) {
          log(
            'Got the button back (' +
              botName +
              ') after ' +
              regain.tries +
              (regain.tries === 1 ? ' try, ' : ' tries, ') +
              (Date.now() - regain.at) +
              ' ms.' +
              (djMode ? ' Music back on air.' : '')
          );
          regain = null;
        } else if (djMode && refreshAt) {
          f.dj.refreshes += 1;
          log(
            'Stream refreshed (every ' +
              Math.round(f.dj.refreshMs / 1000) +
              ' s) — back on air in ' +
              (Date.now() - refreshAt) +
              ' ms.'
          );
        } else if (announceHold) {
          log(djMode ? 'DJ on air as ' + botName + '.' : 'Holding the channel as ' + botName + '.');
        }
        if (djMode && !f.dj.onAirSince) f.dj.onAirSince = Date.now();
        refreshAt = 0;
        announceHold = false;
        f.state = 'holding';

        const hold = { runtime: pick.runtime, bot: pick.bot, streamId };
        this.floorHold = hold;
        let lastServerMsg = '';
        let lastServerMsgAt = 0;
        let lostEvt = null;
        if (typeof pick.runtime.setTxEventHandler === 'function') {
          pick.runtime.setTxEventHandler((evt) => {
            if (evt?.type === 'floor-lost') {
              if (lostEvt || this.floorHold !== hold || !f.active || f.pauses > 0) return;
              lostEvt = evt;
              this.floorKeyOff =
                evt.reason === 'foreign-start' && evt.from
                  ? { from: String(evt.from), at: evt.at || Date.now() }
                  : null;
              if (djMode) f.dj.keyOffs += 1;
              log(this.describeFloorLoss(evt));
              return;
            }
            if (evt?.type !== 'server-message') return;
            const now = Date.now();
            if (evt.text === lastServerMsg && now - lastServerMsgAt < 10000) return;
            lastServerMsg = evt.text;
            lastServerMsgAt = now;
            log('Zello sent during the hold: ' + evt.text);
          });
        }

        const holdMs = this.grabHoldMs();
        let holdTimer = null;
        let djResult = null;
        try {
          if (djMode) {
            djResult = await this.djHold(f, pick, streamId);
          } else {
            await pick.runtime.sendPcmHoldingWhile(
              () =>
                new Promise((resolve) => {
                  holdTimer = setTimeout(() => resolve(Buffer.alloc(0)), holdMs);
                }),
              {
                streamId,
                holdSilence: true,
                maxHoldMs: holdMs + 5000,
                // Off, or the same bot needs to speak — let go now (stop_stream goes out at once)
                shouldRelease: () => !f.active || f.pauses > 0 || this.floor !== f,
                abortOnFloorLoss: true,
                fastStop: true
              }
            );
          }
        } catch (err) {
          if (f.active) {
            log(
              'Hold ended: ' + (err?.message || String(err)) + ' — re-grabbing…'
            );
          }
        } finally {
          clearTimeout(holdTimer);
          if (this.floorHold === hold) this.floorHold = null;
          if (typeof pick.runtime.setTxEventHandler === 'function') {
            pick.runtime.setTxEventHandler(null);
          }
        }

        if (lostEvt && f.active) {
          regain = { at: lostEvt.at || Date.now(), tries: 0 };
        } else if (djMode && f.active && djResult && (djResult.released || djResult.capped)) {
          refreshAt = Date.now();
        } else if (djMode && f.active && djResult?.interrupted) {
          // Cut without a key-up (e.g. our own "stop" aborted the TX) — just re-grab
          regain = { at: Date.now(), tries: 0 };
          log('Stream was cut — re-grabbing…');
        }
        // Loop straight back: refresh our own hold, or recover if someone cut in
      }
    } catch {
      /* ignore */
    } finally {
      f.active = false;
      f.state = 'off';
      if (this.floor === f) this.floor = null;
      this.floorHold = null;
      log(
        djMode
          ? 'DJ off — channel released.'
          : constant
            ? 'Constant requests OFF — channel released.'
            : 'Grab floor OFF — channel released.'
      );
    }
  }
}

module.exports = { MultiBotRuntime };
