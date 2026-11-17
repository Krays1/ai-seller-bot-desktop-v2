/**
 * Quick check for the voice-change channel command
 * ("switch to Leanne" / "Sugar change your voice to Tommy" / "talk like trump").
 * Run: node tools/test-voice-command.js
 */
const fs = require('node:fs');
const path = require('node:path');
const {
  parseVoiceChangeCommand,
  matchVoiceName,
  voiceDisplayName
} = require('../src/services/bot-commands');

const voicesDir = path.join(__dirname, '..', 'omnivoice voices');
const voices = fs.existsSync(voicesDir)
  ? fs.readdirSync(voicesDir).filter((n) => n.toLowerCase().endsWith('.wav'))
  : [];
// Junk names must never be chosen even if a list ever contains them
voices.push('voice-personas.json', 'voice-ref-manifest.json', '_new_clones.txt');

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) pass += 1;
  else fail += 1;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (detail ? '  → ' + detail : ''));
}

/** Same decision the service makes: parse, then loose match if "voice" said, else strict. */
function resolve(text) {
  const cmd = parseVoiceChangeCommand(text);
  if (!cmd) return { cmd, match: null };
  return { cmd, match: matchVoiceName(cmd.voice, voices, { strict: !cmd.explicit }) };
}

// [text after any bot name, expected voice file, or null = must stay normal chat]
const parserCases = [
  // with the word "voice" (looser matching)
  ['change your voice to Tommy', 'Tommy.wav'],
  ['switch voice to abby', 'abby.wav'],
  ['use the trump voice', 'trump.wav'],
  ['voice Scouse Mikey', 'Scouse Mikey.wav'],
  ['change you voice to tommy', 'Tommy.wav'],
  ['change your boys to Alex', 'Alex.wav'],
  ['switch voices to Stuart.', 'Stuart.wav'],
  ['can you change your voice to mr walrus please', 'mr.WoLrUs.wav'],
  ['change your voice to mister walrus', 'mr.WoLrUs.wav'],
  ['change your voice to leanne', 'Leanne44.wav'],
  ['switch to the german u boat voice', 'german u boat.wav'],
  ['change voice to Gordon', 'gorden.wav'],
  ['use voice joyce anne', 'Joyce Ann.wav'],
  ['change your voice too dj huddersfield', 'dj huddersfield.wav'],
  ['change your voice to wullie dunhill', 'wulliedunhill.wav'],
  ['change your voice to trumps', 'trump.wav'],
  ['change your voice to the bombay boy one', 'bombayboy.wav'],
  // no "voice" — whole utterance + strict match
  ['switch to Leanne', 'Leanne44.wav'],
  ['switch to Leanne.', 'Leanne44.wav'],
  ['AI switch to Leanne.', 'Leanne44.wav'],
  ['change to Tommy', 'Tommy.wav'],
  ['go to abby', 'abby.wav'],
  ['be Doctor Strange', 'Doctor Strange.wav'],
  ['be dr strange', 'Doctor Strange.wav'],
  ['switch to dr. strange', 'Doctor Strange.wav'],
  ['change your voice to doctor strange', 'Doctor Strange.wav'],
  ['become sugar', 'sugar.wav'],
  ['talk like trump', 'trump.wav'],
  ['sound like Alex', 'Alex.wav'],
  ['can you switch to scouse mikey please', 'Scouse Mikey.wav'],
  ['bot switch to mr walrus', 'mr.WoLrUs.wav'],
  ['switch to trumps', 'trump.wav'],
  // must NOT trigger
  ['I love your voice', null],
  ['what voice is that', null],
  ['change the channel', null],
  ['your voice is lovely', null],
  ['voice is great', null],
  ['change your voice', null],
  ['tell me about voice acting', null],
  ['switch to channel 2', null],
  ['switch to English', null],
  ['switch to German', null],
  ['change to the other one', null],
  ['go to bed', null],
  ["I'll switch to decaf", null],
  ['be quiet', null],
  ['talk like a pirate', null],
  ['switch to Leanne and tell me a joke about cats', null]
];

console.log('Voices found: ' + voices.length + '\n');
for (const [text, expected] of parserCases) {
  const { cmd, match } = resolve(text);
  if (expected === null) {
    check(
      '"' + text + '" stays chat',
      !match,
      match ? 'matched ' + match.voice + ' (' + Math.round(match.score * 100) + '%)' : ''
    );
    continue;
  }
  check(
    '"' + text + '"',
    match?.voice === expected,
    cmd
      ? 'heard "' + cmd.voice + '"' + (cmd.explicit ? '' : ' [no "voice"]') + ' → ' +
          (match ? match.voice + ' (' + Math.round(match.score * 100) + '%)' : 'no match')
      : 'not parsed'
  );
}

