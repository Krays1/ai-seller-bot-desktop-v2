/**
 * Voice Changer: renderer mic PCM (16 kHz mono) → Seed-VC server or instant
 * DSP → chosen bot's live Zello stream. Fallback "Speak then repeat" records
 * the whole push, transcribes it and re-speaks it with OmniVoice.
 * Voices come ONLY from the dedicated "voice changer voices" folder.
 */
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { DSP_VOICES, createDsp } = require('./voice-changer-dsp');

const SAMPLE_RATE = 16000;
const FRAME_BYTES = 640;
const MAX_TX_MS = 60000;
const DEFAULT_CONVERTER_URL = 'http://127.0.0.1:8003';
const MAX_LAG_EXTRA_MS = 240;

function isQuiet(frame) {
  let sum = 0;
  const n = Math.floor(frame.length / 2);
  for (let i = 0; i < n; i += 1) {
    const v = frame.readInt16LE(i * 2);
    sum += v * v;
  }
  return n === 0 || Math.sqrt(sum / n) < 300;
}

/** Jitter buffer between bursty converter output and the 20 ms Opus clock. */
class LiveFeed {
  constructor(jitterMs) {
    this.jitterMs = jitterMs;
    this.chunks = [];
    this.buffered = 0;
    this.ended = false;
    this.playing = false;
    this.waitingSince = 0;
    this.dropped = 0;
  }

  push(buf) {
    if (!buf || !buf.length || this.ended) return;
    this.chunks.push(buf);
    this.buffered += buf.length;
    if (!this.waitingSince) this.waitingSince = Date.now();
  }

  end() {
    this.ended = true;
  }

  isFinished() {
    return this.ended && this.buffered === 0;
  }

  take() {
    if (!this.playing) {
      if (!this.buffered) return null;
      const jitterBytes = (this.jitterMs * SAMPLE_RATE * 2) / 1000;
      if (
        !this.ended &&
        this.buffered < jitterBytes + FRAME_BYTES &&
        Date.now() - this.waitingSince < this.jitterMs
      ) {
        return null;
      }
      this.playing = true;
    }
    if (this.buffered < FRAME_BYTES && !this.ended) {
      this.playing = false;
      this.waitingSince = this.buffered ? Date.now() : 0;
      return null;
    }
    // Running behind (audio queued while the channel was being won): skip quiet frames
    const maxLagBytes = ((this.jitterMs + MAX_LAG_EXTRA_MS) * SAMPLE_RATE * 2) / 1000;
    for (let drops = 0; drops < 4 && this.buffered - FRAME_BYTES > maxLagBytes; drops += 1) {
      const frame = this.read(FRAME_BYTES);
      if (!isQuiet(frame)) return frame;
      this.dropped += 1;
    }
    return this.read(Math.min(FRAME_BYTES, this.buffered));
  }

  read(want) {
    const out = Buffer.alloc(want);
    let filled = 0;
    while (filled < want) {
      const head = this.chunks[0];
      const n = Math.min(head.length, want - filled);
      head.copy(out, filled, 0, n);
      filled += n;
      if (n === head.length) this.chunks.shift();
      else this.chunks[0] = head.subarray(n);
    }
    this.buffered -= want;
    if (!this.buffered) this.waitingSince = 0;
    return out;
  }
}

/** One Seed-VC websocket session (see E:\seed-vc\vc_server.py). */
class SeedVcStream {
  constructor({ url, reference, tuning, onAudio, onStats, onError, onClose }) {
    this.onClose = onClose;
    this.url = String(url || DEFAULT_CONVERTER_URL).replace(/^http/i, 'ws').replace(/\/+$/, '') + '/ws';
    this.reference = reference;
    this.tuning = tuning || {};
    this.onAudio = onAudio;
    this.onStats = onStats;
    this.onError = onError;
    this.ws = null;
    this.ready = false;
    this.queue = [];
    this.flushWaiter = null;
  }

