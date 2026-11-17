/**
 * DJ mode: one bot holds the channel and streams live music until Stop.
 * Music comes from the renderer (audio input device / whole-PC loopback,
 * pushed as PCM at the DJ rate) or from the app's own music queue (YouTube
 * via yt-dlp, or local files) decoded here with ffmpeg. Talkover lines are
 * rendered with OmniVoice and mixed over the music with ducking. The channel
 * hold itself (win / refresh / re-grab) is MultiBotRuntime's 'dj' floor.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DjMixer, LiveMusicInput, PcmQueue, resampleInt16, toInt16 } = require('./dj-mixer');

const SOURCES = ['device', 'system', 'app'];
const RATES = [16000, 24000, 48000];
// Opus bitrate per rate: music needs more than voice, but stay phone-data friendly
const BITRATES = { 16000: 28000, 24000: 40000, 48000: 64000 };
const MAX_LINES = 12;
const BOT_VOICE_TIMEOUT_MS = 120000;
const AUDIO_EXTS = ['.m4a', '.webm', '.opus', '.mp3', '.ogg', '.aac', '.flac', '.wav', '.mp4'];

let ffmpegPath = null;

/** ffmpeg without blocking the main process (the sender's 20 ms clock lives there). */
async function resolveFfmpeg() {
  if (ffmpegPath) return ffmpegPath;
  const custom = String(process.env.FFMPEG_PATH || '').trim();
  if (custom && fs.existsSync(custom)) {
    ffmpegPath = custom;
    return ffmpegPath;
  }
  const onPath = await new Promise((resolve) => {
    try {
      const p = spawn('ffmpeg', ['-version'], { windowsHide: true, stdio: 'ignore' });
      p.on('error', () => resolve(false));
      p.on('close', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
  if (onPath) {
    ffmpegPath = 'ffmpeg';
    return ffmpegPath;
  }
  const mod = await import('./channel-extras/ffmpeg-zello.js');
  ffmpegPath = mod.resolveFfmpegExecutable(process.env);
  return ffmpegPath;
}

/** The app's own music queue: tracks decoded by ffmpeg straight to the DJ rate. */
class AppMusicSource {
  constructor({ sampleRate, onEvent }) {
    this.rate = sampleRate;
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.queue = [];
    this.current = null;
    this.next = null;
    this.seq = 0;
    this.highWater = sampleRate * 4;
    this.lowWater = sampleRate * 2;
  }

  add(track) {
    const t = { id: ++this.seq, title: track.title || path.basename(track.path), path: track.path, by: track.by || '' };
    this.queue.push(t);
    this.onEvent('queued', t);
    return t;
  }

  list() {
    return {
      nowPlaying: this.current ? { id: this.current.track.id, title: this.current.track.title, by: this.current.track.by } : null,
      queue: [...(this.next ? [this.next.track] : []), ...this.queue].map((t) => ({ id: t.id, title: t.title, by: t.by }))
    };
  }

  decode(track) {
    const dec = { track, pcm: new PcmQueue(), proc: null, ended: false, paused: false, gotData: false, started: false };
    resolveFfmpeg()
      .then((ffmpeg) => {
        if (dec.killed) return;
        const proc = spawn(
          ffmpeg,
          ['-hide_banner', '-loglevel', 'error', '-i', track.path, '-vn', '-f', 's16le', '-ac', '1', '-ar', String(this.rate), 'pipe:1'],
          { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
        );
        dec.proc = proc;
        let carry = null;
        let stderr = '';
        proc.stdout.on('data', (chunk) => {
          let buf = carry ? Buffer.concat([carry, chunk]) : chunk;
          const even = buf.length - (buf.length % 2);
          carry = even < buf.length ? buf.subarray(even) : null;
          buf = buf.subarray(0, even);
          if (buf.length) {
            dec.gotData = true;
            dec.pcm.push(toInt16(buf));
          }
          if (dec.pcm.length > this.highWater && !dec.paused) {
            dec.paused = true;
            proc.stdout.pause();
          }
        });
        proc.stderr.on('data', (c) => {
          stderr = (stderr + c).slice(-400);
        });
        proc.on('error', (err) => {
          dec.ended = true;
          dec.error = err.message;
        });
        proc.on('close', (code) => {
          dec.ended = true;
          if (code !== 0 && !dec.gotData && !dec.killed) dec.error = stderr.trim() || 'ffmpeg exit ' + code;
        });
      })
      .catch((err) => {
        dec.ended = true;
        dec.error = err?.message || String(err);
      });
    return dec;
  }

  kill(dec) {
    if (!dec) return;
    dec.killed = true;
    try {
      dec.proc?.kill();
    } catch {
      /* ignore */
    }
  }

  /** Called once per 20 ms frame by the mixer. */
  read(n) {
    if (!this.current) {
      if (this.next) {
        this.current = this.next;
        this.next = null;
      } else if (this.queue.length) {
        this.current = this.decode(this.queue.shift());
      } else {
        return null;
      }
    }
    const cur = this.current;
    if (cur.error) {
      this.onEvent('error', cur.track, cur.error);
      this.current = null;
      return null;
    }
    // Decode the next track early so tracks run back to back
    if (cur.ended && !this.next && this.queue.length && cur.pcm.length < this.rate * 3) {
      this.next = this.decode(this.queue.shift());
    }
    if (cur.paused && cur.pcm.length < this.lowWater) {
      cur.paused = false;
      cur.proc?.stdout.resume();
    }
    if (cur.pcm.length < n && !cur.ended) return null;
    if (!cur.started && cur.pcm.length) {
      cur.started = true;
      this.onEvent('playing', cur.track);
    }
    const out = new Int16Array(n);
    cur.pcm.readInto(out, 0, n);
    if (cur.ended && cur.pcm.length === 0) {
      this.onEvent('ended', cur.track);
      this.current = null;
    }
    return out;
  }

  skip() {
    if (!this.current) return null;
    const t = this.current.track;
    this.kill(this.current);
    this.current = null;
    return t;
  }

  stop() {
    this.kill(this.current);
    this.kill(this.next);
    this.current = null;
    this.next = null;
    this.queue = [];
  }
}

class DjService {
  constructor({ settingsStore, zelloRuntimeService, voiceBotService }) {
    this.settingsStore = settingsStore;
    this.zello = zelloRuntimeService;
    this.voiceBot = voiceBotService;
    this.session = null;
    this.seq = 0;
    this.lineSeq = 0;
    this.lines = [];
    this.statusListener = null;
    this.tickTimer = null;
  }

  setStatusListener(fn) {
    this.statusListener = typeof fn === 'function' ? fn : null;
  }

  log(message, level) {
    this.voiceBot?.logActivity?.('DJ', message, level);
  }

  prefs() {
    return this.settingsStore.read().dj || {};
  }

  savePrefs(changes) {
    const current = this.settingsStore.read();
    const saved = this.settingsStore.write({
      ...current,
      dj: { ...(current.dj || {}), ...(changes || {}) }
    });
    if (this.session && changes) this.applyLevels(saved.dj);
    return saved.dj;
  }

  applyLevels(p) {
    this.session?.mixer.setLevels({
      musicVolume: Number(p.musicVolume) / 100,
      voiceVolume: Number(p.voiceVolume) / 100,
      duckLevel: Number(p.duckLevel) / 100
    });
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
          voice: b.omnivoiceVoice || '',
          connected: st?.status === 'connected',
          channel: st?.channelName || b.channelName || ''
        };
      });
  }

  async listVoices() {
    try {
      const raw = await this.voiceBot.listOmniVoiceVoices();
      const list = Array.isArray(raw) ? raw : Array.isArray(raw?.voices) ? raw.voices : [];
      return list
        .map((v) => (typeof v === 'string' ? v : v?.name || v?.id || ''))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /** opts.voices === false skips the OmniVoice voice list (cheap poll for bots/status). */
  async info(opts = {}) {
    // The yt-dlp probe spawns synchronously — don't repeat it while streaming
    if (!this.youtubeProbe || Date.now() - this.youtubeProbe.at > 10 * 60 * 1000) {
      let ready = false;
      try {
        const extras = await this.voiceBot.loadChannelExtras();
        ready = extras.isYouTubeMusicReady?.() === true;
      } catch {
        ready = false;
      }
      this.youtubeProbe = { at: Date.now(), ready };
    }
    return {
      bots: this.listBots(),
      voices: opts.voices === false ? null : await this.listVoices(),
      prefs: this.prefs(),
      youtubeReady: this.youtubeProbe.ready,
      status: this.status()
    };
  }

  status() {
    const s = this.session;
    const floor = this.zello?.getDjStatus?.() || { on: false, state: 'off' };
    const base = {
      at: Date.now(),
      active: Boolean(s),
      lines: this.lines.map((l) => ({ id: l.id, text: l.text, voice: l.voice, state: l.state, error: l.error || '' }))
    };
    if (!s) return { ...base, state: 'off' };
    const music = s.app ? s.app.list() : { nowPlaying: null, queue: [] };
    let state = 'requesting';
    if (floor.state === 'holding') state = 'on-air';
    else if (floor.state === 'offline') state = 'offline';
    else if (!floor.on) state = 'starting';
    return {
      ...base,
      state,
      sessionId: s.id,
      botId: s.botId,
      botName: s.botName,
      source: s.source,
      sampleRate: s.sampleRate,
      onAirSince: floor.onAirSince || 0,
      refreshes: floor.refreshes || 0,
      keyOffs: floor.keyOffs || 0,
      talking: s.mixer.voiceBusy,
      levels: s.mixer.levels,
      nowPlaying: music.nowPlaying,
      queue: music.queue
    };
  }

  emit() {
    try {
      this.statusListener?.(this.status());
    } catch {
      /* ignore */
    }
  }

  async start(opts = {}) {
    if (this.session) throw new Error('DJ mode is already on — press Stop DJ first.');
    const p = this.prefs();
    const botId = String(opts.botId || p.botId || '');
    const bot = this.listBots().find((b) => b.id === botId);
    if (!bot) throw new Error('Pick a joined bot to DJ as.');
    const source = SOURCES.includes(opts.source) ? opts.source : SOURCES.includes(p.source) ? p.source : 'device';
    const sampleRate = RATES.includes(Number(opts.sampleRate))
      ? Number(opts.sampleRate)
      : RATES.includes(Number(p.sampleRate)) ? Number(p.sampleRate) : 24000;

    const mixer = new DjMixer({ sampleRate });
    const s = {
      id: ++this.seq,
      botId,
      botName: bot.name,
      source,
      sampleRate,
      mixer,
      live: new LiveMusicInput(sampleRate),
      app: null,
      renderChain: Promise.resolve(),
      pending: new Set()
    };
    this.session = s;
    this.applyLevels(p);
    this.setSource(source);

    try {
      await resolveFfmpeg().catch(() => null);
      if (this.session !== s) return { ok: false };
      await this.zello.startDj({
        botId,
        engine: this,
        sampleRate,
        bitrate: BITRATES[sampleRate],
        refreshMs: (Number(p.refreshSec) || 50) * 1000,
        log: (m) => this.log(m)
      });
    } catch (err) {
      this.session = null;
      mixer.reset();
      s.app?.stop();
      this.emit();
      throw err;
    }
    this.savePrefs({ botId, source, sampleRate });
    this.log(
      'DJ mode starting as ' + bot.name + ' — music from ' + this.sourceLabel(source) +
        ', ' + sampleRate / 1000 + ' kHz.'
    );
    const intro = this.expandLine(p.introLine, s);
    if (intro) this.say({ text: intro, voice: p.voice || '' });
    clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => this.emit(), 200);
    this.emit();
    return { ok: true, sessionId: s.id, sampleRate };
  }

  async stop() {
    const s = this.session;
    if (!s) {
      this.emit();
      return { ok: true, idle: true };
    }
    if (s.stopping) return s.stopping;
    s.stopping = (async () => {
      // Let go of the channel first; the sender still pulls frames until then
      try {
        await this.zello.stopDj();
      } finally {
        if (this.session === s) this.session = null;
        clearInterval(this.tickTimer);
        this.tickTimer = null;
        s.mixer.reset();
        s.app?.stop();
        s.live.clear();
        for (const t of s.pending) clearTimeout(t);
        for (const l of this.lines) {
          if (l.state === 'rendering' || l.state === 'queued' || l.state === 'on air') l.state = 'cancelled';
        }
        this.emit();
      }
      return { ok: true };
    })();
    return s.stopping;
  }

  sourceLabel(source) {
    return source === 'system' ? 'whole-PC sound' : source === 'app' ? 'the app music queue' : 'an audio input';
  }

  expandLine(text, s) {
    const p = this.prefs();
    return String(text || '')
      .replace(/\{name\}/gi, p.djName || s.botName)
      .replace(/\{bot\}/gi, s.botName)
      .trim();
  }

  /** Switch the music bus while on air. */
  setSource(source) {
    const s = this.session;
    if (!s || !SOURCES.includes(source)) return this.status();
    const changed = s.source !== source;
    s.source = source;
    if (source === 'app') {
      if (!s.app) {
        s.app = new AppMusicSource({ sampleRate: s.sampleRate, onEvent: (type, t, err) => this.onTrackEvent(type, t, err) });
      }
      s.mixer.setMusic(s.app);
    } else {
      s.live.clear();
      s.mixer.setMusic(s.live);
    }
    if (changed) {
      this.log('Music source → ' + this.sourceLabel(source) + '.');
      this.savePrefs({ source });
    }
    this.emit();
    return this.status();
  }

  onTrackEvent(type, track, err) {
    if (type === 'playing') this.log('Now playing: ' + track.title + (track.by ? ' (asked by ' + track.by + ')' : ''));
    else if (type === 'error') this.log('Could not play ' + track.title + ': ' + String(err || '').slice(0, 160), 'warn');
    this.emit();
  }

  pushPcm(sessionId, data) {
    const s = this.session;
    if (!s || s.id !== Number(sessionId) || s.source === 'app') return;
    let buf;
    if (data instanceof ArrayBuffer) buf = Buffer.from(new Uint8Array(data));
    else if (ArrayBuffer.isView(data)) buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    else return;
    if (buf.length >= 2) s.live.push(toInt16(buf));
  }

  // ---- talkover ----

  addLine(fields) {
    const line = { id: ++this.lineSeq, at: Date.now(), state: 'queued', ...fields };
    this.lines.push(line);
    while (this.lines.length > MAX_LINES) {
      const idx = this.lines.findIndex((l) => l.state === 'done' || l.state === 'failed' || l.state === 'cancelled');
      this.lines.splice(idx >= 0 ? idx : 0, 1);
    }
    return line;
  }

  /** Type-and-Enter talkover: OmniVoice renders it, then it's ducked over the music. */
  say({ text, voice } = {}) {
    const s = this.session;
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!clean) throw new Error('Type something to say.');
    if (!s) throw new Error('Start DJ mode first.');
    const line = this.addLine({ text: clean, voice: String(voice || ''), state: 'rendering' });
    this.emit();
    s.renderChain = s.renderChain.then(async () => {
      if (this.session !== s || line.state === 'cancelled') return;
      try {
        const pcm = await this.renderSpeech(s, clean, line.voice);
        if (this.session !== s || line.state === 'cancelled') return;
        line.state = 'queued';
        this.emit();
        const item = s.mixer.enqueueVoice(pcm, {
          rate: s.sampleRate,
          meta: { lineId: line.id, source: 'talkover' },
          onStart: () => {
            line.state = 'on air';
            this.log('Talkover on air' + (line.voice ? ' (' + line.voice.replace(/\.wav$/i, '') + ')' : '') + ': "' + clean.slice(0, 160) + '"');
            this.emit();
          },
          onEnd: (info) => {
            line.state = info?.cancelled ? 'cancelled' : 'done';
            this.emit();
          }
        });
        line.itemId = item.id;
      } catch (err) {
        line.state = 'failed';
        line.error = err?.message || String(err);
        this.log('Talkover failed: ' + line.error, 'warn');
        this.emit();
      }
    });
    return { ok: true, id: line.id };
  }

  async renderSpeech(s, text, voice) {
    const settings = this.settingsStore.read();
    const bot = (settings.bots || []).find((b) => String(b.id) === s.botId);
    const base = await this.voiceBot.getLiveConfiguration();
    const config = bot ? this.voiceBot.configurationForBot(base, bot) : { ...base };
    if (voice) config.omnivoiceVoice = voice;
    const pcm = await this.voiceBot.synthesizeSpeech(text, config, { sampleRate: s.sampleRate });
    if (!Buffer.isBuffer(pcm) || pcm.length < 2) throw new Error('OmniVoice returned no audio.');
    return pcm;
  }

  cancelLine(id) {
    const s = this.session;
    const line = this.lines.find((l) => l.id === Number(id));
    if (!line) return this.status();
    if (line.state === 'rendering') line.state = 'cancelled';
    else if (line.state === 'queued' && s) s.mixer.cancelVoices((meta) => meta.lineId === line.id);
    this.emit();
    return this.status();
  }

  // ---- engine API (MultiBotRuntime 'dj' floor) ----

  frame() {
    const s = this.session;
    return s ? s.mixer.frame() : null;
  }

  get voiceBusy() {
    return Boolean(this.session?.mixer.voiceBusy);
  }

  /** A same-bot transmit (bot reply / Speak-as, 16 kHz) mixed over the music. */
  playVoice(pcm, meta = {}) {
    const s = this.session;
    if (!s) return Promise.reject(new Error('DJ mode is off.'));
    const label = meta.source || 'Bot';
    const durationMs = Math.round((pcm.length / 2 / 16000) * 1000);
    const line = this.addLine({ text: '(' + label + ', ' + (durationMs / 1000).toFixed(1) + ' s)', voice: '', state: 'queued', bot: true });
    let timer = null;
    const item = s.mixer.enqueueVoice(pcm, {
      rate: 16000,
      meta: { lineId: line.id, source: 'bot' },
      onStart: () => {
        line.state = 'on air';
        this.log(label + ' mixed over the music (' + (durationMs / 1000).toFixed(1) + ' s).');
        this.emit();
      },
      onEnd: (info) => {
        line.state = info?.cancelled ? 'cancelled' : 'done';
        this.emit();
      }
    });
    this.emit();
    timer = setTimeout(() => {
      s.pending.delete(timer);
      if (!item.started) s.mixer.cancelVoices((m) => m.lineId === line.id);
    }, BOT_VOICE_TIMEOUT_MS);
    s.pending.add(timer);
    return item.done.then((r) => {
      clearTimeout(timer);
      s.pending.delete(timer);
      return {
        success: !r.cancelled,
        viaDj: true,
        interrupted: Boolean(r.cancelled),
        durationMs
      };
    });
  }

  /** Voice Changer push-to-talk on the DJ bot: live voice over the music. */
  playLiveVoice(feed, options = {}) {
    const s = this.session;
    if (!s) return Promise.reject(new Error('DJ mode is off.'));
    try {
      options.onStarted?.(0);
    } catch {
      /* ignore */
    }
    const line = this.addLine({ text: '(Voice Changer — live)', voice: '', state: 'on air', bot: true });
    this.log('Voice Changer live over the music.');
    this.emit();
    const entry = s.mixer.addLiveVoice(feed, { rate: 16000 });
    // Off air (keyed off / offline) nothing pulls frames — still end when the mic is released
    const watch = setInterval(() => {
      if (!feed.isFinished?.() || !s.mixer.live.has(entry)) return;
      s.mixer.live.delete(entry);
      entry.resolve({ frames: entry.frames, voiced: entry.voiced });
    }, 250);
    return entry.done.then((r) => {
      clearInterval(watch);
      line.state = 'done';
      this.emit();
      return {
        success: true,
        viaDj: true,
        interrupted: false,
        capped: false,
        framesSent: r.frames,
        voicedFrames: r.voiced,
        durationMs: r.frames * 20
      };
    });
  }

  /** Channel "bot stop" — drop queued bot replies (the operator's talkover stays). */
  cancelBotVoices() {
    this.session?.mixer.cancelVoices((meta) => meta.source === 'bot');
  }

  // ---- app music queue ----

  requireApp() {
    const s = this.session;
    if (!s) throw new Error('Start DJ mode first.');
    if (s.source !== 'app') throw new Error('Switch the music source to "App music" first.');
    return s.app;
  }

  async addSong({ query, by } = {}) {
    const app = this.requireApp();
    const q = String(query || '').trim();
    if (!q) throw new Error('Type a song name or YouTube link.');
    const extras = await this.voiceBot.loadChannelExtras();
    if (typeof extras.prepareYouTubeSource !== 'function') throw new Error('YouTube music is not available.');
    this.log('Finding "' + q.slice(0, 80) + '" on YouTube…');
    const track = await extras.prepareYouTubeSource({ query: q });
    const t = app.add({ title: track.title, path: track.audioPath, by: by || '' });
    this.log('Queued: ' + t.title);
    this.emit();
    return { ok: true, title: t.title };
  }

  addFile(filePath, by = '') {
    const app = this.requireApp();
    const full = String(filePath || '');
    if (!full || !fs.existsSync(full)) throw new Error('File not found.');
    const t = app.add({ title: path.basename(full).replace(/\.[^.]+$/, ''), path: full, by });
    this.log('Queued file: ' + t.title);
    this.emit();
    return { ok: true, title: t.title };
  }

  skip() {
    const s = this.session;
    const t = s?.app?.skip();
    if (t) this.log('Skipped: ' + t.title);
    this.emit();
    return this.status();
  }

  /**
   * Channel "play SONG" while DJ mode is on: queue it instead of keying up.
   * Uses the original download (better than the 16 kHz Zello wav) when present.
   */
  queueSongRequest({ wavPath, title, by } = {}) {
    const s = this.session;
    if (!s) return { queued: false, reason: 'DJ mode is off.' };
    if (s.source !== 'app') {
      this.log('Song request "' + (title || '?') + '" not played — DJ is live from ' + this.sourceLabel(s.source) + '.');
      return { queued: false, reason: 'DJ is live — song requests are off right now.' };
    }
    let src = wavPath;
    const base = String(wavPath || '').replace(/\.zello\.wav$/i, '');
    if (base !== wavPath) {
      const original = AUDIO_EXTS.map((e) => base + e).find((p) => fs.existsSync(p));
      if (original) src = original;
    }
    const t = s.app.add({ title: title || path.basename(src), path: src, by });
    this.log('Song request queued: ' + t.title + (by ? ' (asked by ' + by + ')' : ''));
    this.emit();
    return { queued: true, title: t.title };
  }
}

module.exports = { DjService, AppMusicSource, resolveFfmpeg, RATES, BITRATES, resampleInt16 };
