/**
 * Offline DJ mixer test: music + two talkover lines through DjMixer, written
 * to test-output/dj-mix-test.wav. Checks the ducking envelope and clipping.
 *
 *   node tools/dj-mix-test.js [music file (mp3/wav/…)] [--rate 24000]
 *
 * Talkover speech: OmniVoice (127.0.0.1:8002) when running, else Windows' own
 * speech synthesizer. No Zello connection is made.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DjMixer, resampleInt16, FRAME_MS } = require('../src/services/dj-mixer');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'test-output');
const args = process.argv.slice(2);
const rateArg = args.indexOf('--rate');
const RATE = rateArg >= 0 ? Number(args[rateArg + 1]) : 24000;
const musicFile = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--rate');
const LINES = [
  "You're locked in to the live mix. This one goes out to everybody on the channel tonight!",
  'Requests are open, just say play and the song name. Turn it up!'
];

function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a wav');
  let off = 12;
  let fmt = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = { channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === 'data' && fmt) {
      const n = Math.floor(Math.min(size, buf.length - body) / (fmt.bits / 8) / fmt.channels);
      const out = new Int16Array(n);
      for (let i = 0; i < n; i += 1) {
        let s = 0;
        for (let c = 0; c < fmt.channels; c += 1) {
          const p = body + (i * fmt.channels + c) * (fmt.bits / 8);
          s += fmt.bits === 16 ? buf.readInt16LE(p) : fmt.bits === 32 ? buf.readFloatLE(p) * 32767 : (buf.readUInt8(p) - 128) * 256;
        }
        out[i] = Math.max(-32768, Math.min(32767, Math.round(s / fmt.channels)));
      }
      return { pcm: out, rate: fmt.rate };
    }
    off = body + size + (size % 2);
  }
  throw new Error('wav has no data');
}

function writeWav(file, int16, rate) {
  const data = Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

/** 32 s of synthetic dance music: kick, hats, bass and chords, peaking near -2 dBFS. */
function synthMusic(rate, seconds = 32) {
  const n = rate * seconds;
  const out = new Float32Array(n);
  const beat = 60 / 124;
  const roots = [55, 43.65, 49, 41.2]; // A, F, G, E (bass, Hz)
  for (let i = 0; i < n; i += 1) {
    const t = i / rate;
    const b = t / beat;
    const inBeat = (b % 1) * beat;
    const bar = Math.floor(b / 4) % 4;
    const root = roots[bar];
    let s = 0;
    // Kick: pitch-dropping sine
    s += 0.9 * Math.exp(-inBeat * 18) * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-inBeat * 30)) * inBeat);
    // Off-beat hat: filtered noise burst
    const off = ((b + 0.5) % 1) * beat;
    s += 0.12 * Math.exp(-off * 60) * (Math.random() * 2 - 1);
    // Bass on eighths
    const eighth = ((b * 2) % 1) * (beat / 2);
    s += 0.35 * Math.exp(-eighth * 6) * Math.sin(2 * Math.PI * root * 2 * t);
    // Pad chord (root, third, fifth an octave+ up)
    const third = bar === 0 || bar === 3 ? 1.189 : 1.26;
    for (const m of [4, 4 * third, 6]) s += 0.07 * Math.sin(2 * Math.PI * root * m * t + Math.sin(t * 3));
    out[i] = s;
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const g = (0.8 * 32767) / peak;
  return Int16Array.from(out, (v) => Math.round(v * g));
}

function decodeWithFfmpeg(file, rate) {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-t', '40', '-f', 's16le', '-ac', '1', '-ar', String(rate), 'pipe:1'], {
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
  if (run.status !== 0) throw new Error('ffmpeg could not decode ' + file + ': ' + String(run.stderr).slice(0, 200));
  const buf = run.stdout;
  return new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 2)));
}

async function omniVoiceSpeech(text) {
  const res = await fetch('http://127.0.0.1:8002/health', { signal: AbortSignal.timeout(1500) });
  if (!res.ok) throw new Error('OmniVoice not ready');
  const form = new FormData();
  form.append('text', text);
  form.append('num_step', '8');
  const tts = await fetch('http://127.0.0.1:8002/tts', { method: 'POST', body: form, signal: AbortSignal.timeout(120000) });
  if (!tts.ok) throw new Error('OmniVoice HTTP ' + tts.status);
  return readWav(Buffer.from(await tts.arrayBuffer()));
}