  open(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err, info) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          this.close();
          reject(err);
        } else {
          resolve(info);
        }
      };
      const timer = setTimeout(
        () => done(new Error('Voice changer server did not answer in time.')),
        timeoutMs
      );
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'start', reference: this.reference, ...this.tuning }));
      });
      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          this.onAudio?.(Buffer.from(data));
          return;
        }
        let msg;
        try {
          msg = JSON.parse(String(data));
        } catch {
          return;
        }
        if (msg.type === 'ready') {
          this.ready = true;
          for (const buf of this.queue) ws.send(buf);
          this.queue = [];
          done(null, msg);
        } else if (msg.type === 'stats') {
          this.onStats?.(msg);
        } else if (msg.type === 'flushed') {
          this.flushWaiter?.();
        } else if (msg.type === 'error') {
          const err = new Error(msg.error || 'Voice changer error');
          if (!settled) done(err);
          else this.onError?.(err);
        }
      });
      ws.on('error', (err) => {
        if (!settled) {
          done(
            new Error(
              'Voice changer server is not running (' +
                (err.code || err.message) +
                '). Start E:\\seed-vc\\start-voice-changer.bat, or use "Speak then repeat".'
            )
          );
        } else {
          this.onError?.(err);
        }
      });
      ws.on('close', () => {
        const wasReady = this.ready;
        this.ready = false;
        this.flushWaiter?.();
        if (!settled) done(new Error('Voice changer server closed the connection.'));
        else if (wasReady && this.ws === ws) this.onClose?.();
      });
    });
  }

  push(buf) {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) this.ws.send(buf);
    else if (!this.ready) this.queue.push(buf);
  }

  flush(timeoutMs = 5000) {
    if (!this.ready || this.ws?.readyState !== WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(finish, timeoutMs);
      function finish() {
        clearTimeout(timer);
        resolve();
      }
      this.flushWaiter = finish;
      this.ws.send(JSON.stringify({ type: 'flush' }));
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.ready = false;
  }
}

class VoiceChangerService {
  constructor({ settingsStore, zelloRuntimeService, voiceBotService, appRoot, userDataPath }) {
    this.settingsStore = settingsStore;
    this.zello = zelloRuntimeService;
    this.voiceBot = voiceBotService;
    this.voicesDir = path.join(appRoot, 'voice changer voices');
    this.testWavPath = path.join(userDataPath, 'voice-changer-test.wav');
    this.session = null;
    this.seq = 0;
    this.lastStats = null;
    this.statusListener = null;
    this.outputListener = null;
  }

  setStatusListener(fn) {
    this.statusListener = typeof fn === 'function' ? fn : null;
  }

  setOutputListener(fn) {
    this.outputListener = typeof fn === 'function' ? fn : null;
  }

  log(message, level) {
    this.voiceBot?.logActivity?.('VoiceChanger', message, level);
  }

  emit(status) {
    try {
      this.statusListener?.({ at: Date.now(), stats: this.lastStats, ...status });
    } catch {
      /* ignore */
    }
  }

  prefs() {
    return this.settingsStore.read().voiceChanger || {};
  }

  converterUrl() {
    return String(this.prefs().converterUrl || DEFAULT_CONVERTER_URL).replace(/\/+$/, '');
  }

