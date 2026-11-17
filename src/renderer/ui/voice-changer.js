window.V2 = window.V2 || {};

(function () {
  const $ = window.V2.$;
  const RATE = 16000;
  const SEND_EVERY_FRAMES = 2;

  // Resamples the mic to 16 kHz mono PCM16 and posts 20 ms frames + peak level
  const WORKLET_SRC = `
class VcCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${RATE};
    this.pos = 0;
    this.prev = 0;
    this.lp = 0;
    const w = 2 * Math.PI * 7000 / sampleRate;
    this.alpha = this.ratio > 1.01 ? w / (1 + w) : 1;
    this.out = new Int16Array(320);
    this.len = 0;
    this.peak = 0;
  }
  push(v) {
    const c = v > 1 ? 1 : v < -1 ? -1 : v;
    this.out[this.len++] = c * 32767;
    if (this.len === 320) {
      this.port.postMessage({ pcm: this.out.buffer, peak: this.peak }, [this.out.buffer]);
      this.out = new Int16Array(320);
      this.len = 0;
      this.peak = 0;
    }
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const n = ch.length;
    const buf = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.lp += this.alpha * (ch[i] - this.lp);
      buf[i] = this.lp;
      const a = Math.abs(ch[i]);
      if (a > this.peak) this.peak = a;
    }
    while (this.pos < n - 1) {
      const i = Math.floor(this.pos);
      const f = this.pos - i;
      const a = i < 0 ? this.prev : buf[i];
      const b = buf[i + 1];
      this.push(a + (b - a) * f);
      this.pos += this.ratio;
    }
    this.pos -= n;
    this.prev = buf[n - 1];
    return true;
  }
}
registerProcessor('vc-capture', VcCapture);
`;

  const ui = {
    info: null,
    prefs: {},
    capturingKey: false
  };
  const mic = {
    stream: null,
    ctx: null,
    source: null,
    node: null,
    monitor: null,
    deviceId: null,
    opening: null
  };
  const tx = {
    pressed: false,
    starting: false,
    capturing: false,
    sessionId: null,
    pre: [],
    batch: [],
    finishing: false
  };
  let playAt = 0;
  let pollTimer = null;

  function api() {
    return window.zelloBot?.voiceChanger;
  }

  function isActive() {
    return $('view-voice-changer')?.classList.contains('is-active');
  }

  function cleanError(e) {
    return String(e?.message || e || '')
      .replace(/^Error invoking remote method '[^']+':\s*/i, '')
      .replace(/^Error:\s*/i, '');
  }

  function showError(text) {
    const el = $('vc-error');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-hidden', !text);
  }

  function setStatus(text) {
    if ($('vc-status')) $('vc-status').textContent = text;
  }

  function keyLabel(code) {
    if (!code) return '—';
    return String(code).replace(/^Key/, '').replace(/^Digit/, '');
  }

  function selectedVoice() {
    return $('vc-voice')?.value || '';
  }

  function currentMode() {
    return $('vc-mode')?.value === 'repeat' ? 'repeat' : 'live';
  }

  function isTest() {
    return $('vc-test')?.checked === true;
  }

  function renderPtt() {
    const btn = $('vc-ptt');
    if (!btn) return;
    const live = tx.pressed || tx.starting || tx.capturing;
    btn.classList.toggle('is-live', live && !isTest());
    btn.classList.toggle('is-test', live && isTest());
    btn.classList.toggle('is-busy', tx.finishing);
    const label = $('vc-ptt-label');
    if (label) {
      label.textContent = tx.finishing
        ? 'Finishing…'
        : live
          ? isTest()
            ? 'Testing — not sent'
            : currentMode() === 'repeat'
              ? 'Recording…'
              : 'ON AIR'
          : isTest()
            ? 'Hold to test'
            : 'Hold to talk';
    }
    const hint = $('vc-ptt-hint');
    if (hint) {
      hint.textContent = 'or hold ' + keyLabel(ui.prefs.pttKey || 'Space') + ' while this tab is open';
    }
  }

  async function savePrefs(changes) {
    ui.prefs = { ...ui.prefs, ...changes };
    try {
      const saved = await api().savePrefs(changes);
      ui.prefs = { ...ui.prefs, ...saved };
      // Other tabs save their whole settings copy — keep it in step
      if (window.V2.state.settings) window.V2.state.settings.voiceChanger = saved;
    } catch {
      /* non-fatal */
    }
  }

  function fillBots(bots) {
    const sel = $('vc-bot');
    if (!sel) return;
    const want = sel.value || ui.prefs.botId || '';
    const sig = JSON.stringify(bots.map((b) => [b.id, b.name, b.connected]));
    if (sel.dataset.sig !== sig) {
      sel.dataset.sig = sig;
      sel.innerHTML = '';
      if (!bots.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No joined bots (Roster → Join)';
        sel.appendChild(opt);
      }
      for (const b of bots) {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.name + (b.connected ? ' — connected' : ' — offline') + (b.channel ? ' · ' + b.channel : '');
        sel.appendChild(opt);
      }
    }
    if ([...sel.options].some((o) => o.value === want)) sel.value = want;
  }

  function fillVoices(voices) {
    const sel = $('vc-voice');
    if (!sel) return;
    const want = sel.value || ui.prefs.voice || 'dsp:robot';
    sel.innerHTML = '';
    const groups = [
      ['Instant effects (no AI)', voices.filter((v) => v.kind === 'dsp')],
      ['Character voices (AI)', voices.filter((v) => v.kind === 'clip')]
    ];
    for (const [label, list] of groups) {
      if (!list.length) continue;
      const og = document.createElement('optgroup');
      og.label = label;
      for (const v of list) {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.label;
        opt.dataset.kind = v.kind;
        og.appendChild(opt);
      }
      sel.appendChild(og);
    }
    if ([...sel.options].some((o) => o.value === want)) sel.value = want;
    applyModeToVoices();
  }

  function applyModeToVoices() {
    const sel = $('vc-voice');
    if (!sel) return;
    const repeat = currentMode() === 'repeat';
    for (const opt of sel.options) {
      opt.disabled = repeat && opt.dataset.kind === 'dsp';
    }
    if (sel.selectedOptions[0]?.disabled) {
      const firstClip = [...sel.options].find((o) => !o.disabled);
      if (firstClip) sel.value = firstClip.value;
    }
  }

  function renderConverter(h) {
    const el = $('vc-conv-status');
    if (!el) return;
    let mode = 'off';
    if (h?.ok) {
      el.textContent = 'Converter ready' + (h.gpu ? ' · ' + h.gpu : '');
      mode = 'on';
    } else if (h?.status === 'loading') {
      el.textContent = 'Converter loading model…';
      mode = 'warn';
    } else {
      el.textContent = 'Converter off — run E:\\seed-vc\\start-voice-changer.bat (instant effects still work)';
    }
    window.V2.setDot('vc-conv-dot', mode);
  }

  function renderStats(st) {
    const el = $('vc-latency');
    if (!el || !st) return;
    const parts = [];
    if (Number.isFinite(st.algo_delay_ms)) {
      const total = st.algo_delay_ms + (Number(st.infer_ms) || 0);
      parts.push('delay ≈ ' + Math.round(total) + ' ms');
    }
    if (Number(st.infer_ms) > 0) parts.push('GPU ' + Math.round(st.infer_ms) + ' ms / ' + st.block_ms + ' ms block');
    if (Number(st.dropped_ms) > 0) parts.push('dropped ' + st.dropped_ms + ' ms (GPU too slow)');
    el.textContent = parts.join(' · ') || '—';
  }

  async function refreshInfo() {
    if (!api()) return;
    try {
      const info = await api().info();
      ui.info = info;
      fillBots(info.bots || []);
      if (!$('vc-voice').options.length || $('vc-voice').dataset.sig !== JSON.stringify(info.voices)) {
        $('vc-voice').dataset.sig = JSON.stringify(info.voices);
        fillVoices(info.voices || []);
      }
      renderConverter(info.converter);
    } catch (e) {
      showError(cleanError(e));
    }
  }

  async function fillDevices() {
    const sel = $('vc-device');
    if (!sel || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      const want = sel.value || ui.prefs.deviceId || '';
      sel.innerHTML = '';
      const def = document.createElement('option');
      def.value = '';
      def.textContent = 'System default';
      sel.appendChild(def);
      for (const d of devices) {
        if (d.deviceId === 'default' || d.deviceId === 'communications') continue;
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || 'Microphone ' + (sel.options.length);
        sel.appendChild(opt);
      }
      sel.value = [...sel.options].some((o) => o.value === want) ? want : '';
    } catch {
      /* ignore */
    }
  }

  function onFrame(data) {
    const peak = Number(data.peak) || 0;
    const db = peak > 0 ? 20 * Math.log10(peak) : -100;
    const meter = $('vc-meter');
    if (meter) meter.style.width = Math.max(0, Math.min(100, ((db + 60) / 60) * 100)) + '%';
    if (!tx.capturing) return;
    const frame = new Uint8Array(data.pcm);
    if (tx.sessionId == null) {
      tx.pre.push(frame);
      return;
    }
    tx.batch.push(frame);
    if (tx.batch.length >= SEND_EVERY_FRAMES) sendBatch();
  }

  function sendBatch() {
    if (!tx.batch.length || tx.sessionId == null) return;
    const total = tx.batch.reduce((n, f) => n + f.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const f of tx.batch) {
      out.set(f, o);
      o += f.length;
    }
    tx.batch = [];
    api().pushPcm(tx.sessionId, out);
  }

  async function openMic() {
    const deviceId = $('vc-device')?.value || '';
    if (mic.stream && mic.deviceId === deviceId) return;
    if (mic.opening) return mic.opening;
    mic.opening = (async () => {
      closeMic();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      let ctx;
      try {
        ctx = new AudioContext({ sampleRate: RATE, latencyHint: 'interactive' });
      } catch {
        ctx = new AudioContext({ latencyHint: 'interactive' });
      }
      const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'vc-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
      node.port.onmessage = (ev) => onFrame(ev.data);
      source.connect(node);
      const monitor = ctx.createGain();
      monitor.gain.value = $('vc-monitor')?.checked ? 1 : 0;
      source.connect(monitor);
      monitor.connect(ctx.destination);
      Object.assign(mic, { stream, ctx, source, node, monitor, deviceId });
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    })();
    try {
      await mic.opening;
      await fillDevices();
    } finally {
      mic.opening = null;
    }
  }

  function closeMic() {
    try {
      mic.stream?.getTracks().forEach((t) => t.stop());
      mic.source?.disconnect();
      mic.node?.disconnect();
      mic.monitor?.disconnect();
      mic.ctx?.close();
    } catch {
      /* ignore */
    }
    Object.assign(mic, { stream: null, ctx: null, source: null, node: null, monitor: null, deviceId: null });
    const meter = $('vc-meter');
    if (meter) meter.style.width = '0%';
  }

  function playOutput(pcm) {
    if (!mic.ctx || !isTest()) return;
    const bytes = pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm);
    const n = Math.floor(bytes.byteLength / 2);
    if (!n) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
    const buffer = mic.ctx.createBuffer(1, n, RATE);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
    const node = mic.ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(mic.ctx.destination);
    const now = mic.ctx.currentTime;
    if (playAt < now + 0.02) playAt = now + 0.06;
    node.start(playAt);
    playAt += buffer.duration;
  }

  async function press() {
    if (tx.pressed || tx.starting || tx.finishing || !api()) return;
    showError('');
    tx.pressed = true;
    tx.starting = true;
    renderPtt();
    try {
      await openMic();
    } catch (e) {
      tx.pressed = false;
      tx.starting = false;
      renderPtt();
      showError('Microphone: ' + cleanError(e));
      return;
    }
    tx.pre = [];
    tx.batch = [];
    tx.sessionId = null;
    tx.capturing = true;
    setStatus(isTest() ? 'Starting test…' : 'Getting the channel…');
    const opts = {
      botId: $('vc-bot')?.value || '',
      voice: selectedVoice(),
      mode: currentMode(),
      test: isTest()
    };
    let res;
    try {
      res = await api().start(opts);
    } catch (e) {
      tx.capturing = false;
      tx.pressed = false;
      tx.starting = false;
      tx.pre = [];
      renderPtt();
      const msg = cleanError(e);
      setStatus(/busy/i.test(msg) ? 'Channel busy' : 'Not sent');
      showError(msg);
      return;
    }
    tx.starting = false;
    tx.sessionId = res.sessionId;
    tx.batch = tx.pre;
    tx.pre = [];
    sendBatch();
    if (!tx.pressed) {
      await finish();
      return;
    }
    renderPtt();
  }

  async function release() {
    if (!tx.pressed) return;
    tx.pressed = false;
    if (tx.starting) return;
    await finish();
  }

  async function finish() {
    if (tx.sessionId == null) return;
    sendBatch();
    tx.capturing = false;
    const id = tx.sessionId;
    tx.sessionId = null;
    tx.finishing = true;
    renderPtt();
    try {
      const r = await api().stop(id);
      if (r && r.ok === false && r.error) showError(r.error);
    } catch (e) {
      showError(cleanError(e));
    } finally {
      tx.finishing = false;
      renderPtt();
    }
  }

  function onStatus(st) {
    if (!st) return;
    if (st.stats) renderStats(st.stats);
    else if (st.state === 'starting' && $('vc-latency')) $('vc-latency').textContent = '—';
    const s = st.state;
    // Main ended the session itself (time cap, cut off, converter gone) while still held
    if ((s === 'idle' || s === 'error') && tx.sessionId != null && st.sessionId === tx.sessionId) {
      tx.capturing = false;
      tx.sessionId = null;
      tx.pressed = false;
      tx.batch = [];
      renderPtt();
    }
    if (s === 'starting') setStatus(st.test ? 'Starting test…' : 'Getting the channel…');
    else if (s === 'transmitting') setStatus('On air — talking as the bot');
    else if (s === 'testing') setStatus('Testing — you should hear the result (not sent)');
    else if (s === 'recording') {
      setStatus(st.test ? 'Recording — release to hear it repeated (not sent)' : 'Recording — release and the bot repeats it in the voice');
    }
    else if (s === 'finishing') setStatus(st.transcript ? 'Heard: "' + st.transcript + '" — speaking…' : 'Finishing…');
    else if (s === 'error') {
      setStatus('Stopped');
      showError(st.error || 'Error');
    } else if (s === 'idle') {
      const last = st.last || {};
      if (last.savedPath) setStatus('Test saved: ' + last.savedPath);
      else if (last.tx) setStatus('Sent ' + ((last.tx.durationMs || 0) / 1000).toFixed(1) + ' s');
      else if (last.skipped) setStatus('Too short — nothing sent');
      else setStatus('Idle');
    }
  }

  function isEditable(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function onKeyDown(e) {
    if (ui.capturingKey) {
      e.preventDefault();
      ui.capturingKey = false;
      $('vc-key-set').textContent = 'Change';
      if (e.code !== 'Escape') {
        $('vc-key').value = keyLabel(e.code);
        savePrefs({ pttKey: e.code });
      }
      renderPtt();
      return;
    }
    if (!isActive() || e.repeat || e.code !== (ui.prefs.pttKey || 'Space')) return;
    if (isEditable(e.target) || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    press();
  }

  function onKeyUp(e) {
    if (e.code !== (ui.prefs.pttKey || 'Space')) return;
    if (!tx.pressed) return;
    e.preventDefault();
    release();
  }

  function onViewChange() {
    if (isActive()) {
      refreshInfo();
      openMic().catch((e) => showError('Microphone: ' + cleanError(e)));
      if (!pollTimer) pollTimer = setInterval(refreshInfo, 5000);
    } else {
      clearInterval(pollTimer);
      pollTimer = null;
      if (!tx.pressed && !tx.capturing && !tx.finishing) closeMic();
      else release();
    }
  }

  function fill(settings) {
    ui.prefs = { ...(settings?.voiceChanger || {}) };
    if ($('vc-mode')) $('vc-mode').value = ui.prefs.mode === 'repeat' ? 'repeat' : 'live';
    if ($('vc-test')) $('vc-test').checked = ui.prefs.test === true;
    if ($('vc-key')) $('vc-key').value = keyLabel(ui.prefs.pttKey || 'Space');
    renderPtt();
  }

  function bind() {
    if (!api()) return;
    const ptt = $('vc-ptt');
    ptt?.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      try {
        ptt.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events have no capturable pointer */
      }
      press();
    });
    ptt?.addEventListener('pointerup', () => release());
    ptt?.addEventListener('pointercancel', () => release());
    ptt?.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') e.preventDefault();
    });

    const blurAfter = (el) => setTimeout(() => el.blur(), 0);
    $('vc-bot')?.addEventListener('change', (e) => {
      savePrefs({ botId: e.target.value });
      blurAfter(e.target);
    });
    $('vc-voice')?.addEventListener('change', (e) => {
      savePrefs({ voice: e.target.value });
      blurAfter(e.target);
    });
    $('vc-mode')?.addEventListener('change', (e) => {
      applyModeToVoices();
      savePrefs({ mode: currentMode(), voice: selectedVoice() });
      renderPtt();
      blurAfter(e.target);
    });
    $('vc-device')?.addEventListener('change', (e) => {
      savePrefs({ deviceId: e.target.value });
      blurAfter(e.target);
      if (isActive()) openMic().catch((err) => showError('Microphone: ' + cleanError(err)));
    });
    $('vc-test')?.addEventListener('change', (e) => {
      savePrefs({ test: e.target.checked });
      renderPtt();
    });
    $('vc-monitor')?.addEventListener('change', (e) => {
      if (mic.monitor) mic.monitor.gain.value = e.target.checked ? 1 : 0;
    });
    $('vc-key-set')?.addEventListener('click', (e) => {
      ui.capturingKey = true;
      e.target.textContent = 'Press a key…';
    });
    $('vc-open-folder')?.addEventListener('click', () => api().openFolder());
    $('vc-reload')?.addEventListener('click', () => refreshInfo());

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', () => release());

    api().onStatus(onStatus);
    api().onOutput(playOutput);

    const view = $('view-voice-changer');
    if (view) {
      new MutationObserver(onViewChange).observe(view, { attributes: true, attributeFilter: ['class'] });
    }
  }

  window.V2.voiceChanger = { bind, fill, refreshInfo };
})();
