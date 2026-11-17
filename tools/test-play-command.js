/**
 * Checks for the YouTube music channel command
 * ("play rabbit in the box" / "bot play …" / "blah. But play, X." / "stop the music").
 * Run: node tools/test-play-command.js
 */
const {
  findPlayCommand,
  parseStopCommand
} = require('../src/services/bot-commands');

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) pass += 1;
  else fail += 1;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (detail ? '  → ' + detail : ''));
}

// [whole utterance, expected YouTube query, or null = must stay normal chat]
const parserCases = [
  // the two live transcripts that went to the LLM
  ['But play rabbit in a box, drum and bass.', 'rabbit in a box drum and bass'],
  [
    'He always thinks I say fucking bot instead of bot. Bot, play, rabbit in the box.',
    'rabbit in the box'
  ],
  // phrasings
  ['play rabbit in the box', 'rabbit in the box'],
  ['bot play rabbit in the box', 'rabbit in the box'],
  ['but play rabbit in the box', 'rabbit in the box'],
  ['bought play rabbit in the box', 'rabbit in the box'],
  ['Bot, play rabbit in the box.', 'rabbit in the box'],
  ['play, rabbit in the box', 'rabbit in the box'],
  ['can you play rabbit in the box', 'rabbit in the box'],
  ['could you please play rabbit in the box?', 'rabbit in the box'],
  ['go on, play rabbit in the box', 'rabbit in the box'],
  ['put on rabbit in the box', 'rabbit in the box'],
  ['stick on rabbit in the box', 'rabbit in the box'],
  ['play me rabbit in the box', 'rabbit in the box'],
  ['play some drum and bass', 'drum and bass'],
  ['AI play rabbit in the box', 'rabbit in the box'],
  ['Hey bot, can you put on some jungle please', 'jungle'],
  ["play don't stop me now", "don't stop me now"],
  ['Play Mr. Brightside.', 'Mr Brightside'],
  // trailing filler stripped
  ['play rabbit in the box please', 'rabbit in the box'],
  ['play rabbit in the box for me', 'rabbit in the box'],
  ['play rabbit in the box on youtube', 'rabbit in the box'],
  ['play rabbit in the box for me please.', 'rabbit in the box'],
  ['bot play rabbit in the box by andy c from youtube thanks', 'rabbit in the box by andy c'],
  // command as the last sentence of a longer utterance
  ['That was a good tune. Anyway. Play rabbit in the box.', 'rabbit in the box'],
  ['blah blah. Bot, play, rabbit in the box.', 'rabbit in the box'],
  // must NOT trigger
  ['I play football on Sundays', null],
  ['we play every Tuesday', null],
  ['did you play that game', null],
  ['do you play guitar', null],
  ['the play was good', null],
  ['role play', null],
  ["let's play a game", null],
  ['bot play a game', null],
  ['play it again', null],
  ['play it cool', null],
  ['play with me', null],
  ['can you play guitar?', null],
  ['play 4', null],
  ['bot play chess', null],
  ['put on your coat', null],
  ['put on the kettle', null],
  ['He was playing rabbit in the box', null],
  ['player one ready', null],
  ['stop the music', null]
];

for (const [text, expected] of parserCases) {
  const cmd = findPlayCommand(text);
  if (expected === null) {
    check('"' + text + '" stays chat', !cmd, cmd ? 'parsed "' + cmd.query + '"' : '');
    continue;
  }
  check('"' + text + '"', cmd?.query === expected, cmd ? 'query "' + cmd.query + '"' : 'not parsed');
}

console.log('');
for (const text of [
  'stop',
  'stop.',
  'stop the music',
  'stop the music please',
  'stop music',
  'stop the song',
  'stop playing',
  'cancel the music',
  'but stop the music',
  'turn the music off',
  'music off'
]) {
  check('"' + text + '" is stop', Boolean(parseStopCommand(text)));
}
for (const text of ["don't stop me now", 'play rabbit in the box', 'the music is great']) {
  check('"' + text + '" is not stop', !parseStopCommand(text));
}