  listVoiceFiles() {
    try {
      fs.mkdirSync(this.voicesDir, { recursive: true });
      return fs
        .readdirSync(this.voicesDir)
        .filter((f) => /\.wav$/i.test(f))
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  listVoices() {
    return [
      ...DSP_VOICES.map((v) => ({ ...v, kind: 'dsp' })),
      ...this.listVoiceFiles().map((f) => ({
        id: f,
        label: f.replace(/\.wav$/i, ''),
        kind: 'clip'
      }))
    ];
  }

  /** Only a plain file name inside the voice-changer folder is accepted. */
  resolveClip(voice) {
    const base = path.basename(String(voice || ''));
    if (!base || base !== voice || !/\.wav$/i.test(base)) return null;
    const full = path.join(this.voicesDir, base);
    return fs.existsSync(full) ? full : null;
  }

  async health() {
    const url = this.converterUrl();
    try {
      const res = await fetch(url + '/health', { signal: AbortSignal.timeout(2500) });
      if (!res.ok) return { ok: false, url, error: 'HTTP ' + res.status };
      const body = await res.json();
      return { ...body, ok: body.ready === true, url };
    } catch (err) {
      return { ok: false, url, error: err?.cause?.code || err?.message || String(err) };
    }
  }

  listBots() {
    const settings = this.settingsStore.read();
    const status = this.zello?.getStatus?.() || {};
    const byId = new Map((status.bots || []).map((b) => [String(b.id), b]));
    return (Array.isArray(settings.bots) ? settings.bots : [])
      .filter((b) => b && b.enabled !== false && b.username)
      .map((b) => {
        const st = byId.get(String(b.id));
        return {
          id: String(b.id),
          name: b.identityName || b.username,
          connected: st?.status === 'connected',
          status: st?.status || 'disconnected',
          channel: st?.channelName || b.channelName || '',
          transmitting: !!st?.transmitting
        };
      });
  }

  async info() {
    return {
      voices: this.listVoices(),
      voicesDir: this.voicesDir,
      bots: this.listBots(),
      converter: await this.health(),
      active: this.session
        ? { id: this.session.id, state: this.session.state }
        : null
    };
  }

  savePrefs(prefs) {
    const current = this.settingsStore.read();
    const saved = this.settingsStore.write({
      ...current,
      voiceChanger: { ...(current.voiceChanger || {}), ...(prefs || {}) }
    });
    return saved.voiceChanger;
  }

  async start(opts = {}) {
    if (this.session) {
      throw new Error('Already talking — release the button first.');
    }
    const mode = opts.mode === 'repeat' ? 'repeat' : 'live';
    const test = opts.test === true;
    const voice = String(opts.voice || '');
    const isDsp = voice.startsWith('dsp:');
    const clip = isDsp ? null : this.resolveClip(voice);
    if (!isDsp && !clip) {
      throw new Error('Pick a voice from the voice changer folder.');
    }
    if (mode === 'repeat' && isDsp) {
      throw new Error('"Speak then repeat" needs a voice clip, not an instant effect.');
    }
    const bot = this.listBots().find((b) => b.id === String(opts.botId || ''));
    if (!test && !bot) {
      throw new Error('Pick a joined bot to talk as.');
    }

    const s = {
      id: ++this.seq,
      mode,
      test,
      voice,
      clip,
      isDsp,
      bot,
      state: 'starting',
      startedAt: Date.now(),
      feed: new LiveFeed(isDsp ? 40 : 80),
      input: [],
      inputBytes: 0,
      outputBytes: 0,
      testOut: [],
      tx: null,
      dsp: null,
      vc: null,
      capTimer: null,
      error: null
    };
    // Set before any await so mic chunks sent right after this call are kept
    this.session = s;
    if (mode !== 'live' || isDsp) this.lastStats = null;
    const who = bot ? bot.name : 'nobody';
    const voiceLabel = isDsp
      ? (DSP_VOICES.find((v) => v.id === voice)?.label || voice)
      : voice.replace(/\.wav$/i, '');
    this.emit({ state: 'starting', sessionId: s.id, test, mode });

    try {
      if (mode === 'live') {
        if (isDsp) {
          s.dsp = createDsp(voice);
        } else {
          const p = this.prefs();
          const tuning = {};
          if (Number(p.diffusionSteps) > 0) tuning.diffusion_steps = Number(p.diffusionSteps);
          if (Number(p.blockMs) > 0) tuning.block_time = Number(p.blockMs) / 1000;
          s.vc = new SeedVcStream({
            url: this.converterUrl(),
            reference: clip,
            tuning,
            onAudio: (buf) => this.output(s, buf),
            onStats: (st) => {
              this.lastStats = st;
              this.emit({ state: s.state, sessionId: s.id, test });
            },
            onError: (err) => {
              s.error = err;
              this.log('Converter: ' + (err?.message || err), 'warn');
            },
            onClose: () => {
              if (this.session !== s || s.stopping) return;
              this.log('Voice changer server went away — stopping.', 'warn');
              this.emit({ state: 'error', sessionId: s.id, error: 'Voice changer server disconnected.' });
              this.stop(s.id, 'converter').catch(() => {});
            }
          });
          const ready = await s.vc.open();
          this.lastStats = { ...(this.lastStats || {}), ...ready };
        }
        if (!test) {
          let markStarted;
          const started = new Promise((resolve) => {
            markStarted = resolve;
          });
          s.tx = this.zello.liveTransmitAs(bot.id, s.feed, {
            maxMs: MAX_TX_MS + 2000,
            onStarted: () => markStarted()
          });
          s.tx.then(
            (r) => {
              if (this.session === s && !s.stopping && r?.interrupted) {
                this.log('Cut off — someone else keyed up or the bot dropped.', 'warn');
                this.emit({ state: 'error', sessionId: s.id, error: 'Cut off — channel taken.' });
                this.stop(s.id, 'interrupted').catch(() => {});
              }
            },
            () => {}
          );
          await Promise.race([started, s.tx]);
        }
      }
    } catch (err) {
      this.teardown(s);
      const msg = err?.message || String(err);
      this.log('Could not start as ' + who + ': ' + msg, 'warn');
      this.emit({ state: 'error', sessionId: s.id, error: msg });
      throw new Error(msg);
    }

    if (this.session !== s) {
      return { ok: false, sessionId: s.id };
    }
    s.state = mode === 'repeat' ? 'recording' : test ? 'testing' : 'transmitting';
    s.capTimer = setTimeout(() => {
      this.log('Hit the ' + MAX_TX_MS / 1000 + ' s limit — releasing.', 'warn');
      this.stop(s.id, 'cap').catch(() => {});
    }, MAX_TX_MS);
    this.log(
      (test ? 'Test (not sent): ' : mode === 'repeat' ? 'Recording for ' : 'Live as ') +
        (test ? voiceLabel : who + ' in voice ' + voiceLabel) +
        (mode === 'repeat' ? ' (speak then repeat)' : '')
    );
    this.emit({ state: s.state, sessionId: s.id, test, mode, botId: bot?.id || '' });
    return { ok: true, sessionId: s.id, state: s.state };
  }

  pushPcm(sessionId, data) {
    const s = this.session;
    if (!s || s.id !== Number(sessionId) || s.stopping) return;
    let buf;
    if (data instanceof ArrayBuffer) buf = Buffer.from(new Uint8Array(data));
    else if (ArrayBuffer.isView(data)) buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    else return;
    if (!buf.length) return;
    s.inputBytes += buf.length;
    if (s.mode === 'repeat') {
      if (s.inputBytes <= MAX_TX_MS * 32) s.input.push(buf);
      return;
    }
    if (s.dsp) this.output(s, s.dsp.process(buf));
    else if (s.vc) s.vc.push(buf);
  }

  output(s, buf) {
    if (!buf?.length) return;
    s.outputBytes += buf.length;
    if (s.test) {
      s.testOut.push(buf);
      try {
        this.outputListener?.(buf);
      } catch {
        /* ignore */
      }
    } else {
      s.feed.push(buf);
    }
  }

  async stop(sessionId, reason = 'release') {
    const s = this.session;
    if (!s || (sessionId != null && s.id !== Number(sessionId))) {
      return { ok: true, idle: true };
    }
    if (s.stopping) return s.stopping;
    clearTimeout(s.capTimer);
    s.state = 'finishing';
    this.emit({ state: 'finishing', sessionId: s.id, test: s.test });
    s.stopping = (async () => {
      let result = {};
      try {
        result = s.mode === 'repeat' ? await this.finishRepeat(s) : await this.finishLive(s);
      } catch (err) {
        const msg = err?.message || String(err);
        this.log('Failed: ' + msg, 'warn');
        this.emit({ state: 'error', sessionId: s.id, error: msg });
        this.teardown(s);
        return { ok: false, error: msg };
      }
      this.teardown(s);
      const out = { ok: true, reason, ...result };
      this.emit({ state: 'idle', sessionId: s.id, last: out });
      return out;
    })();
    return s.stopping;
  }

  async finishLive(s) {
    if (s.vc) {
      await s.vc.flush();
      s.vc.close();
    }
    s.feed.end();
    const spokenSec = s.inputBytes / 2 / SAMPLE_RATE;
    if (s.test) {
      const savedPath = this.saveTest(s);
      this.log(
        'Test done: ' + spokenSec.toFixed(1) + ' s in, ' +
          (s.outputBytes / 2 / SAMPLE_RATE).toFixed(1) + ' s out (not sent). Saved ' + savedPath
      );
      return { savedPath, inputSec: spokenSec };
    }
    const tx = s.tx ? await s.tx : null;
    this.log(
      'Sent ' + ((tx?.durationMs || 0) / 1000).toFixed(1) + ' s as ' + s.bot.name +
        (tx?.interrupted ? ' (cut off — someone keyed up)' : '') +
        (tx?.capped ? ' (hit time limit)' : '')
    );
    return { tx };
  }

  async finishRepeat(s) {
    const pcm = Buffer.concat(s.input);
    if (pcm.length < SAMPLE_RATE * 2 * 0.4) {
      this.log('Too short to repeat — hold the button while you talk.', 'warn');
      return { skipped: true };
    }
    const config = this.voiceBot.readConfiguration();
    const text = await this.voiceBot.transcribePcm(pcm, SAMPLE_RATE, config);
    if (!text) {
      throw new Error('Speech-to-text heard nothing.');
    }
    this.log('Heard: "' + text.slice(0, 160) + '" — re-speaking as ' + s.voice.replace(/\.wav$/i, ''));
    this.emit({ state: 'finishing', sessionId: s.id, test: s.test, transcript: text });
    const speech = await this.synthesizeWithClip(text, s.clip, config);
    if (s.test) {
      this.output(s, speech);
      const savedPath = this.saveTest(s);
      this.log('Test done (not sent). Saved ' + savedPath);
      return { savedPath, transcript: text };
    }
    const result = await this.zello.sendPcmAs(s.bot.id, speech, { manual: true });
    this.log('Sent ' + (speech.length / 2 / SAMPLE_RATE).toFixed(1) + ' s as ' + s.bot.name);
    return { transcript: text, result };
  }

  /** OmniVoice with the clip uploaded, so names never resolve into the OmniVoice voices folder. */
  async synthesizeWithClip(text, clip, config) {
    const base = path.basename(clip);
    const name = 'vc__' + base;
    const form = new FormData();
    form.append('text', text);
    form.append('voice', name);
    form.append('num_step', String(Math.max(4, Math.min(16, Math.round(Number(config.omnivoiceSteps) || 6)))));
    form.append('voice_wav', new Blob([fs.readFileSync(clip)], { type: 'audio/wav' }), name);
    const txt = clip.replace(/\.wav$/i, '.txt');
    if (fs.existsSync(txt)) {
      const refText = fs.readFileSync(txt, 'utf8').replace(/\s+/g, ' ').trim();
      if (refText) form.append('ref_text', refText);
    }
    let res;
    try {
      res = await fetch(config.omnivoiceUrl + '/tts', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(120000)
      });
    } catch (err) {
      throw new Error('OmniVoice is not reachable: ' + (err?.message || err));
    }
    if (!res.ok) {
      throw new Error('OmniVoice HTTP ' + res.status + ': ' + (await res.text().catch(() => '')).slice(0, 200));
    }
    const decoded = this.voiceBot.decodeWavToPcm16Mono(Buffer.from(await res.arrayBuffer()));
    return this.voiceBot.resamplePcm16(decoded.pcm, decoded.sampleRate, SAMPLE_RATE);
  }

  saveTest(s) {
    try {
      const pcm = Buffer.concat(s.testOut);
      fs.writeFileSync(this.testWavPath, this.voiceBot.pcmToWav(pcm, SAMPLE_RATE));
      return this.testWavPath;
    } catch (err) {
      this.log('Could not save test wav: ' + (err?.message || err), 'warn');
      return '';
    }
  }

  teardown(s) {
    clearTimeout(s.capTimer);
    s.feed.end();
    if (s.vc) s.vc.close();
    if (this.session === s) this.session = null;
  }
}

module.exports = { VoiceChangerService, LiveFeed, SeedVcStream, MAX_TX_MS };
