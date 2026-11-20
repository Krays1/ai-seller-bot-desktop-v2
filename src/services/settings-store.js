const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SETTINGS = Object.freeze({
  zello: {
    channelName: '',
    channelNames: [],
    botUsername: '',
    password: '',
    token: '',
    // F&F only: logon with JWT alone (no username/password), listen_only
    anonymousListen: false
  },

  ai: {
    ollamaUrl: 'http://127.0.0.1:11434',
    ollamaUrlThisPc: 'http://127.0.0.1:11434',
    ollamaUrlOtherPc: 'http://192.168.1.92:11434',
    llmHostMode: 'other-pc',
    model: 'wizard-vicuna-uncensored:7b',
    identityName: 'Bot',
    autoReply: true,
    behaviorMode: 'banter'
  },

  speech: {
    sttMode: 'http',
    sttUrl: 'http://127.0.0.1:9000/v1/audio/transcriptions',
    ttsProvider: 'omnivoice',
    omnivoiceUrl: 'http://127.0.0.1:8002',
    omnivoiceVoice: '',
    omnivoiceSpeed: 1,
    omnivoiceSteps: 6,
    voicesDir: ''
  },

  catalog: {
    accounts: [],
    channels: [],
    voices: [],
    voicesDir: '',
    wallRoot: ''
  },

  bots: [],

  multiBot: {
    replyMode: 'random',
    preferredBotId: '',
    cooldownMs: 0,
    allowPeerChat: true,
    peerChatChance: 0.9,
    maxFighters: 3,
    chatMode: 'banter',
    // Keep well under Zello's ~19–20s channel talk-cap so cut-in/regrab
    // doesn't land on a near-cap knock-off (Downloads had no force-cap).
    maxUserTalkMs: 8000,
    cutInWhenCapped: true,
    botSpeakTargetSec: 10,
    memoryDepth: 24,
    interruptReset: true,
    grabMode: false,
    grabOnly: false,
    constantBotId: '',
    nameCallQuietMs: 45000
  },

  // Stable Diffusion (Forge/A1111) — "Sugar show us a cat"
  imageGen: {
    enabled: true,
    webuiUrl: 'http://127.0.0.1:7860',
    steps: 20,
    width: 512,
    height: 512,
    cfgScale: 7,
    sampler: 'Euler a',
    cooldownSec: 0,
    timeoutSec: 120,
    saveDir: ''
  },

  // Incoming Zello photos → Ollama vision describe + speak (off by default — heavy on GPU)
  vision: {
    enabled: false,
    autoDescribe: false,
    model: 'qwen2.5vl:3b',
    maxChars: 280,
    timeoutMs: 90000
  },

  // Live mic → character voice → chosen bot (Voice Changer tab)
  voiceChanger: {
    botId: '',
    voice: 'dsp:robot',
    mode: 'live',
    deviceId: '',
    pttKey: 'Space',
    test: false,
    converterUrl: 'http://127.0.0.1:8003',
    diffusionSteps: 0,
    blockMs: 0
  },

  // Live tab DJ mode (the ON/OFF state itself is never saved)
  dj: {
    botId: '',
    source: 'device',
    deviceId: '',
    sampleRate: 24000,
    musicVolume: 80,
    duckLevel: 20,
    voiceVolume: 100,
    voice: '',
    // Live hold-to-talk over music (Seed-VC / DSP) — separate from typed TTS voice
    vcMode: 'live',
    vcVoice: 'dsp:robot',
    vcDeviceId: '',
    djName: '',
    introLine: '',
    refreshSec: 50,
    quickLines: [
      "You're locked in to the live mix — keep it here.",
      'That one goes out to everybody on the channel tonight.',
      'Requests are open — just say play and the song name.',
      'Turn it up! More music coming right up.',
      'Big shout out to everyone listening.',
      'Stay tuned, the next one is a banger.'
    ]
  }
});

const CHAT_FLOW_MODES = new Set([
  'chat',
  'banter',
  'argument',
  'extreme'
]);

function normalizeChatMode(mode) {
  const raw = String(mode || '').trim().toLowerCase();
  const legacy = {
    nice: 'chat',
    annoyed: 'banter',
    angry: 'argument'
  };
  const mapped = legacy[raw] || raw;
  return CHAT_FLOW_MODES.has(mapped) ? mapped : 'banter';
}

