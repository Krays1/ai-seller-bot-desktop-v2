/**
 * Ensure Ollama has the vision model and settings.json uses it.
 * Tries local then Other PC URL from settings / defaults.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const VISION_MODEL = 'qwen2.5vl:3b';
const settingsPath = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'ai-seller-bot-desktop-v2',
  'settings.json'
);

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return null;
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

async function listModels(baseUrl) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.models || []).map((m) => m.name).filter(Boolean);
}

function hasModel(names, wanted) {
  const w = String(wanted).toLowerCase();
  const base = w.split(':')[0];
  return names.some((n) => {
    const x = String(n).toLowerCase();
    return x === w || x.startsWith(w + ':') || x.startsWith(base + ':') || x === base;
  });
}

async function pullModel(baseUrl, model) {
  console.log(`Pulling ${model} on ${baseUrl} (may take a while)…`);
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model, stream: false }),
    signal: AbortSignal.timeout(600000)
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Pull failed HTTP ${res.status} ${t.slice(0, 120)}`);
  }
  console.log('Pull finished.');
}

async function main() {
  let settings = readSettings() || {};
  if (!settings.ai || typeof settings.ai !== 'object') settings.ai = {};
  if (!settings.vision || typeof settings.vision !== 'object') settings.vision = {};

  // Keep vision model name for when user re-enables describe; do NOT force it on
  // (qwen2.5vl + Forge together can fill a 12GB card and lag the channel).
  if (!settings.vision.model) settings.vision.model = VISION_MODEL;
  // Do NOT overwrite ai.model with the vision VLM — that made chat take 60s+
  // and skipped normal banter models. Keep existing chat model if set.
  const chatModel = String(settings.ai.model || '').trim();
  if (!chatModel || /vl\b/i.test(chatModel) || /vision/i.test(chatModel)) {
    // Prefer a non-VL model name; Engines UI / resolveChatModel can still fall back
    if (/vl\b/i.test(chatModel) || /vision/i.test(chatModel)) {
      console.log(
        `Leaving ai.model alone would use VLM for chat (${chatModel}). Clearing so host can pick a chat model.`
      );
      settings.ai.model = '';
    }
  }
  if (!settings.imageGen || typeof settings.imageGen !== 'object') {
    settings.imageGen = {};
  }
  settings.imageGen.enabled = true;
  settings.imageGen.webuiUrl =
    settings.imageGen.webuiUrl || 'http://127.0.0.1:7860';

  writeSettings(settings);
  console.log(
    `Settings → vision.model = ${settings.vision.model || VISION_MODEL} (auto-describe left as-is: ${settings.vision.autoDescribe === true})`
  );
  console.log(`Wrote ${settingsPath}`);

  const urls = [];
  const mode = String(settings.ai.llmHostMode || '').toLowerCase();
  const thisPc =
    settings.ai.ollamaUrlThisPc || 'http://127.0.0.1:11434';
  const otherPc =
    settings.ai.ollamaUrlOtherPc || 'http://192.168.1.92:11434';
  const primary =
    settings.ai.ollamaUrl ||
    (mode === 'this-pc' ? thisPc : otherPc);

  for (const u of [primary, thisPc, otherPc]) {
    const n = String(u || '').replace(/\/$/, '');
    if (n && !urls.includes(n)) urls.push(n);
  }

  let ok = false;
  for (const url of urls) {
    try {
      const names = await listModels(url);
      console.log(`${url} has: ${names.slice(0, 12).join(', ') || '(none)'}`);
      if (hasModel(names, VISION_MODEL)) {
        console.log(`OK: ${VISION_MODEL} already on ${url}`);
        ok = true;
        break;
      }
      await pullModel(url, VISION_MODEL);
      const after = await listModels(url);
      if (hasModel(after, VISION_MODEL)) {
        console.log(`OK: ${VISION_MODEL} installed on ${url}`);
        ok = true;
        break;
      }
    } catch (err) {
      console.log(`Skip ${url}: ${err.message || err}`);
    }
  }

  if (!ok) {
    console.log('');
    console.log('WARNING: Could not reach Ollama or pull the vision model.');
    console.log(`On the brain PC run:  ollama pull ${VISION_MODEL}`);
    console.log('Settings were still updated to use that model when Ollama is up.');
    process.exitCode = 2;
    return;
  }
  console.log('Vision model ready.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