// ---------------------------------------------------------------------------
// End-to-end through VoiceBotService: in-memory settings, stubbed STT/TTS/Zello/LLM/YouTube
// (no network, no real settings file, nothing downloaded)
const { VoiceBotService } = require('../src/services/voice-bot-service');

function makeService({ bots, autoReply = true, holdDownload = false }) {
  const stored = {
    bots: bots.map((b) => ({ enabled: true, canSpeak: true, channelName: '', ...b })),
    multiBot: { cutInWhenCapped: true },
    speech: {}
  };
  const settingsStore = {
    read: () => JSON.parse(JSON.stringify(stored)),
    write: () => stored
  };
  const tx = [];
  const llm = [];
  const plays = [];
  const texts = [];
  let aborts = 0;
  let releaseDownload = null;
  const zr = {
    getStatus: () => ({
      bots: stored.bots.map((b) => ({ id: b.id, status: 'connected', channelName: 'Test' }))
    }),
    sendPcmAs: async (id, pcm, options) => {
      tx.push({ id, manual: options?.manual === true });
      return { ok: true };
    },
    sendTextAs: async (id, text) => {
      texts.push({ id, text });
    },
    abortAllTx: () => {
      aborts += 1;
      svc._youtubePlaying = false;
    },
    seizeAndSpeak: async (id, producePcm) => {
      const out = await producePcm();
      if (out && out.commandHandled) return { ok: true, commandHandled: true };
      tx.push({ id, manual: false, llm: true });
      return { ok: true };
    }
  };
  const svc = new VoiceBotService({ settingsStore, zelloRuntimeService: zr });
  svc.listOmniVoiceVoices = async () => [];
  svc.loadChannelExtras = async () => ({
    handleExtrasCommand: async () => null,
    handleYouTubePlay: async ({ query }) => {
      plays.push(query);
      if (holdDownload) await new Promise((r) => (releaseDownload = r));
      return { handled: true, text: 'Playing: ' + query, wavPath: 'fake.zello.wav' };
    }
  });
  svc.transmitWavFile = async (bot, cfg, wavPath, options) => {
    tx.push({ id: cfg.activeBotId, manual: options?.manual === true, music: true });
    return { ok: true };
  };
  svc.synthesizeSpeech = async () => Buffer.alloc(320);
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
  const say = (text, from = 'krays-1.') => {
    svc.transcribePcm = async () => text;
    return svc.handleCompletedStream({ from, channel: 'Test', packets: [] });
  };
  const type = (text, from = 'krays-1.') =>
    svc.handleCompletedStream({
      from,
      channel: 'Test',
      textTranscript: text,
      isChannelText: true,
      packets: []
    });
  return {
    svc,
    say,
    type,
    tx,
    llm,
    plays,
    texts,
    aborts: () => aborts,
    release: () => releaseDownload && releaseDownload()
  };
}

const ZELLO = { id: 'z', username: 'zelloai_bot', identityName: 'ZELLO+AI' };
const SUGAR = { id: 's', username: 'SugarBot', identityName: 'Sugar' };
const music = (t) => t.tx.filter((x) => x.music);

