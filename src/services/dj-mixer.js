/**
 * DJ mixer: a music bus plus talkover voices with ducking, pulled one 20 ms
 * frame at a time by the Zello sender. All PCM is 16-bit mono at sampleRate.
 *
 * Talkover: music fades to duckLevel over attackMs, the voice starts once the
 * fade is done (full level), and music fades back up over releaseMs after the
 * last queued voice. A peak limiter keeps the sum from clipping.
 */
const FRAME_MS = 20;
const LIMIT_CEILING = 0.89 * 32767; // about -1 dBFS
const LIMIT_RELEASE_MS = 200;

function toInt16(buf) {
  if (buf instanceof Int16Array) return buf;
  if (Buffer.isBuffer(buf) || buf instanceof Uint8Array) {
    const n = Math.floor(buf.byteLength / 2);
    const out = new Int16Array(n);
    const view = new DataView(buf.buffer, buf.byteOffset, n * 2);
    for (let i = 0; i < n; i += 1) out[i] = view.getInt16(i * 2, true);
    return out;
  }
  if (buf instanceof ArrayBuffer) return toInt16(new Uint8Array(buf));
  return new Int16Array(0);
}

/** Stateful linear resampler so chunk boundaries stay click-free. */
class StreamResampler {
  constructor(fromRate, toRate) {
    this.from = fromRate;
    this.to = toRate;
    this.step = fromRate / toRate;
    this.pos = 0;
    this.prev = 0;
  }

  process(input) {
    const src = toInt16(input);
    if (this.from === this.to) return src;
    if (!src.length) return new Int16Array(0);
    const out = [];
    // Sample -1 is the last sample of the previous chunk
    while (this.pos < src.length - 1) {
      const i = Math.floor(this.pos);
      const f = this.pos - i;
      const a = i < 0 ? this.prev : src[i];
      const b = src[i + 1];
      out.push(a + (b - a) * f);
      this.pos += this.step;
    }
    this.pos -= src.length;
    this.prev = src[src.length - 1];
    return Int16Array.from(out, (v) => Math.round(v));
  }
}

function resampleInt16(input, fromRate, toRate) {
  const src = toInt16(input);
  if (!fromRate || !toRate || fromRate === toRate) return src;
  const r = new StreamResampler(fromRate, toRate);
  const head = r.process(src);
  // Flush the tail sample the streaming resampler holds back
  const tailLen = Math.max(0, Math.round((src.length * toRate) / fromRate) - head.length);
  if (!tailLen) return head;
  const out = new Int16Array(head.length + tailLen);
  out.set(head);
  out.fill(src[src.length - 1], head.length);
  return out;
}

/** FIFO of Int16Array chunks. */
class PcmQueue {
  constructor() {
    this.chunks = [];
    this.head = 0;
    this.length = 0;
  }

  push(samples) {
    const s = toInt16(samples);
    if (!s.length) return;
    this.chunks.push(s);
    this.length += s.length;
  }

  /** Copy up to n samples into out[offset..]; returns how many were copied. */
  readInto(out, offset, n) {
    let copied = 0;
    while (copied < n && this.chunks.length) {
      const c = this.chunks[0];
      const take = Math.min(c.length - this.head, n - copied);
      out.set(c.subarray(this.head, this.head + take), offset + copied);
      copied += take;
      this.head += take;
      if (this.head >= c.length) {
        this.chunks.shift();
        this.head = 0;
      }
    }
    this.length -= copied;
    return copied;
  }

  drop(n) {
    let left = Math.min(n, this.length);
    this.length -= left;
    while (left > 0 && this.chunks.length) {
      const c = this.chunks[0];
      const take = Math.min(c.length - this.head, left);
      left -= take;
      this.head += take;
      if (this.head >= c.length) {
        this.chunks.shift();
        this.head = 0;
      }
    }
  }

  clear() {
    this.chunks = [];
    this.head = 0;
    this.length = 0;
  }
}

/**
 * Music pushed in real time (renderer capture). Rebuffers on underrun and
 * drops the oldest audio when it falls too far behind (stream refresh gaps,
 * key-offs) so latency stays bounded.
 */
class LiveMusicInput {
  constructor(sampleRate, { prebufferMs = 100, maxLatencyMs = 450, targetMs = 140 } = {}) {
    this.rate = sampleRate;
    this.queue = new PcmQueue();
    this.prebuffer = Math.round((sampleRate * prebufferMs) / 1000);
    this.maxLatency = Math.round((sampleRate * maxLatencyMs) / 1000);
    this.target = Math.round((sampleRate * targetMs) / 1000);
    this.playing = false;
    this.underruns = 0;
    this.trimmed = 0;
  }

