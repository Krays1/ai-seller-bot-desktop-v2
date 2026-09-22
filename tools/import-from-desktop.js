/**
 * Import bots/channels/LLM paths from your mature Desktop APPDATA
 * into AI-Seller-Bot-Desktop v2 (isolated AppData folder).
 *
 * Re-import MERGES with existing settings:
 * - keeps your channel / multiBot / enabled ticks when possible
 * - enables ALL accounts by default (not just 3)
 *
 * Usage: node tools/import-from-desktop.js
 * Optional: set FORCE_IMPORT=1 / seed from v1 AppData if v2 settings missing.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DESKTOP_CFG = path.join(
  process.env.APPDATA || '',
  'zello-bot-desktop',
  'zello-bot-data',
  'desktop-config.json'
);
const OUT_CATALOG = path.join(ROOT, 'config', 'imported-catalog.json');
const OUT_SETTINGS = path.join(
  process.env.APPDATA || '',
  'ai-seller-bot-desktop-v2',
  'settings.json'
);
const V1_SETTINGS = path.join(
  process.env.APPDATA || '',
  'ai-seller-bot-desktop',
  'settings.json'
);
const VOICES_DIR = path.join(ROOT, 'omnivoice voices');

function readExisting() {
  try {
    if (fs.existsSync(OUT_SETTINGS)) {
      const cur = JSON.parse(fs.readFileSync(OUT_SETTINGS, 'utf8')) || {};
      const bots = Array.isArray(cur.bots) ? cur.bots : [];
      // Empty v2 shell → merge from v1 roster if available
      if (bots.length === 0 && fs.existsSync(V1_SETTINGS)) {
        console.log('v2 settings empty — seeding merge from v1:', V1_SETTINGS);
        try {
          return JSON.parse(fs.readFileSync(V1_SETTINGS, 'utf8')) || {};
        } catch {
          return cur;
        }
      }
      return cur;
    }
    // First v2 boot: seed merge base from v1 settings if present
    if (fs.existsSync(V1_SETTINGS)) {
      console.log('Seeding v2 merge from v1 settings:', V1_SETTINGS);
      return JSON.parse(fs.readFileSync(V1_SETTINGS, 'utf8')) || {};
    }
    return {};
  } catch {
    return {};
  }
}

function main() {
  if (!fs.existsSync(DESKTOP_CFG)) {
    console.error('Desktop config not found:', DESKTOP_CFG);
    process.exit(1);
  }

  const prev = readExisting();
  const data = JSON.parse(fs.readFileSync(DESKTOP_CFG, 'utf8'));
  const global = data.global || {};

  // Never import the friend's original demo Zello login as a bot.
  const blockedUsernames = new Set([
    'f0rd p0wer',
    'ford power',
    'f0rd',
    'mbm'
  ]);

  const accounts = (data.accounts || [])
    .map((a) => ({
      id: String(a.id ?? ''),
      label: a.label || a.username || String(a.id ?? ''),
      username: a.username || '',
      password: a.password || '',
      token: a.devToken || a.dev_token || '',
    }))
    .filter(
      (a) =>
        a.id &&
        a.username &&
        a.password &&
        a.token &&
        !blockedUsernames.has(String(a.username).toLowerCase())
    );

  const channels = (data.channels || []).map((c, i) => ({
    key: String(c.key || c.name || `ch${i}`),
    name: String(c.name || c.key || `ch${i}`),
    accountId: String(c.accountId || c.account_id || ''),
  }));

  const voiceFiles = fs.existsSync(VOICES_DIR)
    ? fs
        .readdirSync(VOICES_DIR)
        .filter((f) => f.toLowerCase().endsWith('.wav'))
        .sort((a, b) => a.localeCompare(b))
    : [];

  const voiceProfiles = data.voiceProfiles || {};
  const prevBotsById = new Map(
    (Array.isArray(prev.bots) ? prev.bots : []).map((b) => [String(b.id), b])
  );

  // Enable ALL accounts. Only preserve ticks if user already had more than
  // the old accidental 3-bot default enabled.
  const prevEnabledCount = [...prevBotsById.values()].filter(
    (b) => b && b.enabled !== false
  ).length;
  const preserveTicks =
    prevBotsById.size > 0 && prevEnabledCount > 3;

  const bots = accounts.map((a, i) => {
    const profile = voiceProfiles[a.id] || {};
    const prevBot = prevBotsById.get(String(a.id));
    let voice =
      (prevBot && prevBot.omnivoiceVoice) ||
      profile.omnivoiceVoice ||
      '';
    if (!voice && voiceFiles.length) {
      voice = voiceFiles[i % voiceFiles.length];
    }

    const enabled = preserveTicks
      ? prevBot && typeof prevBot.enabled === 'boolean'
        ? prevBot.enabled
        : true
      : true;

    return {
      id: a.id,
      enabled,
      canSpeak:
        prevBot && typeof prevBot.canSpeak === 'boolean'
          ? prevBot.canSpeak
          : true,
      username: a.username,
      password: a.password,
      token: a.token,
      identityName:
        (prevBot && prevBot.identityName) ||
        a.label ||
        a.username,
      omnivoiceVoice: voice,
      behaviorMode:
        (prevBot && prevBot.behaviorMode) || 'nice',
    };
  });

  // If somehow none enabled, force all on
  if (!bots.some((b) => b.enabled)) {
    for (const b of bots) b.enabled = true;
  }

  const firstEnabled = bots.find((b) => b.enabled) || bots[0] || null;

  const prevChannel =
    typeof prev?.zello?.channelName === 'string'
      ? prev.zello.channelName.trim()
      : '';
  const channelName =
    prevChannel ||
    (channels[0] ? channels[0].name : '');

  let defaultVoice =
    (prev?.speech && prev.speech.omnivoiceVoice) ||
    firstEnabled?.omnivoiceVoice ||
    '';
  if (!defaultVoice && voiceFiles.length) {
    defaultVoice =
      voiceFiles.find((f) => /^abby\.wav$/i.test(f)) ||
      voiceFiles[0];
  }

  const catalog = {
    importedAt: new Date().toISOString(),
    source: DESKTOP_CFG,
    wallRoot: data.wallRoot || 'E:\\zello-wall-for-friend',
    voicesDir: VOICES_DIR,
    omnivoiceUrl: global.omnivoiceUrl || 'http://127.0.0.1:8002',
    ollamaUrlThisPc:
      global.ollamaUrlThisPc ||
      global.ollamaUrl ||
      'http://127.0.0.1:11434',
    ollamaUrlOtherPc:
      global.ollamaUrlOtherPc || 'http://192.168.1.92:11434',
    llmHostMode: global.llmHostMode || 'other-pc',
    model: global.model || 'gemma3:4b',
    accounts,
    channels,
    voices: voiceFiles,
  };

  fs.mkdirSync(path.dirname(OUT_CATALOG), { recursive: true });
  fs.writeFileSync(OUT_CATALOG, JSON.stringify(catalog, null, 2), 'utf8');

  const hostMode =
    (prev?.ai && prev.ai.llmHostMode) ||
    catalog.llmHostMode ||
    'other-pc';
  const ollamaUrlThisPc =
    (prev?.ai && prev.ai.ollamaUrlThisPc) || catalog.ollamaUrlThisPc;
  const ollamaUrlOtherPc =
    (prev?.ai && prev.ai.ollamaUrlOtherPc) || catalog.ollamaUrlOtherPc;
  const ollamaUrl =
    hostMode === 'this-pc' ? ollamaUrlThisPc : ollamaUrlOtherPc;

  const settings = {
    zello: {
      channelName,
      botUsername: firstEnabled ? firstEnabled.username : '',
      password: firstEnabled ? firstEnabled.password : '',
      token: firstEnabled ? firstEnabled.token : '',
    },
    ai: {
      ollamaUrl,
      ollamaUrlThisPc,
      ollamaUrlOtherPc,
      llmHostMode: hostMode,
      model: (prev?.ai && prev.ai.model) || catalog.model,
      identityName:
        (prev?.ai && prev.ai.identityName) ||
        (firstEnabled
          ? firstEnabled.identityName || firstEnabled.username
          : 'Bot'),
      autoReply: true,
      behaviorMode: (prev?.ai && prev.ai.behaviorMode) || 'nice',
    },
    speech: {
      sttMode: 'http',
      sttUrl:
        (prev?.speech && prev.speech.sttUrl) ||
        'http://127.0.0.1:9000/v1/audio/transcriptions',
      ttsProvider: 'omnivoice',
      omnivoiceUrl:
        (prev?.speech && prev.speech.omnivoiceUrl) ||
        catalog.omnivoiceUrl,
      omnivoiceVoice: defaultVoice,
      omnivoiceSpeed: 1,
      omnivoiceSteps:
        Number(prev?.speech?.omnivoiceSteps) ||
        Number(global.omnivoiceNumStep) ||
        10,
      voicesDir: VOICES_DIR,
    },
    bots,
    multiBot: {
      replyMode: (prev?.multiBot && prev.multiBot.replyMode) || 'random',
      preferredBotId:
        (prev?.multiBot && prev.multiBot.preferredBotId) ||
        (firstEnabled ? firstEnabled.id : ''),
      cooldownMs: Number(prev?.multiBot?.cooldownMs) || 400,
      allowPeerChat:
        prev?.multiBot?.allowPeerChat !== false,
      peerChatChance:
        Number.isFinite(Number(prev?.multiBot?.peerChatChance))
          ? Number(prev.multiBot.peerChatChance)
          : 0.9,
      maxFighters: Number(prev?.multiBot?.maxFighters) || 3,
    },
    catalog: {
      accounts: accounts.map((a) => ({ ...a })),
      channels,
      voices: voiceFiles,
      voicesDir: VOICES_DIR,
      wallRoot: catalog.wallRoot,
    },
  };

  fs.mkdirSync(path.dirname(OUT_SETTINGS), { recursive: true });
  fs.writeFileSync(OUT_SETTINGS, JSON.stringify(settings, null, 2), 'utf8');

  const enabledN = bots.filter((b) => b.enabled).length;
  console.log('Wrote', OUT_CATALOG);
  console.log('Wrote', OUT_SETTINGS);
  console.log(
    `  accounts=${accounts.length} channels=${channels.length} voices=${voiceFiles.length}`
  );
  console.log(`  bots enabled=${enabledN}/${bots.length} (ALL join when Connect)`);
  console.log(`  channel=${settings.zello.channelName}`);
  console.log(`  brain=${settings.ai.ollamaUrl} model=${settings.ai.model}`);
}

main();