class SettingsStore {
  constructor(userDataPath) {
    this.filePath = path.join(
      userDataPath,
      'settings.json'
    );
  }

  ensureFile() {
    if (!fs.existsSync(this.filePath)) {
      this.write(DEFAULT_SETTINGS);
    }
  }

  read() {
    this.ensureFile();

    try {
      const raw = fs.readFileSync(
        this.filePath,
        'utf8'
      );

      return this.sanitize(
        JSON.parse(raw)
      );
    } catch {
      return this.sanitize(
        DEFAULT_SETTINGS
      );
    }
  }

  write(settings) {
    const sanitized =
      this.sanitize(settings);

    fs.mkdirSync(
      path.dirname(this.filePath),
      { recursive: true }
    );

    fs.writeFileSync(
      this.filePath,
      JSON.stringify(
        sanitized,
        null,
        2
      ),
      'utf8'
    );

    return sanitized;
  }

  sanitize(settings) {
    const input =
      settings &&
      typeof settings === 'object'
        ? settings
        : {};

    const zello =
      input.zello &&
      typeof input.zello === 'object'
        ? input.zello
        : {};

    const ai =
      input.ai &&
      typeof input.ai === 'object'
        ? input.ai
        : {};

    const speech =
      input.speech &&
      typeof input.speech === 'object'
        ? input.speech
        : {};

    const catalog =
      input.catalog &&
      typeof input.catalog === 'object'
        ? input.catalog
        : {};

    const requestedModel =
      this.cleanText(
        ai.model,
        200
      );

    const model =
      !requestedModel ||
      requestedModel === 'gpt-5.6-luna' ||
      /vl\b/i.test(requestedModel)
        ? 'wizard-vicuna-uncensored:7b'
        : requestedModel;

    const speedNumber =
      Number(
        speech.omnivoiceSpeed
      );

    const stepsNumber =
      Number(
        speech.omnivoiceSteps
      );

    const llmHostMode =
      ['this-pc', 'other-pc', 'auto'].includes(
        ai.llmHostMode
      )
        ? ai.llmHostMode
        : 'other-pc';

    const ollamaUrlThisPc =
      this.cleanText(ai.ollamaUrlThisPc, 1000) ||
      'http://127.0.0.1:11434';

    const ollamaUrlOtherPc =
      this.cleanText(ai.ollamaUrlOtherPc, 1000) ||
      'http://192.168.1.92:11434';

    let ollamaUrl =
      this.cleanText(ai.ollamaUrl, 1000) ||
      ollamaUrlOtherPc;

    if (llmHostMode === 'this-pc') {
      ollamaUrl = ollamaUrlThisPc;
    } else if (llmHostMode === 'other-pc') {
      ollamaUrl = ollamaUrlOtherPc;
    } else {
      // auto: prefer Other PC until live probe runs
      ollamaUrl = ollamaUrlOtherPc;
    }

    const projectVoices = path.join(
      path.resolve(__dirname, '..', '..'),
      'omnivoice voices'
    );

    const voicesDir =
      this.cleanText(speech.voicesDir, 1000) ||
      this.cleanText(catalog.voicesDir, 1000) ||
      (fs.existsSync(projectVoices)
        ? projectVoices
        : '');

    const bots = this.sanitizeBots(input.bots);

    let channelName = this.cleanText(zello.channelName, 200);
    const channelNames = this.sanitizeChannelNames(
      [
        ...(Array.isArray(zello.channelNames)
          ? zello.channelNames
          : []),
        ...bots.map((b) => b.channelName)
      ],
      channelName
    );
    if (!channelName && channelNames.length) {
      channelName = channelNames[0];
    }

    return {
      ...input,

      zello: {
        channelName,

        channelNames,

        botUsername: this.cleanText(
          zello.botUsername,
          200
        ),

        password: this.cleanSecret(
          zello.password,
          1000
        ),

        token: this.cleanSecret(
          zello.token,
          4000
        ),

        anonymousListen: zello.anonymousListen === true
      },

      ai: {
        ollamaUrl,
        ollamaUrlThisPc,
        ollamaUrlOtherPc,
        llmHostMode,

        model,

        identityName:
          this.cleanText(
            ai.identityName,
            120
          ) ||
          'Bot',

        autoReply:
          ai.autoReply !== false,

        behaviorMode: normalizeChatMode(
          ai.behaviorMode ||
            (input.multiBot && input.multiBot.chatMode)
        )
      },

      speech: {
        sttMode: 'http',

        sttUrl:
          this.cleanText(
            speech.sttUrl,
            1000
          ) ||
          'http://127.0.0.1:9000/v1/audio/transcriptions',

        ttsProvider:
          'omnivoice',

        omnivoiceUrl:
          this.cleanText(
            speech.omnivoiceUrl,
            1000
          ) ||
          'http://127.0.0.1:8002',

        omnivoiceVoice:
          this.cleanText(
            speech.omnivoiceVoice,
            500
          ),

        omnivoiceSpeed:
          Number.isFinite(speedNumber)
            ? Math.min(
                4,
                Math.max(
                  0.25,
                  speedNumber
                )
              )
            : 1,

        omnivoiceSteps:
          Number.isFinite(stepsNumber)
            ? Math.min(
                64,
                Math.max(
                  4,
                  Math.round(
                    stepsNumber
                  )
                )
              )
            : 6,

        autoCaptureVoices: speech.autoCaptureVoices === true,
        autoSwitchToNewVoice: speech.autoSwitchToNewVoice === true,

        voicesDir
      },

      catalog: {
        accounts: Array.isArray(catalog.accounts)
          ? catalog.accounts
          : [],
        channels: Array.isArray(catalog.channels)
          ? catalog.channels
          : [],
        voices: Array.isArray(catalog.voices)
          ? catalog.voices
          : [],
        voicesDir,
        wallRoot: this.cleanText(
          catalog.wallRoot,
          1000
        )
      },

      bots,

      multiBot: this.sanitizeMultiBot(input.multiBot),

      imageGen: this.sanitizeImageGen(input.imageGen),

      vision: this.sanitizeVision(input.vision),

      voiceChanger: this.sanitizeVoiceChanger(input.voiceChanger),

      dj: this.sanitizeDj(input.dj)
    };
  }

