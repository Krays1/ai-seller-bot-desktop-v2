const fs = require('node:fs');
const sharp = require('sharp');

const VISION_SCENE_PROMPT =
  'Describe this photo in 1-2 short sentences. Read ALL readable text, numbers, and captions exactly. Do not invent text that is not visible. Plain speech only.';

function cleanVisionText(raw) {
  return String(raw || '')
    .replace(/<\|[^|>]+\|>/g, ' ')
    .replace(
      /^(?:assistant|answer|response|description|image description)\s*:\s*/i,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveVisionModel(ollamaUrl, preferred) {
  const wanted = String(preferred || 'qwen2.5vl:3b').trim();
  const baseUrl = String(ollamaUrl || 'http://127.0.0.1:11434').replace(
    /\/$/,
    ''
  );
  const res = await fetch(`${baseUrl}/api/tags`, {
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`Cannot reach Ollama at ${ollamaUrl}`);
  const data = await res.json();
  const models = (data.models || []).map((m) => m.name).filter(Boolean);
  if (!models.length) {
    throw new Error(
      'Ollama has no models. Run: ollama pull qwen2.5vl:3b'
    );
  }
  if (models.includes(wanted)) return wanted;
  const base = wanted.split(':')[0];
  const partial = models.find(
    (m) => m === base || m.startsWith(`${base}:`) || m.startsWith(`${wanted}:`)
  );
  if (partial) return partial;
  const visionish = models.find((m) =>
    /qwen2\.?5.?vl|qwen2-vl|llava|bakllava|minicpm-v|moondream|vision/i.test(m)
  );
  if (visionish) return visionish;
  throw new Error(`No vision model found. Run: ollama pull ${wanted}`);
}

async function prepareImageBase64(imagePathOrBuffer, maxSide = 1280) {
  let input = imagePathOrBuffer;
  if (typeof imagePathOrBuffer === 'string') {
    if (!fs.existsSync(imagePathOrBuffer)) {
      throw new Error('Image file not found for vision');
    }
    input = fs.readFileSync(imagePathOrBuffer);
  }
  if (!Buffer.isBuffer(input) || input.length < 32) {
    throw new Error('Empty image for vision');
  }
  const resized = await sharp(input)
    .rotate()
    .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return resized.toString('base64');
}

/**
 * Describe a JPEG via Ollama vision (/api/chat with images).
 */
async function describeImageWithOllama({
  imagePath,
  imageBuffer,
  ollamaUrl = 'http://127.0.0.1:11434',
  model = 'qwen2.5vl:3b',
  prompt = VISION_SCENE_PROMPT,
  timeoutMs = 90000
} = {}) {
  const baseUrl = String(ollamaUrl || '').replace(/\/$/, '');
  const resolved = await resolveVisionModel(baseUrl, model);
  const b64 = await prepareImageBase64(imageBuffer || imagePath);

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: resolved,
      stream: false,
      messages: [
        {
          role: 'user',
          content: prompt,
          images: [b64]
        }
      ]
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Ollama vision HTTP ${res.status}${errText ? `: ${errText.slice(0, 120)}` : ''}`
    );
  }

  const data = await res.json();
  const text = cleanVisionText(
    data?.message?.content || data?.response || ''
  );
  if (!text) throw new Error('Vision model returned empty description');
  return { text, model: resolved };
}

function cleanVisionDescriptionForSpeech(text, maxChars = 280) {
  let out = cleanVisionText(text);
  if (out.length > maxChars) {
    out = out.slice(0, maxChars - 1).trim() + '…';
  }
  return out;
}

module.exports = {
  VISION_SCENE_PROMPT,
  resolveVisionModel,
  describeImageWithOllama,
  cleanVisionDescriptionForSpeech,
  prepareImageBase64
};