console.log('');
// Names that must NOT match any voice even loosely
for (const name of ['darth vader', 'pirate', 'xyz', 'banana', 'voice personas']) {
  const m = matchVoiceName(name, voices);
  check('"' + name + '" has no voice', !m, m ? m.voice : '');
}

check('display "Leanne44.wav" → "Leanne"', voiceDisplayName('Leanne44.wav') === 'Leanne');

// ---------------------------------------------------------------------------
// End-to-end through VoiceBotService: in-memory settings, stubbed STT/TTS/Zello/LLM
// (no network, no real settings file)
const { VoiceBotService } = require('../src/services/voice-bot-service');

function makeService({ bots, autoReply = true }) {
  let stored = {
    bots: bots.map((b) => ({ enabled: true, canSpeak: true, channelName: '', ...b })),
    multiBot: { cutInWhenCapped: true },
    speech: {}
  };
  const settingsStore = {
    read: () => JSON.parse(JSON.stringify(stored)),
    write: (s) => {
      stored = JSON.parse(JSON.stringify(s));
      return stored;
    }
  };
  const tx = [];
  const llm = [];
  const spoken = [];
  const zr = {
    getStatus: () => ({
      bots: stored.bots.map((b) => ({ id: b.id, status: 'connected', channelName: 'Test' }))
    }),
    sendPcmAs: async (id, pcm, options) => {
      tx.push({ id, manual: options?.manual === true });
      return { ok: true };
    },
    seizeAndSpeak: async (id, producePcm) => {
      const out = await producePcm();
      if (out && out.commandHandled) return { ok: true, commandHandled: true };
      tx.push({ id, manual: false, llm: true });
      return { ok: true };
    }
  };
  const svc = new VoiceBotService({ settingsStore, zelloRuntimeService: zr });
  svc.listOmniVoiceVoices = async () => voices;
  svc.loadChannelExtras = async () => ({ handleExtrasCommand: async () => null });
  svc.synthesizeSpeech = async (text, cfg) => {
    spoken.push({ text, voice: cfg.omnivoiceVoice, bot: cfg.activeBotId });
    return Buffer.alloc(320);
  };
  svc.decodeOpusStream = () => ({ pcm: Buffer.alloc(320), sampleRate: 16000 });
  svc.runBotReplyTurnBuildPcm = async ({ bot }) => {
    llm.push(String(bot.id));
    return Buffer.alloc(320);
  };
  svc.runBotReplyTurn = async ({ bot }) => {
    llm.push(String(bot.id));
    return { ok: true };
  };
  svc.getLiveConfiguration = async () => {
    const s = settingsStore.read();
    return {
      autoReply,
      behaviorMode: 'banter',
      identityName: 'Bot',
      omnivoiceVoice: '',
      bots: s.bots.filter((b) => b.enabled !== false),
      botUsernames: s.bots.map((b) => b.username.toLowerCase()),
      multiBot: s.multiBot
    };
  };
  const voiceOf = (id) => settingsStore.read().bots.find((b) => b.id === id)?.omnivoiceVoice;
  const say = (text, from = 'Human1') => {
    svc.transcribePcm = async () => text;
    return svc.handleCompletedStream({ from, channel: 'Test', packets: [] });
  };
  const type = (text, from = 'Human1') =>
    svc.handleCompletedStream({
      from,
      channel: 'Test',
      textTranscript: text,
      isChannelText: true,
      packets: []
    });
  return { svc, voiceOf, say, type, tx, llm, spoken };
}

const ZELLO = { id: 'z', username: 'zelloai_bot', identityName: 'ZELLO+AI', omnivoiceVoice: 'ghost.wav' };
const SUGAR = { id: 's', username: 'SugarBot', identityName: 'Sugar', omnivoiceVoice: 'sugar.wav' };