  sanitizeDj(raw) {
    const input =
      raw && typeof raw === 'object' ? raw : {};
    const defaults = DEFAULT_SETTINGS.dj;
    const pct = (value, max, fallback) => {
      const n = Math.round(Number(value));
      return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : fallback;
    };
    const lines = Array.isArray(input.quickLines)
      ? input.quickLines
      : defaults.quickLines;
    const quickLines = [];
    for (let i = 0; i < 6; i += 1) {
      quickLines.push(
        typeof lines[i] === 'string'
          ? lines[i].replace(/\s+/g, ' ').trim().slice(0, 300)
          : ''
      );
    }
    const refresh = Math.round(Number(input.refreshSec));
    return {
      botId: this.cleanText(input.botId, 80),
      source: ['device', 'system', 'app'].includes(input.source)
        ? input.source
        : defaults.source,
      deviceId: this.cleanText(input.deviceId, 300),
      sampleRate: [16000, 24000, 48000].includes(Number(input.sampleRate))
        ? Number(input.sampleRate)
        : defaults.sampleRate,
      musicVolume: pct(input.musicVolume, 150, defaults.musicVolume),
      duckLevel: pct(input.duckLevel, 100, defaults.duckLevel),
      voiceVolume: pct(input.voiceVolume, 150, defaults.voiceVolume),
      voice: this.cleanText(input.voice, 500),
      vcMode: input.vcMode === 'repeat' ? 'repeat' : 'live',
      vcVoice: this.cleanText(input.vcVoice, 500) || defaults.vcVoice,
      vcDeviceId: this.cleanText(input.vcDeviceId, 300),
      djName: this.cleanText(input.djName, 80),
      introLine: this.cleanText(input.introLine, 300),
      // Keep under the channel's max message length
      refreshSec:
        Number.isFinite(refresh) && refresh >= 10 && refresh <= 85
          ? refresh
          : defaults.refreshSec,
      quickLines
    };
  }

