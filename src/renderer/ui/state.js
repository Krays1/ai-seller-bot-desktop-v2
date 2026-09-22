window.V2 = window.V2 || {};

window.V2.state = {
  settings: null,
  voices: [],
  zelloConnected: false,
  lastActivityId: 0,
  voicePickBotId: null
};

window.V2.$ = (id) => document.getElementById(id);

window.V2.cloneSettings = function cloneSettings(settings) {
  return JSON.parse(JSON.stringify(settings || {}));
};

window.V2.channelOptions = function channelOptions(settings) {
  const names = new Set();
  const z = settings?.zello || {};
  if (z.channelName) names.add(String(z.channelName).trim());
  for (const c of z.channelNames || []) {
    const n = String(c || '').trim();
    if (n) names.add(n);
  }
  for (const b of settings?.bots || []) {
    const n = String(b?.channelName || '').trim();
    if (n) names.add(n);
  }
  for (const c of settings?.catalog?.channels || []) {
    const n = String(c?.name || c || '').trim();
    if (n) names.add(n);
  }
  return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b));
};

window.V2.setDot = function setDot(id, mode) {
  const el = window.V2.$(id);
  if (!el) return;
  el.classList.remove('on', 'warn', 'off');
  el.classList.add(mode || 'off');
};

window.V2.showToastHint = function showToastHint(el, text) {
  if (!el) return;
  el.textContent = text;
};

/** Normalize STT / OmniVoice / brain probe payloads to a boolean. */
window.V2.isServiceOk = function isServiceOk(r) {
  if (!r || typeof r !== 'object') return false;
  if (r.ok === true || r.ready === true || r.healthy === true) return true;
  if (r.ok === false || r.ready === false) return false;
  const status = String(r.status || '').toLowerCase();
  if (
    status === 'ok' ||
    status === 'healthy' ||
    status === 'ready' ||
    status === 'up'
  ) {
    return true;
  }
  // HTTP status from STT health
  if (typeof r.status === 'number' && r.status >= 200 && r.status < 300) {
    return true;
  }
  return false;
};
