/**
 * Resolve which Ollama brain to use.
 * Other PC defaults to http://192.168.1.92:11434 — same as Desktop.
 */

const CACHE_TTL_MS = 45000;

/** @type {Map<string, { at: number, ok: boolean }>} */
const probeCache = new Map();

/** @type {Map<string, { at: number, models: string[] }>} */
const modelsCache = new Map();

/** @type {{ at: number, key: string, result: object } | null} */
let activeUrlCache = null;

function trimBase(url) {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '');
}

function migrateAi(ai = {}) {
  const ollamaUrlThisPc =
    trimBase(ai.ollamaUrlThisPc) ||
    'http://127.0.0.1:11434';

  const ollamaUrlOtherPc =
    trimBase(ai.ollamaUrlOtherPc) ||
    'http://192.168.1.92:11434';

  const llmHostMode = ['this-pc', 'other-pc', 'auto'].includes(
    ai.llmHostMode
  )
    ? ai.llmHostMode
    : 'other-pc';

  return {
    ...ai,
    ollamaUrlThisPc,
    ollamaUrlOtherPc,
    llmHostMode,
    model: String(ai.model || '').trim()
  };
}

function resolveOllamaUrlForHost(ai, host) {
  const m = migrateAi(ai);
  return host === 'this-pc'
    ? m.ollamaUrlThisPc
    : m.ollamaUrlOtherPc;
}

function hostLabel(host) {
  if (host === 'other-pc') return 'Other PC';
  if (host === 'this-pc') return 'This PC';
  return String(host || 'Unknown');
}

async function probeOllama(baseUrl, timeoutMs = 2500) {
  const base = trimBase(baseUrl);
  if (!base) {
    return false;
  }

  const cached = probeCache.get(base);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.ok;
  }

  try {
    const res = await fetch(base + '/api/tags', {
      signal: AbortSignal.timeout(timeoutMs)
    });
    const ok = res.ok;
    probeCache.set(base, { at: Date.now(), ok });
    return ok;
  } catch {
    probeCache.set(base, { at: Date.now(), ok: false });
    return false;
  }
}

/**
 * this-pc / other-pc are strict (no silent swap).
 * auto prefers Other PC, then This PC.
 */
async function resolveActiveLlmHost(ai = {}) {
  const m = migrateAi(ai);

  if (m.llmHostMode === 'this-pc') {
    return 'this-pc';
  }

  if (m.llmHostMode === 'other-pc') {
    return 'other-pc';
  }

  for (const host of ['other-pc', 'this-pc']) {
    const url = resolveOllamaUrlForHost(m, host);
    if (await probeOllama(url)) {
      return host;
    }
  }

  return 'other-pc';
}

async function listOllamaModels(baseUrl, timeoutMs = 4000) {
  const base = trimBase(baseUrl);
  if (!base) {
    return [];
  }

  const cached = modelsCache.get(base);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.models;
  }

  try {
    const res = await fetch(base + '/api/tags', {
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) {
      modelsCache.set(base, { at: Date.now(), models: [] });
      return [];
    }
    const data = await res.json();
    const models = (Array.isArray(data.models) ? data.models : [])
      .map((row) => String(row && row.name ? row.name : '').trim())
      .filter(Boolean)
      .sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      );
    modelsCache.set(base, { at: Date.now(), models });
    probeCache.set(base, { at: Date.now(), ok: true });
    return models;
  } catch {
    modelsCache.set(base, { at: Date.now(), models: [] });
    return [];
  }
}

function modelMatches(list, model) {
  const want = String(model || '').trim();
  if (!want) {
    return true;
  }
  return (list || []).some(
    (name) => name === want || name.startsWith(want + ':')
  );
}

function pickFallbackModel(available) {
  const list = Array.isArray(available) ? available : [];
  const chatPrefer = list.filter(
    (n) => !/vl|vision|moondream|embed/i.test(n)
  );
  const pool = chatPrefer.length ? chatPrefer : list;

  return (
    pool.find((n) => /llama3\.2/i.test(n)) ||
    pool.find((n) => /wizard-vicuna/i.test(n)) ||
    pool.find((n) => /llama/i.test(n)) ||
    pool.find((n) => /gemma/i.test(n)) ||
    pool.find((n) => /qwen/i.test(n)) ||
    pool[0] ||
    ''
  );
}

/**
 * Prefer configured model; if missing on that host, pick a chat-capable fallback.
 */