  sanitizeVoiceChanger(raw) {
    const input =
      raw && typeof raw === 'object' ? raw : {};
    const defaults = DEFAULT_SETTINGS.voiceChanger;
    const intIn = (value, min, max) => {
      const n = Math.round(Number(value));
      return Number.isFinite(n) && n >= min && n <= max ? n : 0;
    };
    return {
      botId: this.cleanText(input.botId, 80),
      voice: this.cleanText(input.voice, 300) || defaults.voice,
      mode: input.mode === 'repeat' ? 'repeat' : 'live',
      deviceId: this.cleanText(input.deviceId, 300),
      pttKey: this.cleanText(input.pttKey, 40) || defaults.pttKey,
      test: input.test === true,
      converterUrl:
        this.cleanText(input.converterUrl, 300) ||
        defaults.converterUrl,
      // 0 = server default
      diffusionSteps: intIn(input.diffusionSteps, 1, 30),
      blockMs: intIn(input.blockMs, 80, 1000)
    };
  }

  sanitizeImageGen(raw) {
    const input =
      raw && typeof raw === 'object' ? raw : {};
    const defaults = DEFAULT_SETTINGS.imageGen;
    return {
      enabled: input.enabled !== false,
      webuiUrl:
        this.cleanText(input.webuiUrl, 200) ||
        defaults.webuiUrl,
      steps: Math.min(
        60,
        Math.max(
          4,
          Math.round(
            Number.isFinite(Number(input.steps))
              ? Number(input.steps)
              : defaults.steps
          )
        )
      ),
      width: Math.min(
        1024,
        Math.max(
          256,
          Math.round(
            Number.isFinite(Number(input.width))
              ? Number(input.width)
              : defaults.width
          )
        )
      ),
      height: Math.min(
        1024,
        Math.max(
          256,
          Math.round(
            Number.isFinite(Number(input.height))
              ? Number(input.height)
              : defaults.height
          )
        )
      ),
      cfgScale: Math.min(
        20,
        Math.max(
          1,
          Number.isFinite(Number(input.cfgScale))
            ? Number(input.cfgScale)
            : defaults.cfgScale
        )
      ),
      sampler:
        this.cleanText(input.sampler, 40) ||
        defaults.sampler,
      cooldownSec: Math.min(
        300,
        Math.max(
          0,
          Math.round(
            Number.isFinite(Number(input.cooldownSec))
              ? Number(input.cooldownSec)
              : defaults.cooldownSec
          )
        )
      ),
      timeoutSec: Math.min(
        300,
        Math.max(
          15,
          Math.round(
            Number.isFinite(Number(input.timeoutSec))
              ? Number(input.timeoutSec)
              : defaults.timeoutSec
          )
        )
      ),
      saveDir: this.cleanText(input.saveDir, 1000)
    };
  }

  sanitizeVision(raw) {
    const input =
      raw && typeof raw === 'object' ? raw : {};
    const defaults = DEFAULT_SETTINGS.vision;
    return {
      enabled:
        typeof input.enabled === 'boolean'
          ? input.enabled
          : defaults.enabled === true,
      autoDescribe:
        typeof input.autoDescribe === 'boolean'
          ? input.autoDescribe
          : defaults.autoDescribe === true,
      model:
        this.cleanText(input.model, 80) ||
        defaults.model,
      maxChars: Math.min(
        600,
        Math.max(
          80,
          Math.round(
            Number.isFinite(Number(input.maxChars))
              ? Number(input.maxChars)
              : defaults.maxChars
          )
        )
      ),
      timeoutMs: Math.min(
        180000,
        Math.max(
          15000,
          Math.round(
            Number.isFinite(Number(input.timeoutMs))
              ? Number(input.timeoutMs)
              : defaults.timeoutMs
          )
        )
      )
    };
  }

  sanitizeBots(raw) {
    if (!Array.isArray(raw)) {
      return [];
    }

    // Never allow the friend's original demo account as a live bot
    const blocked = new Set([
      'f0rd p0wer',
      'ford power',
      'f0rd',
      'mbm'
    ]);

    return raw
      .map((bot) => {
        if (!bot || typeof bot !== 'object') {
          return null;
        }

        const id = this.cleanText(bot.id, 80);
        const username = this.cleanText(bot.username, 200);
        if (!id || !username) {
          return null;
        }

        if (blocked.has(username.toLowerCase())) {
          return null;
        }

        return {
          id,
          enabled: bot.enabled !== false,
          canSpeak: bot.canSpeak !== false,
          // Name-call: respond when mentioned; Speak/free-talk overrides this
          calledByName: bot.calledByName === true,
          username,
          password: this.cleanSecret(bot.password, 1000),
          token: this.cleanSecret(bot.token, 4000),
          identityName:
            this.cleanText(bot.identityName, 120) ||
            username,
          omnivoiceVoice: this.cleanText(
            bot.omnivoiceVoice,
            500
          ),
          // Empty = use primary/global channel
          channelName: this.cleanText(bot.channelName, 200),
          behaviorMode: normalizeChatMode(
            bot.behaviorMode
          )
        };
      })
      .filter(Boolean);
  }

