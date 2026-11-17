/**
 * Bot speaking-length target: seconds → word budget, Ollama num_predict,
 * hard trim, and adaptive words-per-second calibration from real TTS clips.
 */

const SPEAK_TARGET_MIN_SEC = 5;
const SPEAK_TARGET_MAX_SEC = 90;
const DEFAULT_WORDS_PER_SEC = 2.6;
const MIN_WORDS_PER_SEC = 1.5;
const MAX_WORDS_PER_SEC = 4;
const MIN_CALIBRATION_SEC = 2;
// Running average weight caps here so it keeps adapting to new voices/speeds
const CALIBRATION_WINDOW = 20;
const TOKENS_PER_WORD = 1.6;
const NUM_PREDICT_MARGIN = 32;

function clampSpeakTarget(value, fallback = 12) {
  const n = Number(value);
  return Math.min(
    SPEAK_TARGET_MAX_SEC,
    Math.max(
      SPEAK_TARGET_MIN_SEC,
      Math.round(Number.isFinite(n) && n > 0 ? n : fallback)
    )
  );
}

function clampWordsPerSec(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WORDS_PER_SEC;
  return Math.min(MAX_WORDS_PER_SEC, Math.max(MIN_WORDS_PER_SEC, n));
}

function normalizeSpeed(speed) {
  const n = Number(speed);
  return Number.isFinite(n) && n > 0 ? Math.min(4, Math.max(0.25, n)) : 1;
}

function countWords(text) {
  const t = String(text || '').trim();
  return t ? t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
}

function voiceKey(voice) {
  return String(voice || '').trim().toLowerCase() || 'default';
}

/**
 * Stats store: { [voiceKey]: { wps, count } } where wps is normalised to speed 1.
 * Returns the updated entry, or null when the sample was ignored.
 */
function recordSpeechSample(stats, { voice, speed, text, seconds }) {
  const words = countWords(text);
  const secs = Number(seconds);
  if (!stats || !words || !Number.isFinite(secs) || secs < MIN_CALIBRATION_SEC) {
    return null;
  }
  const sample = clampWordsPerSec(words / secs / normalizeSpeed(speed));
  const key = voiceKey(voice);
  const prev = stats[key];
  const count = Math.min(CALIBRATION_WINDOW, (prev ? prev.count : 0) + 1);
  const wps = prev
    ? clampWordsPerSec(prev.wps + (sample - prev.wps) / count)
    : sample;
  stats[key] = { wps, count };
  return stats[key];
}

/** Calibrated (or default) spoken words per second for this voice at this speed. */
function wordsPerSecFor(stats, voice, speed) {
  const entry = stats && stats[voiceKey(voice)];
  const base = entry ? entry.wps : DEFAULT_WORDS_PER_SEC;
  return clampWordsPerSec(base * normalizeSpeed(speed));
}

function speakBudget(targetSec, wordsPerSec = DEFAULT_WORDS_PER_SEC) {
  const seconds = clampSpeakTarget(targetSec);
  const words = Math.max(8, Math.round(seconds * clampWordsPerSec(wordsPerSec)));
  const maxWords = Math.round(words * 1.15);
  const numPredict = Math.ceil(maxWords * TOKENS_PER_WORD) + NUM_PREDICT_MARGIN;
  return { seconds, words, maxWords, numPredict };
}

function cutAtWordBudget(text, maxWords) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (countWords(text) <= maxWords) {
    return words.join(' ');
  }
  // Keep tokens up to the Nth real word (punctuation-only tokens don't count)
  let seen = 0;
  let end = 0;
  for (let i = 0; i < words.length; i += 1) {
    if (/[\p{L}\p{N}]/u.test(words[i])) seen += 1;
    if (seen > maxWords) break;
    end = i + 1;
  }
  const head = words.slice(0, end);
  let lastStop = -1;
  for (let i = head.length - 1; i >= 0; i -= 1) {
    if (/[.!?]+["')\]]*$/.test(head[i])) {
      lastStop = i;
      break;
    }
  }
  // A sentence end too far back would gut the reply; hard-cut instead
  if (lastStop >= 0 && countWords(head.slice(0, lastStop + 1).join(' ')) >= maxWords * 0.5) {
    return head.slice(0, lastStop + 1).join(' ');
  }
  return head.join(' ').replace(/[\s,;:\-–—]+$/, '') + '.';
}

/**
 * Trim to maxWords at a sentence end. keepPrefix (the "say this" line) is never cut.
 * Returns { text, trimmed, before, after }.
 */
function trimToWordBudget(text, maxWords, { keepPrefix = '' } = {}) {
  const src = String(text || '').trim();
  const before = countWords(src);
  const limit = Math.max(1, Math.floor(Number(maxWords) || 0));
  if (before <= limit) {
    return { text: src, trimmed: false, before, after: before };
  }

  let prefix = '';
  let rest = src;
  const want = String(keepPrefix || '').trim();
  if (want) {
    const head = /[.!?]$/.test(want) ? want : want + '.';
    for (const candidate of [head, want]) {
      if (src.startsWith(candidate)) {
        prefix = candidate;
        rest = src.slice(candidate.length).trim();
        break;
      }
    }
  }

  let out;
  if (prefix) {
    const room = limit - countWords(prefix);
    out = room > 0 && rest ? (prefix + ' ' + cutAtWordBudget(rest, room)).trim() : prefix;
  } else {
    out = cutAtWordBudget(src, limit);
  }
  return { text: out, trimmed: out !== src, before, after: countWords(out) };
}

module.exports = {
  SPEAK_TARGET_MIN_SEC,
  SPEAK_TARGET_MAX_SEC,
  DEFAULT_WORDS_PER_SEC,
  MIN_WORDS_PER_SEC,
  MAX_WORDS_PER_SEC,
  clampSpeakTarget,
  clampWordsPerSec,
  countWords,
  recordSpeechSample,
  wordsPerSecFor,
  speakBudget,
  trimToWordBudget
};
