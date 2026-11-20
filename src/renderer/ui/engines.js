window.V2 = window.V2 || {};

(function () {
  const $ = window.V2.$;

  /** @type {{ reachable: boolean, models: { name: string, size: number }[] } | null} */
  let modelList = null;
  let modelLoadSeq = 0;

  function formatSize(bytes) {
    if (!bytes) return '';
    return bytes >= 1e9
      ? (bytes / 1e9).toFixed(1) + ' GB'
      : Math.round(bytes / 1e6) + ' MB';
  }

  function renderModelOptions(selected) {
    const sel = $('ollama-model');
    if (!sel) return;
    const models = modelList?.reachable ? modelList.models : [];
    let want = String(selected || '').trim();
    if (want && !want.includes(':') && models.some((m) => m.name === want + ':latest')) {
      want += ':latest';
    }
    sel.innerHTML = '';

    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.name;
      const size = formatSize(m.size);
      opt.textContent = size ? m.name + ' (' + size + ')' : m.name;
      sel.appendChild(opt);
    }

    if (!models.some((m) => m.name === want)) {
      const opt = document.createElement('option');
      opt.value = want;
      if (!modelList) opt.textContent = want || '(loading…)';
      else if (!modelList.reachable) opt.textContent = (want || '(no model)') + ' (host offline)';
      else opt.textContent = (want || '(no model)') + ' (not installed)';
      sel.insertBefore(opt, sel.firstChild);
    }
    sel.value = want;
  }

  async function loadModels() {
    const status = $('ollama-model-status');
    if (!window.zelloBot?.llm?.models) return;
    const seq = ++modelLoadSeq;
    if (status) status.textContent = 'Loading models…';
    let result;
    try {
      result = await window.zelloBot.llm.models({
        ai: {
          llmHostMode: $('llm-host-mode')?.value || 'other-pc',
          ollamaUrlThisPc: $('ollama-url-this')?.value?.trim() || '',
          ollamaUrlOtherPc: $('ollama-url-other')?.value?.trim() || ''
        }
      });
    } catch {
      result = { reachable: false, models: [] };
    }
    if (seq !== modelLoadSeq) return;
    modelList = {
      reachable: result?.reachable === true,
      models: Array.isArray(result?.models) ? result.models : []
    };
    renderModelOptions($('ollama-model')?.value || '');
    if (!status) return;
    const where = (result?.hostLabel || 'Brain') + ' · ' + (result?.ollamaUrl || '?');
    status.textContent = modelList.reachable
      ? where + ' · ' + modelList.models.length + ' models' +
        (result.hidden ? ' (' + result.hidden + ' vision/embedding hidden)' : '')
      : where + ' · host offline';
  }

  function fill(settings) {
    if (!settings) return;
    const ai = settings.ai || {};
    const speech = settings.speech || {};
    const mb = settings.multiBot || {};

    if ($('llm-host-mode')) $('llm-host-mode').value = ai.llmHostMode || 'other-pc';
    if ($('ollama-url-this')) $('ollama-url-this').value = ai.ollamaUrlThisPc || ai.ollamaUrl || '';
    if ($('ollama-url-other')) $('ollama-url-other').value = ai.ollamaUrlOtherPc || '';
    renderModelOptions(ai.model || '');
    loadModels();
    if ($('stt-url')) $('stt-url').value = speech.sttUrl || '';
    if ($('omnivoice-url')) $('omnivoice-url').value = speech.omnivoiceUrl || '';
    if ($('omnivoice-voice')) $('omnivoice-voice').value = speech.omnivoiceVoice || '';
    if ($('auto-capture-voices')) $('auto-capture-voices').checked = speech.autoCaptureVoices === true;
    if ($('auto-switch-new-voice')) $('auto-switch-new-voice').checked = speech.autoSwitchToNewVoice === true;

    if ($('reply-mode')) $('reply-mode').value = mb.replyMode || 'random';
    if ($('max-fighters')) $('max-fighters').value = mb.maxFighters ?? 3;
    if ($('cooldown-ms')) $('cooldown-ms').value = mb.cooldownMs ?? 0;
    if ($('chat-mode')) $('chat-mode').value = mb.chatMode || 'banter';
    if ($('max-user-talk')) $('max-user-talk').value = mb.maxUserTalkMs ?? 8000;
    if ($('bot-speak-sec')) $('bot-speak-sec').value = mb.botSpeakTargetSec ?? 10;
    const auto = ai.autoReply !== false;
    if ($('mode-listen')) $('mode-listen').checked = !auto;
    if ($('mode-reply')) $('mode-reply').checked = auto;
    if ($('allow-peer-chat')) $('allow-peer-chat').checked = mb.allowPeerChat !== false;
    if ($('cut-in-capped')) $('cut-in-capped').checked = mb.cutInWhenCapped !== false;
    if ($('interrupt-reset')) $('interrupt-reset').checked = mb.interruptReset !== false;
  }

  function readIntoSettings(settings) {
    const next = window.V2.cloneSettings(settings);
    next.ai = next.ai || {};
    next.speech = next.speech || {};
    next.multiBot = next.multiBot || {};

    next.ai.llmHostMode = $('llm-host-mode')?.value || 'other-pc';
    next.ai.ollamaUrlThisPc = $('ollama-url-this')?.value?.trim() || '';
    next.ai.ollamaUrlOtherPc = $('ollama-url-other')?.value?.trim() || '';
    next.ai.ollamaUrl = next.ai.ollamaUrlThisPc || next.ai.ollamaUrl;
    next.ai.model = $('ollama-model')?.value?.trim() || '';
    // Channel mode radios → autoReply
    if ($('mode-listen')?.checked) {
      next.ai.autoReply = false;
    } else if ($('mode-reply')?.checked) {
      next.ai.autoReply = true;
    } else {
      next.ai.autoReply = true;
    }

    next.speech.sttUrl = $('stt-url')?.value?.trim() || '';
    next.speech.omnivoiceUrl = $('omnivoice-url')?.value?.trim() || '';
    next.speech.omnivoiceVoice = $('omnivoice-voice')?.value?.trim() || '';
    next.speech.autoCaptureVoices = $('auto-capture-voices')?.checked === true;
    next.speech.autoSwitchToNewVoice = $('auto-switch-new-voice')?.checked === true;

    next.multiBot.replyMode = $('reply-mode')?.value || 'random';
    next.multiBot.maxFighters = Number($('max-fighters')?.value || 3);
    next.multiBot.cooldownMs = Number($('cooldown-ms')?.value || 0);
    next.multiBot.chatMode = $('chat-mode')?.value || 'banter';
    next.multiBot.maxUserTalkMs = Number($('max-user-talk')?.value || 8000);
    next.multiBot.botSpeakTargetSec = Number($('bot-speak-sec')?.value || 10);
    next.multiBot.allowPeerChat = $('allow-peer-chat')?.checked !== false;
    next.multiBot.cutInWhenCapped = $('cut-in-capped')?.checked !== false;
    next.multiBot.interruptReset = $('interrupt-reset')?.checked !== false;

    return next;
  }

  async function saveEngines() {
    if (!window.zelloBot?.settings || !window.V2.state.settings) return;
    const next = readIntoSettings(window.V2.state.settings);
    const saved = await window.zelloBot.settings.save(next);
    window.V2.state.settings = saved;
    fill(saved);
    window.V2.live?.updateModeBadge?.(saved);
    $('brain-probe-result').textContent = 'Engines saved';
    if ($('engines-save-hint')) {
      const mode = saved?.ai?.autoReply === false ? 'Listen only' : 'Listen + auto reply';
      $('engines-save-hint').textContent = 'Saved · ' + mode;
      setTimeout(() => {
        if ($('engines-save-hint')) $('engines-save-hint').textContent = '';
      }, 2500);
    }
  }

  async function probeBrain() {
    const el = $('brain-probe-result');
    try {
      const snap = await window.zelloBot.llm.snapshot({ force: true });
      const host = snap?.resolvedUrl || snap?.url || 'ok';
      const model = snap?.model || window.V2.state.settings?.ai?.model || '';
      const ok = snap?.ok !== false && !snap?.error;
      if (el) el.textContent = host + (model ? ' · ' + model : '');
      if ($('brain-status')) $('brain-status').textContent = ok ? (model || host) : 'Down';
      window.V2.setDot('dot-brain', ok ? 'on' : 'warn');
    } catch (e) {
      if (el) el.textContent = e?.message || 'Probe failed';
      if ($('brain-status')) $('brain-status').textContent = 'Down';
      window.V2.setDot('dot-brain', 'warn');
    }
  }

  async function probeStt() {
    const el = $('speech-probe-result');
    try {
      const r = await window.zelloBot.voiceBot.sttHealth();
      const ok = window.V2.isServiceOk(r);
      if (el) el.textContent = 'STT: ' + (ok ? 'OK' : JSON.stringify(r));
      if ($('stt-status')) $('stt-status').textContent = ok ? 'Listening' : 'Down';
      window.V2.setDot('dot-stt', ok ? 'on' : 'warn');
    } catch (e) {
      if (el) el.textContent = 'STT: ' + (e?.message || 'failed');
      if ($('stt-status')) $('stt-status').textContent = 'Down';
      window.V2.setDot('dot-stt', 'warn');
    }
  }

  async function probeTts() {
    const el = $('speech-probe-result');
    try {
      const r = await window.zelloBot.voiceBot.omnivoiceHealth();
      const ok = window.V2.isServiceOk(r);
      if (el) el.textContent = 'OmniVoice: ' + (ok ? 'OK' : JSON.stringify(r));
      if ($('tts-status')) $('tts-status').textContent = ok ? 'Ready' : 'Down';
      window.V2.setDot('dot-tts', ok ? 'on' : 'warn');
      const voices = await window.zelloBot.voiceBot.omnivoiceVoices();
      const list = Array.isArray(voices)
        ? voices
        : Array.isArray(voices?.voices)
          ? voices.voices
          : [];
      window.V2.state.voices = list.map((v) =>
        typeof v === 'string' ? { name: v } : v
      );
      const dl = $('voice-datalist');
      if (dl) {
        dl.innerHTML = '';
        for (const v of window.V2.state.voices) {
          const opt = document.createElement('option');
          opt.value = v.name || v;
          dl.appendChild(opt);
        }
      }
    } catch (e) {
      if (el) el.textContent = 'OmniVoice: ' + (e?.message || 'failed');
      if ($('tts-status')) $('tts-status').textContent = 'Down';
      window.V2.setDot('dot-tts', 'warn');
    }
  }

  function bind() {
    $('engines-save')?.addEventListener('click', () => saveEngines());
    $('btn-probe-brain')?.addEventListener('click', () => probeBrain());
    $('btn-probe-stt')?.addEventListener('click', () => probeStt());
    $('btn-probe-tts')?.addEventListener('click', () => probeTts());
    $('btn-refresh-models')?.addEventListener('click', () => loadModels());
    for (const id of ['llm-host-mode', 'ollama-url-this', 'ollama-url-other']) {
      $(id)?.addEventListener('change', () => loadModels());
    }
  }

  window.V2.engines = {
    bind,
    fill,
    saveEngines,
    probeBrain,
    probeStt,
    probeTts,
    loadModels
  };
})();