  sanitizeMultiBot(raw) {
    const input =
      raw && typeof raw === 'object' ? raw : {};

    const chatMode = normalizeChatMode(
      input.chatMode || input.behaviorMode
    );
    const aggressive =
      chatMode === 'banter' ||
      chatMode === 'argument' ||
      chatMode === 'extreme';

    return {
      replyMode: [
        'roundRobin',
        'preferred',
        'random'
      ].includes(input.replyMode)
        ? input.replyMode
        : 'random',
      preferredBotId: this.cleanText(
        input.preferredBotId,
        80
      ),
      cooldownMs: Math.min(
        60000,
        Math.max(
          0,
          Number.isFinite(Number(input.cooldownMs))
            ? Number(input.cooldownMs)
            : aggressive
              ? 0
              : 200
        )
      ),
      allowPeerChat: input.allowPeerChat !== false,
      peerChatChance: Math.min(
        1,
        Math.max(
          0,
          Number.isFinite(Number(input.peerChatChance))
            ? Number(input.peerChatChance)
            : 0.9
        )
      ),
      maxFighters: Math.min(
        12,
        Math.max(
          1,
          Math.round(Number(input.maxFighters) || 3)
        )
      ),
      chatMode,
      maxUserTalkMs: Math.min(
        120000,
        Math.max(
          3000,
          Math.round(
            Number.isFinite(Number(input.maxUserTalkMs))
              ? Number(input.maxUserTalkMs)
              : 8000
          )
        )
      ),
      cutInWhenCapped: input.cutInWhenCapped !== false,
      botSpeakTargetSec: Math.min(
        90,
        Math.max(
          5,
          Math.round(
            Number.isFinite(Number(input.botSpeakTargetSec))
              ? Number(input.botSpeakTargetSec)
              : 10
          )
        )
      ),
      memoryDepth: Math.min(
        120,
        Math.max(
          8,
          Math.round(
            Number.isFinite(Number(input.memoryDepth))
              ? Number(input.memoryDepth)
              : 24
          )
        )
      ),
      interruptReset: input.interruptReset !== false,
      grabMode: input.grabMode === true,
      // Grab the button but never reply — hold briefly with silence, then let go
      grabOnly: input.grabMode === true && input.grabOnly === true,
      // Live tab "Constant requests" bot (the ON/OFF toggle itself is never saved)
      constantBotId:
        input.constantBotId === undefined || input.constantBotId === null
          ? ''
          : String(input.constantBotId).trim().slice(0, 64),
      // After a name-call conversation, silence this long ends engagement
      nameCallQuietMs: Math.min(
        180000,
        Math.max(
          5000,
          Math.round(
            Number.isFinite(Number(input.nameCallQuietMs))
              ? Number(input.nameCallQuietMs)
              : 45000
          )
        )
      )
    };
  }

  sanitizeChannelNames(rawNames, primaryName) {
    const out = [];
    const seen = new Set();
    const push = (value) => {
      const name = this.cleanText(value, 200);
      if (!name) return;
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(name);
    };

    if (Array.isArray(rawNames)) {
      for (const item of rawNames) {
        if (typeof item === 'string') {
          push(item);
        } else if (item && typeof item === 'object') {
          push(item.name || item.key || '');
        }
      }
    }

    push(primaryName);

    return out;
  }

  cleanText(value, maxLength) {
    if (typeof value !== 'string') {
      return '';
    }

    return value
      .trim()
      .slice(0, maxLength);
  }

  cleanSecret(value, maxLength) {
    if (typeof value !== 'string') {
      return '';
    }

    return value.slice(
      0,
      maxLength
    );
  }
}

module.exports = {
  SettingsStore,
  DEFAULT_SETTINGS,
  CHAT_FLOW_MODES,
  normalizeChatMode
};