async function serviceChecks() {
  console.log('');

  // The exact live failure: free-talk bot, spoken, fast button-race path
  {
    const t = makeService({ bots: [ZELLO] });
    await t.say('Zello AI switch to Leanne.');
    check('live: "Zello AI switch to Leanne." switches ZELLO+AI', t.voiceOf('z') === 'Leanne44.wav', t.voiceOf('z'));
    check('live: not sent to the LLM', t.llm.length === 0, 'llm calls ' + t.llm.length);
    check(
      'live: confirmation spoken in new voice',
      t.spoken.at(-1)?.voice === 'Leanne44.wav' && /Leanne voice/.test(t.spoken.at(-1)?.text),
      JSON.stringify(t.spoken.at(-1))
    );
  }

  // Listen mode (autoReply off) — still switches and speaks
  {
    const t = makeService({ bots: [ZELLO], autoReply: false });
    await t.say('switch to Tommy');
    check('listen mode: no name, single bot → switches', t.voiceOf('z') === 'Tommy.wav', t.voiceOf('z'));
    check(
      'listen mode: confirmation transmitted (manual TX)',
      t.tx.some((x) => x.id === 'z' && x.manual) && t.spoken.at(-1)?.voice === 'Tommy.wav'
    );
    check('listen mode: no LLM', t.llm.length === 0);
    t.svc.voiceChangeAt.clear();
    await t.say('what a lovely day');
    check('listen mode: normal speech ignored, no TX', t.voiceOf('z') === 'Tommy.wav' && t.tx.length === 1);
  }

  // Typed text, no name
  {
    const t = makeService({ bots: [ZELLO] });
    await t.type('become sugar');
    check('typed: "become sugar" switches', t.voiceOf('z') === 'sugar.wav' && t.llm.length === 0, t.voiceOf('z'));
  }

  // No name, several bots → the one that spoke last
  {
    const t = makeService({ bots: [ZELLO, SUGAR] });
    t.svc.botLastSpokeAt.set('z', Date.now() - 60000);
    t.svc.botLastSpokeAt.set('s', Date.now() - 5000);
    await t.say('switch to Tommy');
    check(
      'multi-bot no name: last speaker (Sugar) switches, ZELLO+AI untouched',
      t.voiceOf('s') === 'Tommy.wav' && t.voiceOf('z') === 'ghost.wav',
      's=' + t.voiceOf('s') + ' z=' + t.voiceOf('z')
    );
    check('multi-bot: reply came from Sugar', t.tx.at(-1)?.id === 's' && t.llm.length === 0);

    t.svc.voiceChangeAt.clear();
    await t.say('Zello AI talk like trump');
    check(
      'multi-bot named: ZELLO+AI switches even though Sugar spoke last',
      t.voiceOf('z') === 'trump.wav' && t.voiceOf('s') === 'Tommy.wav'
    );

    t.svc.voiceChangeAt.clear();
    t.svc.botLastSpokeAt.set('s', Date.now() + 1000);
    await t.say('Hello AI switch to abby');
    check('multi-bot: "Hello AI" (STT of Zello AI) addresses ZELLO+AI', t.voiceOf('z') === 'abby.wav', 'z=' + t.voiceOf('z'));

    t.svc.voiceChangeAt.clear();
    await t.say('Sugar be Doctor Strange');
    check('multi-bot named: Sugar → Doctor Strange', t.voiceOf('s') === 'Doctor Strange.wav', t.voiceOf('s'));
  }

  // Non-triggers go to chat; explicit unknown voice refuses; cooldown
  {
    const t = makeService({ bots: [ZELLO] });
    await t.say('switch to English');
    check('"switch to English" → normal chat (LLM), voice unchanged', t.llm.length === 1 && t.voiceOf('z') === 'ghost.wav');
    await t.say('go to bed');
    check('"go to bed" → normal chat', t.llm.length === 2 && t.voiceOf('z') === 'ghost.wav');

    await t.say('change your voice to darth vader');
    check(
      'explicit unknown voice → spoken refusal, nothing saved, no LLM',
      t.voiceOf('z') === 'ghost.wav' && t.llm.length === 2 && /don't have/.test(t.spoken.at(-1)?.text || ''),
      JSON.stringify(t.spoken.at(-1))
    );

    t.svc.voiceChangeAt.clear();
    await t.say('switch to Leanne');
    const n = t.spoken.length;
    await t.say('switch to abby');
    check(
      'cooldown: second switch within 10 s ignored (and not sent to LLM)',
      t.voiceOf('z') === 'Leanne44.wav' && t.spoken.length === n && t.llm.length === 2
    );
  }

  // A bot's own transmission must never switch voices
  {
    const t = makeService({ bots: [ZELLO, SUGAR] });
    await t.svc.tryHandleVoiceChangeEarly({
      transcript: 'switch to Tommy',
      config: await t.svc.getLiveConfiguration(),
      stream: { from: 'SugarBot', channel: 'Test' }
    });
    check('peer bot saying "switch to Tommy" is ignored', t.voiceOf('s') === 'sugar.wav' && t.voiceOf('z') === 'ghost.wav');
  }
}

serviceChecks()
  .catch((err) => {
    fail += 1;
    console.log('FAIL service checks threw: ' + (err && err.stack ? err.stack : err));
  })
  .finally(() => {
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  });