function windowsSpeech(text, idx) {
  const file = path.join(os.tmpdir(), 'dj-mix-test-line' + idx + '.wav');
  const ps = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    "$s.SetOutputToWaveFile('" + file.replace(/'/g, "''") + "')",
    "$s.Speak('" + text.replace(/'/g, "''") + "')",
    '$s.Dispose()'
  ].join('; ');
  const run = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true });
  if (run.status !== 0 || !fs.existsSync(file)) throw new Error('Windows speech failed: ' + run.stderr);
  return readWav(fs.readFileSync(file));
}

/** Pull frames, scheduling talkover lines at given seconds. */
function runMix(mixer, music, schedule, seconds) {
  let pos = 0;
  mixer.setMusic({
    read(n) {
      if (pos >= music.length) return null;
      const out = new Int16Array(n);
      out.set(music.subarray(pos, pos + n));
      pos += n;
      return out;
    }
  });
  const frames = Math.round((seconds * 1000) / FRAME_MS);
  const chunks = [];
  const trace = [];
  const events = [];
  let now = 0;
  for (let f = 0; f < frames; f += 1) {
    const t = (f * FRAME_MS) / 1000;
    now = f;
    for (const s of schedule) {
      if (!s.queued && t >= s.at) {
        s.queued = true;
        events.push({ type: 'queued', line: s.name, t });
        mixer.enqueueVoice(s.pcm, {
          rate: s.rate,
          onStart: () => events.push({ type: 'start', line: s.name, t: (now * FRAME_MS) / 1000 }),
          onEnd: () => events.push({ type: 'end', line: s.name, t: ((now + 1) * FRAME_MS) / 1000 })
        });
      }
    }
    const buf = mixer.frame();
    chunks.push(new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)));
    trace.push({ t, duck: mixer.levels.duck, busy: mixer.voiceBusy });
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Int16Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return { out, trace, events };
}

