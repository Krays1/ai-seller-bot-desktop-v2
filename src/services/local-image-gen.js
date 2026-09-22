const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const DEFAULT_NEGATIVE =
  'blurry, low quality, watermark, text, logo, signature, deformed, ugly, bad anatomy';

function resolveConfig(config = {}, env = process.env) {
  const ig =
    config && typeof config.imageGen === 'object' ? config.imageGen : {};
  const enabled =
    env.SD_ENABLED === 'true' ||
    env.IMAGE_GEN_ENABLED === 'true' ||
    (env.SD_ENABLED !== 'false' && ig.enabled === true);
  const webuiUrl = String(
    env.SD_WEBUI_URL || ig.webuiUrl || 'http://127.0.0.1:7860'
  ).replace(/\/$/, '');
  return {
    enabled,
    webuiUrl,
    steps: Math.min(60, Math.max(4, Number(env.SD_STEPS || ig.steps) || 20)),
    width: Math.min(1024, Math.max(256, Number(env.SD_WIDTH || ig.width) || 512)),
    height: Math.min(
      1024,
      Math.max(256, Number(env.SD_HEIGHT || ig.height) || 512)
    ),
    cfgScale: Math.min(
      20,
      Math.max(1, Number(env.SD_CFG_SCALE || ig.cfgScale) || 7)
    ),
    sampler: String(env.SD_SAMPLER || ig.sampler || 'Euler a').trim() || 'Euler a',
    negativePrompt: String(
      env.SD_NEGATIVE_PROMPT || ig.negativePrompt || DEFAULT_NEGATIVE
    ).trim(),
    timeoutSec: Math.min(
      300,
      Math.max(15, Number(env.SD_TIMEOUT_SEC || ig.timeoutSec) || 120)
    ),
    cooldownSec: Math.min(
      300,
      Math.max(0, Number(env.SD_COOLDOWN_SEC || ig.cooldownSec) || 0)
    ),
    saveDir: String(env.SD_SAVE_DIR || ig.saveDir || '').trim()
  };
}

/**
 * After wake/name is stripped:
 *   "show us a cat" / "show your bum" / "picture pizza" / "draw a dog"
 */
function parsePictureCommand(text) {
  // Prefer shared parser (same rules as voice commands)
  try {
    return require('./bot-commands').parsePictureCommand(text);
  } catch {
    /* fall through */
  }
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (/\bshow\s+(?:me\s+)?(?:the\s+)?(?:bot\s+)?commands?\b/i.test(raw)) {
    return null;
  }
  let m = raw.match(
    /\b(?:picture|draw|image|paint|sketch|generate)\s+(.+)$/i
  );
  if (!m) {
    m = raw.match(/\bshow(?:\s+us|\s+me)?\s+(.+)$/i);
  }
  if (!m) return null;
  let prompt = m[1]
    .replace(/\b(?:please|bot|a\s+picture\s+of|an?\s+image\s+of)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!prompt || prompt.length < 2) return null;
  if (prompt.length > 240) prompt = prompt.slice(0, 240).trim();
  return { action: 'generate', prompt };
}

async function getLocalImageGenStatus(config = {}, env = process.env) {
  const cfg = resolveConfig(config, env);
  if (!cfg.enabled) {
    return {
      enabled: false,
      ready: false,
      webuiUrl: cfg.webuiUrl,
      message: 'Disabled in config'
    };
  }
  try {
    const res = await fetch(`${cfg.webuiUrl}/sdapi/v1/sd-models`, {
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) {
      return {
        enabled: true,
        ready: false,
        webuiUrl: cfg.webuiUrl,
        message: `WebUI HTTP ${res.status}`
      };
    }
    const models = await res.json();
    const model =
      Array.isArray(models) && models.length
        ? models.find((m) => m && m.title)?.title ||
          models[0]?.model_name ||
          'loaded'
        : 'none';
    return {
      enabled: true,
      ready: true,
      webuiUrl: cfg.webuiUrl,
      model,
      steps: cfg.steps,
      size: `${cfg.width}x${cfg.height}`,
      message: 'Ready'
    };
  } catch (err) {
    return {
      enabled: true,
      ready: false,
      webuiUrl: cfg.webuiUrl,
      message: err.message || 'WebUI not reachable'
    };
  }
}

async function generateLocalImage(
  prompt,
  config = {},
  env = process.env,
  options = {}
) {
  const cfg = resolveConfig(config, env);
  if (!cfg.enabled) {
    throw new Error(
      'Local image gen is disabled. Enable imageGen in settings or set SD_ENABLED=true.'
    );
  }
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) throw new Error('Picture prompt is empty.');

  const body = {
    prompt: cleanPrompt,
    negative_prompt: cfg.negativePrompt,
    steps: cfg.steps,
    width: cfg.width,
    height: cfg.height,
    cfg_scale: cfg.cfgScale,
    sampler_name: cfg.sampler,
    batch_size: 1,
    n_iter: 1,
    save_images: false,
    send_images: true
  };

  const timeoutMs = (options.timeoutSec ?? cfg.timeoutSec) * 1000;
  const res = await fetch(`${cfg.webuiUrl}/sdapi/v1/txt2img`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Stable Diffusion WebUI error ${res.status}${
        errText ? `: ${errText.slice(0, 120)}` : ''
      }`
    );
  }

  const data = await res.json();
  const b64 = data?.images?.[0];
  if (!b64) throw new Error('WebUI returned no image. Is a checkpoint loaded?');

  const rawBuffer = Buffer.from(b64, 'base64');
  const buffer = await sharp(rawBuffer)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  const meta = await sharp(buffer).metadata();
  const width = meta.width || cfg.width;
  const height = meta.height || cfg.height;
  const thumbnailBuffer = await sharp(buffer)
    .resize(720, 720, { fit: 'inside' })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();

  let localPath = null;
  let filename = null;
  const saveRoot = options.saveDir || cfg.saveDir;
  if (saveRoot) {
    fs.mkdirSync(saveRoot, { recursive: true });
    filename = `sd-${Date.now()}.jpg`;
    localPath = path.join(saveRoot, filename);
    fs.writeFileSync(localPath, buffer);
  }

  return {
    buffer,
    thumbnailBuffer,
    width,
    height,
    localPath,
    filename,
    prompt: cleanPrompt,
    webuiUrl: cfg.webuiUrl
  };
}

module.exports = {
  parsePictureCommand,
  getLocalImageGenStatus,
  generateLocalImage,
  resolveConfig
};
