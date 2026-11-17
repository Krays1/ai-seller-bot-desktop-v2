/**
 * Checks the bot speak-target math: budgets, num_predict, trimmer, clamp, calibration.
 * Run: node tools/test-speak-length.js
 */
const {
  DEFAULT_WORDS_PER_SEC,
  clampSpeakTarget,
  countWords,
  recordSpeechSample,
  wordsPerSecFor,
  speakBudget,
  trimToWordBudget
} = require('../src/services/speak-length');
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) pass += 1;
  else fail += 1;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (detail ? '  → ' + detail : ''));
}

// Budgets at the default rate
for (const t of [8, 19, 45, 90]) {
  const b = speakBudget(t, DEFAULT_WORDS_PER_SEC);
  const expectWords = Math.round(t * DEFAULT_WORDS_PER_SEC);
  check(
    'budget ' + t + ' s',
    b.seconds === t &&
      b.words === expectWords &&
      b.maxWords === Math.round(expectWords * 1.15) &&
      b.numPredict >= Math.ceil(b.maxWords * 1.6) &&
      b.numPredict <= Math.ceil(b.maxWords * 1.6) + 40,
    'words ' + b.words + ', max ' + b.maxWords + ', num_predict ' + b.numPredict
  );
}
check('90 s gets a big num_predict', speakBudget(90).numPredict > 400, String(speakBudget(90).numPredict));
check('faster voice → more words', speakBudget(19, 3.2).words > speakBudget(19, 2.6).words);

// Clamp
check('clamp 50 stays 50', clampSpeakTarget(50) === 50);
check('clamp 200 → 90', clampSpeakTarget(200) === 90);
check('clamp 1 → 5', clampSpeakTarget(1) === 5);
check('clamp junk → fallback 12', clampSpeakTarget('abc') === 12);
const fs = require('node:fs');
const path = require('node:path');
const storeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'settings-store.js'), 'utf8');
check('settings-store caps at 90', /botSpeakTargetSec:\s*Math\.min\(\s*90/.test(storeSrc));
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
check('UI input max 90', /id="bot-speak-sec"[^>]*max="90"/.test(html));

// Trimmer
const sentence = (n, i) =>
  Array.from({ length: n }, (_, k) => (k === 0 ? 'Line' + i : 'word' + k)).join(' ') + '.';
const long = Array.from({ length: 12 }, (_, i) => sentence(6, i)).join(' '); // 72 words
const t1 = trimToWordBudget(long, 50);
check(
  'long text trimmed at sentence end near limit',
  t1.trimmed && t1.after <= 50 && t1.after >= 45 && /\.$/.test(t1.text),
  t1.before + ' -> ' + t1.after
);
const short = 'Morning! Not bad at all, ta. How is your day?';
const t2 = trimToWordBudget(short, 50);
check('short text untouched', !t2.trimmed && t2.text === short);
const runOn = Array.from({ length: 80 }, (_, i) => 'w' + i).join(' ');
const t3 = trimToWordBudget(runOn, 30);
check('no sentence end → hard cut + period', t3.after === 30 && /w29\.$/.test(t3.text), t3.text.slice(-12));
const say = 'I am the king of the radio and nobody can touch me on this channel ever';
const sayReply = say + '. ' + long;
const t4 = trimToWordBudget(sayReply, 30, { keepPrefix: say });
check('sayLine preserved', t4.text.startsWith(say + '.') && t4.after <= 30, t4.before + ' -> ' + t4.after);
const t5 = trimToWordBudget(sayReply, 8, { keepPrefix: say });
check('sayLine longer than budget survives whole', t5.text === say + '.', t5.text);
check('countWords ignores punctuation tokens', countWords('Hi there — mate !') === 3);

// Calibration
const stats = {};
check('ignore clip under 2 s', recordSpeechSample(stats, { voice: 'A.wav', speed: 1, text: 'Stopped.', seconds: 0.8 }) === null);
recordSpeechSample(stats, { voice: 'A.wav', speed: 1, text: sentence(30, 0), seconds: 10 }); // 3.0 w/s
recordSpeechSample(stats, { voice: 'A.wav', speed: 1, text: sentence(20, 1), seconds: 10 }); // 2.0 w/s
check('running average', Math.abs(stats['a.wav'].wps - 2.5) < 1e-9, String(stats['a.wav'].wps));
recordSpeechSample(stats, { voice: 'B.wav', speed: 1, text: sentence(100, 2), seconds: 5 }); // 20 w/s
check('clamp high to 4', stats['b.wav'].wps === 4);
recordSpeechSample(stats, { voice: 'C.wav', speed: 1, text: sentence(5, 3), seconds: 10 }); // 0.5 w/s
check('clamp low to 1.5', stats['c.wav'].wps === 1.5);
recordSpeechSample(stats, { voice: 'D.wav', speed: 2, text: sentence(60, 4), seconds: 10 }); // 6 w/s at 2x
check('speed-normalised sample', Math.abs(stats['d.wav'].wps - 3) < 1e-9, String(stats['d.wav'].wps));
check('per-voice lookup', Math.abs(wordsPerSecFor(stats, 'a.wav', 1) - 2.5) < 1e-9);
check('speed scales lookup', Math.abs(wordsPerSecFor(stats, 'A.wav', 1.2) - 3) < 1e-9);
check('unknown voice → default', wordsPerSecFor(stats, 'nobody.wav', 1) === DEFAULT_WORDS_PER_SEC);
check('lookup clamped', wordsPerSecFor(stats, 'B.wav', 2) === 4);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
