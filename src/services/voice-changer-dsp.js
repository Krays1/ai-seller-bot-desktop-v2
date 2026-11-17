/**
 * Instant (no AI) voice effects on 16 kHz mono PCM16, sample-by-sample so
 * they add no buffering delay beyond the pitch shifter's 40 ms window.
 */
const SAMPLE_RATE = 16000;

const DSP_VOICES = [
  { id: 'dsp:robot', label: 'Robot (instant)' },
  { id: 'dsp:pitch-up', label: 'Pitch up (instant)' },
  { id: 'dsp:pitch-down', label: 'Pitch down (instant)' }
];

function softClip(x) {
  return Math.tanh(x);
}

function createRobot() {
  const carrierHz = 60;
  const combLen = Math.round(SAMPLE_RATE * 0.0065);
  const comb = new Float32Array(combLen);
  let combIdx = 0;
  let phase = 0;
  let n = 0;
  let held = 0;
  const step = (2 * Math.PI * carrierHz) / SAMPLE_RATE;
  return (x) => {
    let y = 0.8 * x * Math.sin(phase) + 0.2 * x;
    phase += step;
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
    const fed = y + 0.55 * comb[combIdx];
    comb[combIdx] = fed;
    combIdx = (combIdx + 1) % combLen;
    y = fed * 0.9;
    if ((n++ & 1) === 0) held = Math.round(y * 20) / 20;
    return softClip(held * 1.6);
  };
}

/** Two crossfaded delay-line taps sweeping at (1 - ratio) samples per sample. */
function createPitchShift(ratio) {
  const win = Math.round(SAMPLE_RATE * 0.04);
  const size = 4096;
  const buf = new Float32Array(size);
  let w = 0;
  let d = 0;
  const rate = 1 - ratio;
  const read = (delay) => {
    const pos = w - delay;
    const i = Math.floor(pos);
    const frac = pos - i;
    const a = buf[(i + size * 2) % size];
    const b = buf[(i + 1 + size * 2) % size];
    return a + (b - a) * frac;
  };
  return (x) => {
    buf[w] = x;
    d += rate;
    if (d >= win) d -= win;
    if (d < 0) d += win;
    const d2 = (d + win / 2) % win;
    const g1 = Math.sin((Math.PI * d) / win) ** 2;
    const g2 = Math.sin((Math.PI * d2) / win) ** 2;
    const y = read(d) * g1 + read(d2) * g2;
    w = (w + 1) % size;
    return y;
  };
}

function createDsp(id) {
  const kind = String(id || '').replace(/^dsp:/, '');
  let fx;
  if (kind === 'robot') fx = createRobot();
  else if (kind === 'pitch-up') fx = createPitchShift(1.45);
  else if (kind === 'pitch-down') fx = createPitchShift(0.72);
  else throw new Error('Unknown effect: ' + id);

  return {
    /** @param {Buffer} pcm PCM16LE mono 16 kHz → same length processed Buffer */
    process(pcm) {
      const n = Math.floor(pcm.length / 2);
      const out = Buffer.alloc(n * 2);
      for (let i = 0; i < n; i += 1) {
        const y = fx(pcm.readInt16LE(i * 2) / 32768);
        out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(y * 32767))), i * 2);
      }
      return out;
    }
  };
}

module.exports = { DSP_VOICES, createDsp, SAMPLE_RATE };