  push(samples) {
    this.queue.push(samples);
    // Nobody pulling (off air / keyed off): keep only the freshest audio
    if (this.queue.length > this.maxLatency * 2) {
      const excess = this.queue.length - this.target;
      this.queue.drop(excess);
      this.trimmed += excess;
    }
  }

  read(n) {
    if (this.queue.length > this.maxLatency) {
      const excess = this.queue.length - this.target;
      this.queue.drop(excess);
      this.trimmed += excess;
    }
    if (!this.playing) {
      if (this.queue.length < this.prebuffer + n) return null;
      this.playing = true;
    }
    if (this.queue.length < n) {
      this.playing = false;
      this.underruns += 1;
      return null;
    }
    const out = new Int16Array(n);
    this.queue.readInto(out, 0, n);
    return out;
  }

  clear() {
    this.queue.clear();
    this.playing = false;
  }
}

class DjMixer {
  constructor(options = {}) {
    this.sampleRate = Number(options.sampleRate) || 16000;
    this.frameSamples = Math.round((this.sampleRate * FRAME_MS) / 1000);
    this.attackMs = Number(options.attackMs) || 150;
    this.releaseMs = Number(options.releaseMs) || 500;
    this.gapMs = options.gapMs != null ? Number(options.gapMs) : 250;
    this.holdMs = options.holdMs != null ? Number(options.holdMs) : 120;
    this.musicVolume = 0.8;
    this.voiceVolume = 1;
    this.duckLevel = 0.2;
    this.setLevels(options);

    this.music = null;
    this.voices = [];
    this.current = null;
    this.live = new Set();
    this.seq = 0;

    this.gain = 1;
    this.limGain = 1;
    this.limRelease = 1 - Math.exp(-1 / ((LIMIT_RELEASE_MS / 1000) * this.sampleRate));
    this.preroll = 0;
    this.gapLeft = 0;
    this.holdLeft = 0;

    this.framesOut = 0;
    this.clippedSamples = 0;
    this.limitedFrames = 0;
    this.levels = { music: 0, voice: 0, out: 0, duck: 1 };
  }