async function resolveChatModel(baseUrl, preferredModel) {
  const preferred = String(preferredModel || '').trim();
  const available = await listOllamaModels(baseUrl);

  if (!available.length) {
    return {
      model: preferred,
      fallback: false,
      available
    };
  }

  if (modelMatches(available, preferred)) {
    const exact =
      available.find((n) => n === preferred) ||
      available.find((n) => n.startsWith(preferred + ':')) ||
      preferred;
    return {
      model: exact,
      fallback: false,
      available
    };
  }

  const fallback = pickFallbackModel(available);
  return {
    model: fallback || preferred,
    fallback: Boolean(fallback),
    preferred,
    available
  };
}

async function resolveActiveOllamaUrl(ai = {}, options = {}) {
  const m = migrateAi(ai);
  const force = options.force === true;
  const cacheKey = [
    m.llmHostMode,
    m.ollamaUrlThisPc,
    m.ollamaUrlOtherPc
  ].join('|');

  if (
    !force &&
    activeUrlCache &&
    activeUrlCache.key === cacheKey &&
    Date.now() - activeUrlCache.at < CACHE_TTL_MS
  ) {
    return activeUrlCache.result;
  }

  const llmHost = await resolveActiveLlmHost(m);
  const ollamaUrl = resolveOllamaUrlForHost(m, llmHost);
  const reachable = await probeOllama(ollamaUrl);

  const result = {
    llmHost,
    ollamaUrl,
    ollamaUrlThisPc: m.ollamaUrlThisPc,
    ollamaUrlOtherPc: m.ollamaUrlOtherPc,
    llmHostMode: m.llmHostMode,
    reachable
  };

  activeUrlCache = {
    at: Date.now(),
    key: cacheKey,
    result
  };

  return result;
}

/**
 * Full brain snapshot for UI confirmation + model pickers.
 */
async function getBrainSnapshot(ai = {}, options = {}) {
  if (options.force === true) {
    clearLlmHostCache();
  }

  const m = migrateAi(ai);
  const resolved = await resolveActiveOllamaUrl(m, { force: true });

  const [thisPcOnline, otherPcOnline, modelsThisPc, modelsOtherPc] =
    await Promise.all([
      probeOllama(m.ollamaUrlThisPc),
      probeOllama(m.ollamaUrlOtherPc),
      listOllamaModels(m.ollamaUrlThisPc),
      listOllamaModels(m.ollamaUrlOtherPc)
    ]);

  const modelsActive =
    resolved.llmHost === 'this-pc' ? modelsThisPc : modelsOtherPc;

  const chatModel = await resolveChatModel(
    resolved.ollamaUrl,
    m.model
  );

  const modelOnHost = modelMatches(modelsActive, m.model);

  return {
    ...resolved,
    hostLabel: hostLabel(resolved.llmHost),
    modeLabel:
      m.llmHostMode === 'auto'
        ? 'Auto'
        : hostLabel(m.llmHostMode),
    thisPcOnline,
    otherPcOnline,
    modelsThisPc,
    modelsOtherPc,
    modelsActive,
    modelConfigured: m.model,
    modelActive: chatModel.model,
    modelFallback: chatModel.fallback === true,
    modelOnHost,
    confirmation:
      (resolved.reachable ? 'ACTIVE' : 'OFFLINE') +
      ' · ' +
      hostLabel(resolved.llmHost) +
      ' · ' +
      (chatModel.model || m.model || '(no model)') +
      (chatModel.fallback
        ? ' (fallback — configured model missing on this host)'
        : modelOnHost
          ? ' (on host)'
          : '') +
      ' · ' +
      (resolved.ollamaUrl || '?') +
      ' · This PC ' +
      (thisPcOnline ? modelsThisPc.length + ' models' : 'offline') +
      ' · Other PC ' +
      (otherPcOnline ? modelsOtherPc.length + ' models' : 'offline')
  };
}

function clearLlmHostCache() {
  probeCache.clear();
  modelsCache.clear();
  activeUrlCache = null;
}

module.exports = {
  migrateAi,
  probeOllama,
  resolveOllamaUrlForHost,
  resolveActiveLlmHost,
  resolveActiveOllamaUrl,
  listOllamaModels,
  modelMatches,
  pickFallbackModel,
  resolveChatModel,
  getBrainSnapshot,
  hostLabel,
  clearLlmHostCache
};