async function serviceChecks() {
  console.log('');

  // The exact live failures: free-talk ZELLO+AI, spoken, button-race path
  for (const heard of [
    'But play rabbit in a box, drum and bass.',
    'He always thinks I say fucking bot instead of bot. Bot, play, rabbit in the box.'
  ]) {
    const t = makeService({ bots: [ZELLO] });
    await t.say(heard);
    check('live: "' + heard.slice(0, 50) + '…" searches YouTube', t.plays.length === 1, JSON.stringify(t.plays));
    check('live: music transmitted by ZELLO+AI', music(t).length === 1 && music(t)[0].id === 'z');
    check('live: not sent to the LLM', t.llm.length === 0, 'llm calls ' + t.llm.length);
    check('live: "Playing:" posted as channel text', /^Playing: /.test(t.texts.at(-1)?.text || ''));
  }

  // Named, multi-word identity heard as "Zello AI"
  {
    const t = makeService({ bots: [ZELLO, SUGAR] });
    t.svc.botLastSpokeAt.set('s', Date.now());
    await t.say('Zello AI play rabbit in the box');
    check(
      '"Zello AI play …" → ZELLO+AI plays even though Sugar spoke last',
      t.plays[0] === 'rabbit in the box' && music(t)[0]?.id === 'z' && t.llm.length === 0,
      JSON.stringify({ plays: t.plays, tx: t.tx })
    );
    await t.say('Sugar, put on some jungle');
    check('"Sugar, put on some jungle" → Sugar plays "jungle"', t.plays[1] === 'jungle' && music(t)[1]?.id === 's');
  }

  // No name, several bots → the one that spoke last
  {
    const t = makeService({ bots: [ZELLO, SUGAR] });
    t.svc.botLastSpokeAt.set('z', Date.now() - 60000);
    t.svc.botLastSpokeAt.set('s', Date.now() - 5000);
    await t.say('play rabbit in the box');
    check('multi-bot no name: last speaker (Sugar) plays', music(t)[0]?.id === 's' && t.llm.length === 0);
  }

  // Listen mode (autoReply off) — still plays, manual TX, no LLM
  {
    const t = makeService({ bots: [{ ...ZELLO, canSpeak: false }], autoReply: false });
    await t.say('bot play rabbit in the box');
    check(
      'listen mode: plays with manual TX',
      t.plays[0] === 'rabbit in the box' && music(t)[0]?.manual === true,
      JSON.stringify(t.tx)
    );
    check('listen mode: no LLM', t.llm.length === 0);
    await t.say('I play football on Sundays');
    check('listen mode: normal speech ignored', t.plays.length === 1 && t.tx.length === 1);
  }

  // Typed text
  {
    const t = makeService({ bots: [ZELLO] });
    await t.type('play rabbit in the box');
    check('typed: "play rabbit in the box" plays', t.plays[0] === 'rabbit in the box' && t.llm.length === 0);
  }

  // Non-triggers go to normal chat
  {
    const t = makeService({ bots: [ZELLO] });
    for (const heard of ['I play football on Sundays', 'did you play that game', 'the play was good']) {
      await t.say(heard);
    }
    check('non-triggers → LLM, nothing played', t.plays.length === 0 && t.llm.length === 3, 'llm ' + t.llm.length);
  }

  // "stop the music" while a song is on air
  {
    const t = makeService({ bots: [ZELLO] });
    t.svc._youtubePlaying = true;
    await t.say('stop the music');
    check('"stop the music" while playing → TX cut, no LLM', t.aborts() === 1 && t.llm.length === 0);
    check('stop: "Stopped." posted', t.texts.at(-1)?.text === 'Stopped.');
  }

  // "stop" while the song is still downloading → it never goes on air
  {
    const t = makeService({ bots: [ZELLO], autoReply: false, holdDownload: true });
    const playing = t.say('play rabbit in the box');
    await new Promise((r) => setTimeout(r, 20));
    await t.say('bot stop');
    t.release();
    await playing;
    check('stop during download → nothing transmitted', t.plays.length === 1 && music(t).length === 0, JSON.stringify(t.tx));
  }

  // Plain "stop" with no music falls through to the normal flow (not swallowed early)
  {
    const t = makeService({ bots: [ZELLO] });
    const handled = await t.svc.tryHandleEarlyCommands({
      transcript: 'stop',
      config: await t.svc.getLiveConfiguration(),
      stream: { from: 'krays-1.', channel: 'Test' }
    });
    check('"stop" with nothing playing is left to the normal stop handler', handled === false);
  }

  // A bot's own transmission must never trigger music
  {
    const t = makeService({ bots: [ZELLO, SUGAR] });
    await t.svc.tryHandleEarlyCommands({
      transcript: 'play rabbit in the box',
      config: await t.svc.getLiveConfiguration(),
      stream: { from: 'SugarBot', channel: 'Test' }
    });
    check('peer bot saying "play …" is ignored', t.plays.length === 0);
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