  setLevels(levels = {}) {
    const clamp = (v, lo, hi, d) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
    };
    this.musicVolume = clamp(levels.musicVolume, 0, 1.5, this.musicVolume);
    this.voiceVolume = clamp(levels.voiceVolume, 0, 1.5, this.voiceVolume);
    this.duckLevel = clamp(levels.duckLevel, 0, 1, this.duckLevel);
  }

  /** source.read(n) → Int16Array(n) or null (silence). */
  setMusic(source) {
    this.music = source || null;
  }

  /**
   * Queue a finished voice clip (TTS, bot reply, Speak-as). Resolves when it
   * has played; cb.onStart / cb.onEnd fire from inside frame().
   */
  enqueueVoice(pcm, opts = {}) {
    const samples = resampleInt16(pcm, Number(opts.rate) || this.sampleRate, this.sampleRate);
    const item = {
      id: ++this.seq,
      samples,
      pos: 0,
      meta: opts.meta || {},
      onStart: opts.onStart,
      onEnd: opts.onEnd,
      started: false
    };
    item.done = new Promise((resolve) => {
      item.resolve = resolve;
    });
    this.voices.push(item);
    return item;
  }

  /** Remove queued (not yet playing) voices; filter(meta) picks which. */
  cancelVoices(filter = () => true) {
    const keep = [];
    for (const item of this.voices) {
      if (filter(item.meta, item)) this.finishItem(item, { cancelled: true });
      else keep.push(item);
    }
    this.voices = keep;
  }

  /**
   * Live talk layered over the music (Voice Changer push-to-talk on the DJ
   * bot). feed.take() → 20 ms PCM at `rate` or null; feed.isFinished().
   */
  addLiveVoice(feed, opts = {}) {
    const entry = {
      feed,
      resampler: new StreamResampler(Number(opts.rate) || 16000, this.sampleRate),
      pending: new PcmQueue(),
      frames: 0,
      voiced: 0,
      onEnd: opts.onEnd
    };
    entry.done = new Promise((resolve) => {
      entry.resolve = resolve;
    });
    this.live.add(entry);
    return entry;
  }

  /** Something is speaking, queued, or the music is still ducked for it. */
  get voiceBusy() {
    return Boolean(this.current || this.voices.length || this.live.size || this.preroll > 0);
  }

  finishItem(item, info = {}) {
    try {
      item.onEnd?.(info);
    } catch {
      /* ignore */
    }
    item.resolve?.({ ...info, durationMs: Math.round((item.samples.length / this.sampleRate) * 1000) });
  }

  /** Next 20 ms of mixed audio as Int16LE Buffer. */
  frame() {
    const n = this.frameSamples;
    const music = this.music ? this.music.read(n) : null;
    const voice = new Float32Array(n);
    let voicePeak = 0;

    // Live talk (all active feeds summed)
    for (const entry of [...this.live]) {
      if (entry.feed.isFinished?.()) {
        this.live.delete(entry);
        try {
          entry.onEnd?.();
        } catch {
          /* ignore */
        }
        entry.resolve({ frames: entry.frames, voiced: entry.voiced });
        continue;
      }
      const f = entry.feed.take?.();
      if (f && f.length) {
        entry.voiced += 1;
        entry.pending.push(entry.resampler.process(f));
      }
      entry.frames += 1;
      const tmp = new Int16Array(n);
      const got = entry.pending.readInto(tmp, 0, n);
      for (let i = 0; i < got; i += 1) voice[i] += tmp[i];
    }
    const liveTalking = this.live.size > 0;

    // Queued clips: duck first (preroll), then play, small gap between lines
    const wantClip = Boolean(this.current || this.voices.length);
    if (wantClip && !this.current) {
      if (this.gapLeft > 0) {
        this.gapLeft -= 1;
      } else if (this.gain > this.duckLevel + 0.01 && this.preroll <= 0) {
        // One extra frame so the fade has fully landed before the first word
        this.preroll = Math.ceil(this.attackMs / FRAME_MS) + 1;
      }
      if (this.preroll > 0) this.preroll -= 1;
      if (this.preroll <= 0 && this.gapLeft <= 0) {
        this.current = this.voices.shift();
        this.current.started = true;
        try {
          this.current.onStart?.();
        } catch {
          /* ignore */
        }
      }
    }
    let filled = 0;
    while (this.current && filled < n) {
      const item = this.current;
      const take = Math.min(n - filled, item.samples.length - item.pos);
      for (let i = 0; i < take; i += 1) voice[filled + i] += item.samples[item.pos + i];
      item.pos += take;
      filled += take;
      if (item.pos >= item.samples.length) {
        this.current = null;
        this.finishItem(item, { played: true });
        if (this.voices.length) {
          this.gapLeft = Math.round(this.gapMs / FRAME_MS);
          break;
        }
        this.holdLeft = Math.round(this.holdMs / FRAME_MS);
      }
    }

    const ducking = Boolean(this.current || this.voices.length || liveTalking || this.preroll > 0);
    if (!ducking && this.holdLeft > 0) this.holdLeft -= 1;
    const target = ducking || this.holdLeft > 0 ? this.duckLevel : 1;
    const attackStep = (1 - this.duckLevel) / Math.max(1, (this.attackMs / 1000) * this.sampleRate);
    const releaseStep = (1 - this.duckLevel) / Math.max(1, (this.releaseMs / 1000) * this.sampleRate);

    const out = Buffer.alloc(n * 2);
    let musicPeak = 0;
    let outPeak = 0;
    let limited = false;
    for (let i = 0; i < n; i += 1) {
      if (this.gain > target) this.gain = Math.max(target, this.gain - attackStep);
      else if (this.gain < target) this.gain = Math.min(target, this.gain + releaseStep);
      const m = music ? music[i] * this.musicVolume * this.gain : 0;
      const v = voice[i] * this.voiceVolume;
      const x = m + v;
      const ax = Math.abs(x);
      this.limGain += (1 - this.limGain) * this.limRelease;
      if (ax * this.limGain > LIMIT_CEILING) {
        this.limGain = LIMIT_CEILING / ax;
        limited = true;
      }
      let y = Math.round(x * this.limGain);
      if (y > 32767 || y < -32768) {
        this.clippedSamples += 1;
        y = y > 0 ? 32767 : -32768;
      }
      out.writeInt16LE(y, i * 2);
      const am = Math.abs(m);
      if (am > musicPeak) musicPeak = am;
      const av = Math.abs(v);
      if (av > voicePeak) voicePeak = av;
      const ay = Math.abs(y);
      if (ay > outPeak) outPeak = ay;
    }
    if (limited) this.limitedFrames += 1;
    this.framesOut += 1;
    this.levels = {
      music: musicPeak / 32768,
      voice: voicePeak / 32768,
      out: outPeak / 32768,
      duck: this.gain
    };
    return out;
  }

  /** Drop everything queued (DJ off). */
  reset() {
    this.cancelVoices();
    if (this.current) {
      this.finishItem(this.current, { cancelled: true });
      this.current = null;
    }
    for (const entry of this.live) entry.resolve({ frames: entry.frames, voiced: entry.voiced });
    this.live.clear();
    this.preroll = 0;
    this.gapLeft = 0;
    this.holdLeft = 0;
  }
}

module.exports = {
  DjMixer,
  LiveMusicInput,
  PcmQueue,
  StreamResampler,
  resampleInt16,
  toInt16,
  FRAME_MS
};
