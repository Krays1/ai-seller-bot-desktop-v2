window.V2 = window.V2 || {};

(function () {
  const $ = window.V2.$;
  const SEND_EVERY_FRAMES = 2;

  // Downmixes to mono and resamples to the DJ rate; posts 20 ms PCM16 frames + peak
  const WORKLET_SRC = `
class DjCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const rate = options.processorOptions.rate;
    this.ratio = sampleRate / rate;
    this.frame = Math.round(rate * 0.02);
    this.pos = 0;
    this.prev = 0;
    this.lp = 0;
    const w = 2 * Math.PI * (rate * 0.45) / sampleRate;
    this.alpha = this.ratio > 1.01 ? w / (1 + w) : 1;
    this.out = new Int16Array(this.frame);
    this.len = 0;
    this.peak = 0;
  }
  push(v) {
    const c = v > 1 ? 1 : v < -1 ? -1 : v;
    this.out[this.len++] = c * 32767;
    if (this.len === this.frame) {
      this.port.postMessage({ pcm: this.out.buffer, peak: this.peak }, [this.out.buffer]);
      this.out = new Int16Array(this.frame);
      this.len = 0;
      this.peak = 0;
    }
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length || !input[0]) return true;
    const chs = input.length;
    const n = input[0].length;
    const buf = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let c = 0; c < chs; c++) s += input[c][i];
      s /= chs;
      this.lp += this.alpha * (s - this.lp);
      buf[i] = this.lp;
      const a = Math.abs(s);
      if (a > this.peak) this.peak = a;
    }
    if (this.ratio === 1) {
      for (let i = 0; i < n; i++) this.push(buf[i]);
      return true;
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
registerProcessor('dj-capture', DjCapture);
`;

  const SOURCE_HINTS = {
    device:
      'Best for just the browser: install VB-Audio Cable, set your browser (or Spotify) output to "CABLE Input", then pick "CABLE Output" here. Stereo Mix works too (all PC sound).',
    system:
      'Sends everything your PC plays. This app never plays the channel out loud, but if the Zello app (or anything else playing the channel) is open on this PC it will echo back — mute it or use a virtual cable instead.',
    app: 'Plays the app\'s own music queue (YouTube via yt-dlp, or files). Channel "play SONG" requests join this queue while DJ is on.'
  };

  const VC_RATE = 16000;
  // Separate 16 kHz mic path for hold-to-talk (music capture stays on DJ rate)
  const VC_WORKLET_SRC = `
class DjVcCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${VC_RATE};
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
registerProcessor('dj-vc-capture', DjVcCapture);
`;

  const ui = { prefs: {}, info: null, status: null, saveTimer: null, linesSig: '', quickSig: '' };
  const cap = { stream: null, ctx: null, node: null, source: null, sessionId: null, batch: [], kind: '', deviceId: '', rate: 0 };
  const talk = {
    stream: null,
    ctx: null,
    source: null,
    node: null,
    deviceId: null,
    opening: null,
    pressed: false,
    starting: false,
    capturing: false,
    finishing: false,
    sessionId: null,
    transcript: '',
    pre: [],
    batch: []
  };

  function api() {
    return window.zelloBot?.dj;
  }

  function vcApi() {
    return window.zelloBot?.voiceChanger;
  }

  function cleanError(e) {
    return String(e?.message || e || '')
      .replace(/^Error invoking remote method '[^']+':\s*/i, '')
      .replace(/^Error:\s*/i, '');
  }

  function showError(text) {
    const el = $('dj-error');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-hidden', !text);
  }

  function setMeter(id, level) {
    const el = $(id);
    if (!el) return;
    const db = level > 0 ? 20 * Math.log10(level) : -100;
    el.style.width = Math.max(0, Math.min(100, ((db + 60) / 60) * 100)) + '%';
  }

  // ---- capture ----

  function onFrame(data) {
    setMeter('dj-meter-in', Number(data.peak) || 0);
    if (cap.sessionId == null) return;
    cap.batch.push(new Uint8Array(data.pcm));
    if (cap.batch.length < SEND_EVERY_FRAMES) return;
    const total = cap.batch.reduce((n, f) => n + f.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const f of cap.batch) {
      out.set(f, o);
      o += f.length;
    }
    cap.batch = [];
    api().pushPcm(cap.sessionId, out);
  }

  async function openStream(kind, deviceId) {
    const raw = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    if (kind === 'system') {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { ...raw, restrictOwnAudio: true, suppressLocalAudioPlayback: false }
      });
      stream.getVideoTracks().forEach((t) => {
        t.stop();
        stream.removeTrack(t);
      });
      if (!stream.getAudioTracks().length) {
        throw new Error('Windows did not share the PC sound. Try again, or use an audio input / virtual cable.');
      }
      return stream;
    }
    return navigator.mediaDevices.getUserMedia({
      audio: { ...raw, deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: { ideal: 2 } }
    });
  }

  async function startCapture(kind, deviceId, rate) {
    stopCapture();
    if (kind === 'app') return;
    const stream = await openStream(kind, deviceId);
    let ctx;
    try {
      ctx = new AudioContext({ sampleRate: rate, latencyHint: 'interactive' });
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
    const node = new AudioWorkletNode(ctx, 'dj-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions: { rate }
    });
    node.port.onmessage = (ev) => onFrame(ev.data);
    source.connect(node);
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    stream.getAudioTracks().forEach((t) => {
      t.onended = () => {
        if (cap.stream === stream && ui.status?.active) showError('The music input stopped (device unplugged or sharing ended).');
      };
    });
    Object.assign(cap, { stream, ctx, node, source, kind, deviceId, rate, batch: [] });
  }

  function stopCapture() {
    try {
      cap.stream?.getTracks().forEach((t) => t.stop());
      cap.source?.disconnect();
      cap.node?.disconnect();
      cap.ctx?.close();
    } catch {
      /* ignore */
    }
    Object.assign(cap, { stream: null, ctx: null, node: null, source: null, kind: '', deviceId: '', batch: [] });
    setMeter('dj-meter-in', 0);
  }

  // ---- prefs / lists ----

  function savePrefs(changes, delay = 0) {
    ui.prefs = { ...ui.prefs, ...changes };
    clearTimeout(ui.saveTimer);
    ui.saveTimer = setTimeout(async () => {
      try {
        const saved = await api().savePrefs(changes);
        ui.prefs = { ...ui.prefs, ...saved };
        // Other tabs save their whole settings copy — keep it in step
        if (window.V2.state.settings) window.V2.state.settings.dj = saved;
      } catch {
        /* non-fatal */
      }
    }, delay);
  }

  function fillBots(bots) {
    const sel = $('dj-bot');
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
        opt.textContent = b.name + (b.connected ? '' : ' — offline');
        sel.appendChild(opt);
      }
    }
    if ([...sel.options].some((o) => o.value === want)) sel.value = want;
  }

  function fillVoices(voices) {
    const sel = $('dj-voice');
    if (!sel || !Array.isArray(voices)) return;
    const want = sel.value || ui.prefs.voice || '';
    sel.innerHTML = '';
    const def = document.createElement('option');
    def.value = '';
    def.textContent = "Bot's own voice";
    sel.appendChild(def);
    for (const v of voices) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = String(v).replace(/\.wav$/i, '');
      sel.appendChild(opt);
    }
    sel.value = [...sel.options].some((o) => o.value === want) ? want : '';
  }

  function currentTalkMode() {
    return $('dj-vc-mode')?.value === 'repeat' ? 'repeat' : 'live';
  }

  function fillVcVoices(voices) {
    const sel = $('dj-vc-voice');
    if (!sel || !Array.isArray(voices)) return;
    const want =
      sel.value ||
      ui.prefs.vcVoice ||
      (currentTalkMode() === 'repeat' ? '' : 'dsp:robot');
    const sig = JSON.stringify(voices);
    if (sel.dataset.sig === sig && sel.options.length) {
      applyModeToVcVoices();
      if ([...sel.options].some((o) => o.value === want && !o.disabled)) sel.value = want;
      return;
    }
    sel.dataset.sig = sig;
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
    applyModeToVcVoices();
    if ([...sel.options].some((o) => o.value === want && !o.disabled)) sel.value = want;
    else {
      const first = [...sel.options].find((o) => !o.disabled);
      if (first) sel.value = first.value;
    }
  }

  function applyModeToVcVoices() {
    const sel = $('dj-vc-voice');
    if (!sel) return;
    const repeat = currentTalkMode() === 'repeat';
    for (const opt of sel.options) {
      opt.disabled = repeat && opt.dataset.kind === 'dsp';
    }
    if (sel.selectedOptions[0]?.disabled) {
      const firstClip = [...sel.options].find((o) => !o.disabled);
      if (firstClip) sel.value = firstClip.value;
    }
  }

  async function fillVcDevices() {
    const sel = $('dj-vc-device');
    if (!sel || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === 'audioinput'
      );
      const want = sel.value || ui.prefs.vcDeviceId || '';
      sel.innerHTML = '';
      const def = document.createElement('option');
      def.value = '';
      def.textContent = 'System default mic';
      sel.appendChild(def);
      for (const d of devices) {
        if (d.deviceId === 'default' || d.deviceId === 'communications') continue;
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || 'Mic ' + sel.options.length;
        sel.appendChild(opt);
      }
      sel.value = [...sel.options].some((o) => o.value === want) ? want : '';
    } catch {
      /* ignore */
    }
  }

  async function refreshVcVoices() {
    if (!vcApi()) return;
    try {
      const info = await vcApi().info();
      fillVcVoices(info.voices || []);
    } catch {
      /* converter offline is fine for DSP */
    }
  }

  function renderPtt() {
    const btn = $('dj-ptt');
    if (!btn) return;
    const djOn = ui.status?.active === true;
    const repeat = currentTalkMode() === 'repeat';
    const live = talk.pressed || talk.starting || talk.capturing;
    btn.disabled = (!djOn && !live) || talk.finishing;
    btn.classList.toggle('is-live', live && !talk.finishing);
    btn.classList.toggle('is-busy', talk.finishing);
    const label = $('dj-ptt-label');
    if (label) {
      if (talk.finishing) {
        label.textContent = talk.transcript
          ? 'Heard: "' + talk.transcript.slice(0, 60) + '" — speaking…'
          : 'Finishing…';
      } else if (live) {
        label.textContent = repeat
          ? 'Recording… release to send in that voice'
          : 'ON AIR — talking over music';
      } else {
        label.textContent = repeat
          ? 'Hold to speak, then release to repeat'
          : 'Hold to talk over music';
      }
    }
    const hint = $('dj-ptt-hint');
    if (hint) {
      if (!djOn) {
        hint.textContent = 'Start DJ first · voice mixes over the music';
      } else if (repeat) {
        hint.textContent =
          'Needs a character voice clip · Space while Live is open';
      } else {
        hint.textContent = 'Release to stop · Space while Live is open';
      }
    }
  }

  function setPttMeter(peak) {
    const el = $('dj-ptt-meter');
    if (!el) return;
    const db = peak > 0 ? 20 * Math.log10(peak) : -100;
    el.style.width = Math.max(0, Math.min(100, ((db + 60) / 60) * 100)) + '%';
  }

  function onTalkFrame(data) {
    setPttMeter(Number(data.peak) || 0);
    if (!talk.capturing) return;
    const frame = new Uint8Array(data.pcm);
    if (talk.sessionId == null) {
      talk.pre.push(frame);
      return;
    }
    talk.batch.push(frame);
    if (talk.batch.length >= SEND_EVERY_FRAMES) sendTalkBatch();
  }

  function sendTalkBatch() {
    if (!talk.batch.length || talk.sessionId == null || !vcApi()) return;
    const total = talk.batch.reduce((n, f) => n + f.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const f of talk.batch) {
      out.set(f, o);
      o += f.length;
    }
    talk.batch = [];
    vcApi().pushPcm(talk.sessionId, out);
  }

  async function openTalkMic() {
    const deviceId = $('dj-vc-device')?.value || '';
    if (talk.stream && talk.deviceId === deviceId) return;
    if (talk.opening) return talk.opening;
    talk.opening = (async () => {
      closeTalkMic();
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
        ctx = new AudioContext({ sampleRate: VC_RATE, latencyHint: 'interactive' });
      } catch {
        ctx = new AudioContext({ latencyHint: 'interactive' });
      }
      const url = URL.createObjectURL(new Blob([VC_WORKLET_SRC], { type: 'application/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'dj-vc-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 0
      });
      node.port.onmessage = (ev) => onTalkFrame(ev.data);
      source.connect(node);
      Object.assign(talk, { stream, ctx, source, node, deviceId });
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    })();
    try {
      await talk.opening;
      await fillVcDevices();
    } finally {
      talk.opening = null;
    }
  }

  function closeTalkMic() {
    try {
      talk.stream?.getTracks().forEach((t) => t.stop());
      talk.source?.disconnect();
      talk.node?.disconnect();
      talk.ctx?.close();
    } catch {
      /* ignore */
    }
    Object.assign(talk, {
      stream: null,
      ctx: null,
      source: null,
      node: null,
      deviceId: null
    });
    setPttMeter(0);
  }

  async function pressTalk() {
    if (talk.pressed || talk.starting || talk.finishing) return;
    if (!vcApi()) {
      showError('Voice changer is not available.');
      return;
    }
    if (!ui.status?.active) {
      showError('Start DJ first, then hold to talk over the music.');
      return;
    }
    const botId = $('dj-bot')?.value || ui.status?.botId || '';
    if (!botId) {
      showError('Pick a DJ bot first.');
      return;
    }
    showError('');
    talk.pressed = true;
    talk.starting = true;
    renderPtt();
    try {
      await openTalkMic();
    } catch (e) {
      talk.pressed = false;
      talk.starting = false;
      renderPtt();
      showError('Talk mic: ' + cleanError(e));
      return;
    }
    talk.pre = [];
    talk.batch = [];
    talk.sessionId = null;
    talk.transcript = '';
    talk.capturing = true;
    const mode = currentTalkMode();
    const voice =
      $('dj-vc-voice')?.value ||
      ui.prefs.vcVoice ||
      (mode === 'repeat' ? '' : 'dsp:robot');
    if (mode === 'repeat' && (!voice || voice.startsWith('dsp:'))) {
      talk.capturing = false;
      talk.pressed = false;
      talk.starting = false;
      talk.pre = [];
      renderPtt();
      showError(
        'Speak then repeat needs a character voice clip (not an instant effect).'
      );
      return;
    }
    const opts = {
      botId,
      voice,
      mode,
      test: false
    };
    let res;
    try {
      res = await vcApi().start(opts);
    } catch (e) {
      talk.capturing = false;
      talk.pressed = false;
      talk.starting = false;
      talk.pre = [];
      renderPtt();
      showError(cleanError(e));
      return;
    }
    talk.starting = false;
    talk.sessionId = res.sessionId;
    talk.batch = talk.pre;
    talk.pre = [];
    sendTalkBatch();
    if (!talk.pressed) {
      await finishTalk();
      return;
    }
    renderPtt();
  }

  async function releaseTalk() {
    if (!talk.pressed) return;
    talk.pressed = false;
    if (talk.starting) return;
    await finishTalk();
  }

  async function finishTalk() {
    if (talk.sessionId == null || talk.finishing) return;
    sendTalkBatch();
    talk.capturing = false;
    talk.finishing = true;
    renderPtt();
    const id = talk.sessionId;
    try {
      const r = await vcApi().stop(id);
      if (r && r.ok === false && r.error) showError(r.error);
      else if (r?.skipped) showError('Too short — hold while you talk, then release.');
      else if (r?.transcript) {
        showError('');
        talk.transcript = r.transcript;
        if ($('dj-state')) {
          $('dj-state').textContent =
            'Repeated: "' + String(r.transcript).slice(0, 80) + '"';
        }
      }
    } catch (e) {
      showError(cleanError(e));
    } finally {
      talk.sessionId = null;
      talk.finishing = false;
      talk.transcript = '';
      renderPtt();
    }
  }

  function isEditable(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function isLiveView() {
    return $('view-live')?.classList.contains('is-active');
  }

  function onTalkKeyDown(e) {
    if (!isLiveView() || e.repeat || e.code !== 'Space') return;
    if (isEditable(e.target) || e.ctrlKey || e.altKey || e.metaKey) return;
    if (!ui.status?.active) return;
    e.preventDefault();
    pressTalk();
  }

  function onTalkKeyUp(e) {
    if (e.code !== 'Space') return;
    if (!talk.pressed) return;
    e.preventDefault();
    releaseTalk();
  }

  async function fillDevices() {
    const sel = $('dj-device');
    if (!sel || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      const want = sel.value || ui.prefs.deviceId || '';
      sel.innerHTML = '';
      const def = document.createElement('option');
      def.value = '';
      def.textContent = 'System default input';
      sel.appendChild(def);
      for (const d of devices) {
        if (d.deviceId === 'default' || d.deviceId === 'communications') continue;
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || 'Input ' + sel.options.length;
        sel.appendChild(opt);
      }
      sel.value = [...sel.options].some((o) => o.value === want) ? want : '';
    } catch {
      /* ignore */
    }
  }

  async function refreshInfo({ voices = false } = {}) {
    if (!api()) return;
    try {
      const info = await api().info({ voices });
      ui.info = info;
      fillBots(info.bots || []);
      if (voices) fillVoices(info.voices || []);
      applyStatus(info.status);
    } catch (e) {
      showError(cleanError(e));
    }
  }

  // ---- render ----

  function renderSource() {
    const source = $('dj-source')?.value || 'device';
    $('dj-device-field')?.classList.toggle('is-hidden', source !== 'device');
    $('dj-app')?.classList.toggle('is-hidden', source !== 'app');
    if ($('dj-source-hint')) $('dj-source-hint').textContent = SOURCE_HINTS[source] || '';
  }

  function renderSliders() {
    const p = ui.prefs;
    const set = (id, valId, v) => {
      if ($(id) && document.activeElement !== $(id)) $(id).value = String(v);
      if ($(valId)) $(valId).textContent = Math.round(v) + '%';
    };
    set('dj-music', 'dj-music-val', Number(p.musicVolume ?? 80));
    set('dj-duck', 'dj-duck-val', Number(p.duckLevel ?? 20));
    set('dj-voicevol', 'dj-voicevol-val', Number(p.voiceVolume ?? 100));
  }

  function renderQuick() {
    const lines = Array.isArray(ui.prefs.quickLines) ? ui.prefs.quickLines : [];
    const sig = JSON.stringify(lines);
    if (sig === ui.quickSig) return;
    ui.quickSig = sig;
    const wrap = $('dj-quick');
    const edit = $('dj-quick-edit');
    if (wrap) {
      wrap.innerHTML = '';
      lines.forEach((text, i) => {
        if (!text) return;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn dj-quick-btn';
        b.title = text;
        b.textContent = (i + 1) + '. ' + text;
        b.addEventListener('click', () => say(text));
        wrap.appendChild(b);
      });
    }
    if (edit) {
      edit.innerHTML = '';
      for (let i = 0; i < 6; i += 1) {
        const label = document.createElement('label');
        label.textContent = 'Quick line ' + (i + 1);
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'dj-quick-input';
        input.value = lines[i] || '';
        input.maxLength = 300;
        label.appendChild(input);
        edit.appendChild(label);
      }
    }
  }

  const STATE_TEXT = {
    rendering: 'rendering…',
    queued: 'queued',
    'on air': 'ON AIR',
    done: 'done',
    failed: 'failed',
    cancelled: 'cancelled'
  };

  function renderLines(lines) {
    const wrap = $('dj-lines');
    if (!wrap) return;
    const list = (lines || []).slice(-8).reverse();
    const sig = JSON.stringify(list.map((l) => [l.id, l.state]));
    if (sig === ui.linesSig) return;
    ui.linesSig = sig;
    wrap.innerHTML = '';
    for (const l of list) {
      const row = document.createElement('div');
      row.className = 'dj-line is-' + l.state.replace(/\s+/g, '-');
      const st = document.createElement('span');
      st.className = 'dj-line-state';
      st.textContent = STATE_TEXT[l.state] || l.state;
      const txt = document.createElement('span');
      txt.className = 'dj-line-text';
      txt.textContent = l.text + (l.voice ? ' · ' + l.voice.replace(/\.wav$/i, '') : '') + (l.error ? ' — ' + l.error : '');
      row.appendChild(st);
      row.appendChild(txt);
      if (l.state === 'rendering' || l.state === 'queued') {
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'btn dj-line-x';
        x.textContent = '✕';
        x.title = 'Cancel this line';
        x.addEventListener('click', () => api().cancelLine(l.id).catch(() => {}));
        row.appendChild(x);
      }
      wrap.appendChild(row);
    }
  }

  function applyStatus(st) {
    if (!st) return;
    ui.status = st;
    const active = st.active === true;
    const btn = $('btn-dj');
    if (btn) {
      btn.textContent = active ? 'Stop DJ' : 'Start DJ';
      btn.classList.toggle('danger', active);
      btn.classList.toggle('primary', !active);
    }
    const onAir = active && st.state === 'on-air';
    const badge = $('dj-onair');
    if (badge) {
      badge.textContent = onAir ? (st.talking ? 'ON AIR · TALKING' : 'ON AIR') : active ? (st.state === 'offline' ? 'BOT OFFLINE' : 'GETTING THE BUTTON…') : 'OFF AIR';
      badge.classList.toggle('is-live', onAir);
      badge.classList.toggle('is-wait', active && !onAir);
    }
    ['dj-bot', 'dj-rate'].forEach((id) => {
      if ($(id)) $(id).disabled = active;
    });
    if (active) {
      setMeter('dj-meter-out', onAir ? st.levels?.out || 0 : 0);
      const parts = [];
      parts.push(onAir ? 'On air as ' + st.botName : st.state === 'offline' ? st.botName + ' is offline — waiting' : 'Requesting the button as ' + st.botName + '…');
      parts.push((st.sampleRate || 16000) / 1000 + ' kHz');
      if (onAir && st.levels) parts.push('music ×' + (st.levels.duck || 0).toFixed(2));
      if (st.refreshes) parts.push(st.refreshes + ' refresh' + (st.refreshes === 1 ? '' : 'es'));
      if (st.keyOffs) parts.push(st.keyOffs + ' key-off' + (st.keyOffs === 1 ? '' : 's'));
      if ($('dj-state')) $('dj-state').textContent = parts.join(' · ');
    } else {
      setMeter('dj-meter-out', 0);
      if ($('dj-state')) $('dj-state').textContent = 'Off';
      if (cap.stream) stopCapture();
      cap.sessionId = null;
      if (talk.pressed || talk.capturing || talk.sessionId != null) {
        releaseTalk();
      }
    }
    if ($('dj-now')) {
      const np = st.nowPlaying;
      const q = st.queue || [];
      $('dj-now').textContent =
        (np ? 'Now playing: ' + np.title : 'Nothing playing') +
        (q.length ? ' · Up next: ' + q.slice(0, 3).map((t) => t.title).join(', ') + (q.length > 3 ? ' +' + (q.length - 3) : '') : '');
    }
    renderLines(st.lines);
    renderPtt();
  }

  // ---- actions ----

  async function start() {
    showError('');
    const botId = $('dj-bot')?.value || '';
    const source = $('dj-source')?.value || 'device';
    const sampleRate = Number($('dj-rate')?.value) || 24000;
    const deviceId = $('dj-device')?.value || '';
    if (!botId) {
      showError('Pick a bot to DJ as.');
      return;
    }
    const btn = $('btn-dj');
    if (btn) btn.disabled = true;
    try {
      await startCapture(source, deviceId, sampleRate);
      if (source === 'device') fillDevices();
      const res = await api().start({ botId, source, sampleRate });
      cap.sessionId = res.sessionId;
    } catch (e) {
      stopCapture();
      showError(cleanError(e));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function stop() {
    const btn = $('btn-dj');
    if (btn) btn.disabled = true;
    try {
      await releaseTalk();
      await api().stop();
    } catch (e) {
      showError(cleanError(e));
    } finally {
      stopCapture();
      closeTalkMic();
      cap.sessionId = null;
      if (btn) btn.disabled = false;
      renderPtt();
    }
  }

  async function changeSource() {
    const source = $('dj-source')?.value || 'device';
    renderSource();
    savePrefs({ source });
    if (!ui.status?.active) return;
    showError('');
    const keep = cap.sessionId;
    try {
      await startCapture(source, $('dj-device')?.value || '', ui.status.sampleRate || 24000);
      cap.sessionId = keep;
      await api().setSource(source);
    } catch (e) {
      showError(cleanError(e));
    }
  }

  async function changeDevice() {
    savePrefs({ deviceId: $('dj-device')?.value || '' });
    if (!ui.status?.active || ($('dj-source')?.value || '') !== 'device') return;
    const keep = cap.sessionId;
    try {
      await startCapture('device', $('dj-device')?.value || '', ui.status.sampleRate || 24000);
      cap.sessionId = keep;
    } catch (e) {
      showError(cleanError(e));
    }
  }

  async function say(text) {
    const clean = String(text || '').trim();
    if (!clean) return;
    showError('');
    try {
      await api().say({ text: clean, voice: $('dj-voice')?.value || '' });
    } catch (e) {
      showError(cleanError(e));
    }
  }

  async function addSong() {
    const input = $('dj-song');
    const q = (input?.value || '').trim();
    if (!q) return;
    showError('');
    input.value = '';
    try {
      await api().addSong(q);
    } catch (e) {
      showError(cleanError(e));
    }
  }

  function saveEdit() {
    const quickLines = [...document.querySelectorAll('#dj-quick-edit .dj-quick-input')].map((i) => i.value.trim());
    const refresh = Math.round(Number($('dj-refresh')?.value));
    savePrefs({
      quickLines,
      djName: ($('dj-name')?.value || '').trim(),
      introLine: ($('dj-intro')?.value || '').trim(),
      ...(refresh >= 10 && refresh <= 85 ? { refreshSec: refresh } : {})
    });
    ui.quickSig = '';
    renderQuick();
  }

  function fill(settings) {
    ui.prefs = { ...(settings?.dj || {}) };
    if ($('dj-source')) $('dj-source').value = ui.prefs.source || 'device';
    if ($('dj-rate')) $('dj-rate').value = String(ui.prefs.sampleRate || 24000);
    if ($('dj-name')) $('dj-name').value = ui.prefs.djName || '';
    if ($('dj-intro')) $('dj-intro').value = ui.prefs.introLine || '';
    if ($('dj-refresh')) $('dj-refresh').value = String(ui.prefs.refreshSec || 50);
    if ($('dj-vc-mode')) {
      $('dj-vc-mode').value = ui.prefs.vcMode === 'repeat' ? 'repeat' : 'live';
    }
    if ($('dj-vc-voice') && ui.prefs.vcVoice) {
      const sel = $('dj-vc-voice');
      applyModeToVcVoices();
      if ([...sel.options].some((o) => o.value === ui.prefs.vcVoice && !o.disabled)) {
        sel.value = ui.prefs.vcVoice;
      }
    }
    if ($('dj-vc-device') && ui.prefs.vcDeviceId != null) {
      const sel = $('dj-vc-device');
      if ([...sel.options].some((o) => o.value === ui.prefs.vcDeviceId)) {
        sel.value = ui.prefs.vcDeviceId;
      }
    }
    renderSource();
    renderSliders();
    renderQuick();
    renderPtt();
  }

  function bind() {
    if (!api()) return;
    $('btn-dj')?.addEventListener('click', () => (ui.status?.active ? stop() : start()));
    $('dj-source')?.addEventListener('change', () => changeSource());
    $('dj-device')?.addEventListener('change', () => changeDevice());
    $('dj-device')?.addEventListener('focus', () => fillDevices());
    $('dj-bot')?.addEventListener('change', (e) => savePrefs({ botId: e.target.value }));
    $('dj-rate')?.addEventListener('change', (e) => savePrefs({ sampleRate: Number(e.target.value) }));
    $('dj-voice')?.addEventListener('change', (e) => savePrefs({ voice: e.target.value }));
    $('dj-vc-mode')?.addEventListener('change', (e) => {
      const mode = e.target.value === 'repeat' ? 'repeat' : 'live';
      applyModeToVcVoices();
      savePrefs({ vcMode: mode, vcVoice: $('dj-vc-voice')?.value || '' });
      renderPtt();
    });
    $('dj-vc-voice')?.addEventListener('change', (e) => savePrefs({ vcVoice: e.target.value }));
    $('dj-vc-device')?.addEventListener('change', (e) => {
      savePrefs({ vcDeviceId: e.target.value });
      closeTalkMic();
    });
    $('dj-vc-device')?.addEventListener('focus', () => fillVcDevices());
    const slider = (id, key) =>
      $(id)?.addEventListener('input', (e) => {
        savePrefs({ [key]: Number(e.target.value) }, 120);
        renderSliders();
      });
    slider('dj-music', 'musicVolume');
    slider('dj-duck', 'duckLevel');
    slider('dj-voicevol', 'voiceVolume');
    $('btn-dj-say')?.addEventListener('click', () => {
      say($('dj-say').value);
      $('dj-say').value = '';
    });
    $('dj-say')?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      say(e.target.value);
      e.target.value = '';
    });
    $('dj-song')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addSong();
      }
    });
    $('dj-add-song')?.addEventListener('click', () => addSong());
    $('dj-add-file')?.addEventListener('click', () => api().addFile().catch((e) => showError(cleanError(e))));
    $('dj-skip')?.addEventListener('click', () => api().skip().catch(() => {}));
    $('dj-edit-save')?.addEventListener('click', () => saveEdit());

    const ptt = $('dj-ptt');
    ptt?.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      try {
        ptt.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      pressTalk();
    });
    ptt?.addEventListener('pointerup', () => releaseTalk());
    ptt?.addEventListener('pointercancel', () => releaseTalk());
    ptt?.addEventListener('lostpointercapture', () => releaseTalk());
    window.addEventListener('keydown', onTalkKeyDown);
    window.addEventListener('keyup', onTalkKeyUp);
    window.addEventListener('blur', () => releaseTalk());

    api().onStatus(applyStatus);
    if (vcApi()?.onStatus) {
      vcApi().onStatus((st) => {
        if (!st) return;
        if (st.sessionId != null && st.sessionId === talk.sessionId) {
          if (st.state === 'finishing') {
            talk.finishing = true;
            talk.transcript = st.transcript || talk.transcript || '';
            talk.capturing = false;
            renderPtt();
          } else if (st.state === 'recording') {
            renderPtt();
          }
        }
        if (
          (st.state === 'idle' || st.state === 'error') &&
          talk.sessionId != null &&
          st.sessionId === talk.sessionId
        ) {
          talk.capturing = false;
          talk.sessionId = null;
          talk.pressed = false;
          talk.batch = [];
          talk.finishing = false;
          renderPtt();
          if (st.error) showError(st.error);
        }
      });
    }
    fillDevices();
    fillVcDevices();
    refreshInfo({ voices: true });
    refreshVcVoices();
    setInterval(() => {
      if (!ui.status?.active) refreshInfo({ voices: false });
    }, 10000);
    renderPtt();
  }

  window.V2.dj = { bind, fill, refreshInfo };
})();