function firstTime(trace, from, pred) {
  const row = trace.find((r) => r.t >= from && pred(r));
  return row ? row.t : null;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const music = musicFile ? decodeWithFfmpeg(musicFile, RATE) : synthMusic(RATE);
  console.log('Music:', musicFile || 'synthetic 124 bpm loop', '·', (music.length / RATE).toFixed(1), 's at', RATE, 'Hz');

  let engine = 'OmniVoice';
  const voices = [];
  for (let i = 0; i < LINES.length; i += 1) {
    try {
      voices.push(await omniVoiceSpeech(LINES[i]));
    } catch {
      engine = 'Windows speech (OmniVoice is not running)';
      voices.push(windowsSpeech(LINES[i], i));
    }
  }
  console.log('Talkover voice:', engine);

  const duck = 0.2;
  const mixer = new DjMixer({ sampleRate: RATE, musicVolume: 1.0, voiceVolume: 1.0, duckLevel: duck });
  const lineSec = voices.map((v) => v.pcm.length / v.rate);
  const schedule = [
    { name: 'line 1', at: 4, pcm: voices[0].pcm, rate: voices[0].rate },
    { name: 'line 2', at: 4 + lineSec[0] + 3.5, pcm: voices[1].pcm, rate: voices[1].rate }
  ];
  const seconds = Math.min(music.length / RATE, schedule[1].at + lineSec[1] + 4);
  const { out, trace, events } = runMix(mixer, music, schedule, seconds);
  const wavPath = path.join(OUT_DIR, 'dj-mix-test.wav');
  writeWav(wavPath, out, RATE);

  // ---- envelope checks ----
  const checks = [];
  const tol = 0.045; // one 20 ms frame of slack either side
  for (const s of schedule) {
    const q = events.find((e) => e.type === 'queued' && e.line === s.name).t;
    const start = events.find((e) => e.type === 'start' && e.line === s.name)?.t;
    const end = events.find((e) => e.type === 'end' && e.line === s.name)?.t;
    const reachedDuck = firstTime(trace, q, (r) => r.duck <= duck + 1e-6);
    const fadeDownMs = Math.round((reachedDuck - q) * 1000);
    const duckAtStart = trace.find((r) => r.t >= start)?.duck;
    const duringMax = Math.max(...trace.filter((r) => r.t > start && r.t < end).map((r) => r.duck));
    const releaseStart = firstTime(trace, end, (r) => r.duck > duck + 1e-6) - FRAME_MS / 1000;
    const backUp = firstTime(trace, end, (r) => r.duck >= 0.999);
    const fadeUpMs = Math.round((backUp - releaseStart) * 1000);
    checks.push({
      line: s.name,
      fadeDownMs,
      voiceStartsAfterFade: start >= reachedDuck - tol,
      musicGainAtVoiceStart: Number(duckAtStart.toFixed(3)),
      musicGainWhileTalking: Number(duringMax.toFixed(3)),
      holdAfterVoiceMs: Math.round((releaseStart - end) * 1000),
      fadeUpMs,
      pass:
        Math.abs(fadeDownMs - 150) <= 45 &&
        start >= reachedDuck - tol &&
        duringMax <= duck + 1e-6 &&
        Math.abs(fadeUpMs - 500) <= 45
    });
  }

  // ---- clipping ----
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  // Stress: music and voice both at 150 % with no ducking must still not clip
  const hot = new DjMixer({ sampleRate: RATE, musicVolume: 1.5, voiceVolume: 1.5, duckLevel: 1 });
  const hotRun = runMix(hot, music, [{ name: 'hot', at: 1, pcm: voices[0].pcm, rate: voices[0].rate }], Math.min(8, music.length / RATE));
  let hotPeak = 0;
  for (const v of hotRun.out) hotPeak = Math.max(hotPeak, Math.abs(v));

  // ---- queueing: two lines typed back to back play in order, music stays down between them ----
  const q = new DjMixer({ sampleRate: RATE, duckLevel: duck });
  const qRun = runMix(q, music, [
    { name: 'A', at: 1, pcm: voices[0].pcm, rate: voices[0].rate },
    { name: 'B', at: 1.02, pcm: voices[1].pcm, rate: voices[1].rate }
  ], Math.min(music.length / RATE, 1 + lineSec[0] + lineSec[1] + 2));
  const aEnd = qRun.events.find((e) => e.type === 'end' && e.line === 'A').t;
  const bStart = qRun.events.find((e) => e.type === 'start' && e.line === 'B').t;
  const gapMax = Math.max(...qRun.trace.filter((r) => r.t >= aEnd && r.t <= bStart).map((r) => r.duck));

  const results = {
    wav: wavPath,
    sampleRate: RATE,
    seconds: Number((out.length / RATE).toFixed(1)),
    talkoverEngine: engine,
    events: events.map((e) => e.type + ' ' + e.line + ' @' + e.t.toFixed(2) + 's'),
    envelope: checks,
    clipping: {
      peakDbfs: Number((20 * Math.log10(peak / 32768)).toFixed(2)),
      clippedSamples: mixer.clippedSamples,
      limiterFrames: mixer.limitedFrames,
      hotStressPeakDbfs: Number((20 * Math.log10(hotPeak / 32768)).toFixed(2)),
      hotStressClipped: hot.clippedSamples,
      pass: mixer.clippedSamples === 0 && hot.clippedSamples === 0 && hotPeak <= 32767 * 0.9
    },
    queue: {
      order: qRun.events.filter((e) => e.type === 'start').map((e) => e.line).join(' → '),
      gapBetweenLinesMs: Math.round((bStart - aEnd) * 1000),
      musicGainBetweenLines: Number(gapMax.toFixed(3)),
      pass: bStart > aEnd && gapMax <= duck + 1e-6
    }
  };
  results.pass = results.envelope.every((c) => c.pass) && results.clipping.pass && results.queue.pass;
  console.log(JSON.stringify(results, null, 2));
  process.exit(results.pass ? 0 : 1);
})().catch((err) => {
  console.error('FAILED', err);
  process.exit(1);
});
