window.V2 = window.V2 || {};

(function () {
  const $ = window.V2.$;

  function fill(settings) {
    if (!settings) return;
    const ai = settings.ai || {};
    const speech = settings.speech || {};
    const mb = settings.multiBot || {};

    if ($('llm-host-mode')) $('llm-host-mode').value = ai.llmHostMode || 'other-pc';
    if ($('ollama-url-this')) $('ollama-url-this').value = ai.ollamaUrlThisPc || ai.ollamaUrl || '';
    if ($('ollama-url-other')) $('ollama-url-other').value = ai.ollamaUrlOtherPc || '';
    if ($('ollama-model')) $('ollama-model').value = ai.model || '';
    if ($('stt-url')) $('stt-url').value = speech.sttUrl || '';
    if ($('omnivoice-url')) $('omnivoice-url').value = speech.omnivoiceUrl || '';
    if ($('omnivoice-voice')) $('omnivoice-voice').value = speech.omnivoiceVoice || '';

    if ($('reply-mode')) $('reply-mode').value = mb.replyMode || 'random';
    if ($('max-fighters')) $('max-fighters').value = mb.maxFighters ?? 3;
    if ($('cooldown-ms')) $('cooldown-ms').value = mb.cooldownMs ?? 0;
    if ($('chat-mode')) $('chat-mode').value = mb.chatMode || 'banter';
    if ($('max-user-talk')) $('max-user-talk').value = mb.maxUserTalkMs ?? 20000;
    if ($('bot-speak-sec')) $('bot-speak-sec').value = mb.botSpeakTargetSec ?? 12;
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

    next.multiBot.replyMode = $('reply-mode')?.value || 'random';
    next.multiBot.maxFighters = Number($('max-fighters')?.value || 3);
    next.multiBot.cooldownMs = Number($('cooldown-ms')?.value || 0);
    next.multiBot.chatMode = $('chat-mode')?.value || 'banter';
    next.multiBot.maxUserTalkMs = Number($('max-user-talk')?.value || 20000);
    next.multiBot.botSpeakTargetSec = Number($('bot-speak-sec')?.value || 12);
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
  }

  window.V2.engines = {
    bind,
    fill,
    saveEngines,
    probeBrain,
    probeStt,
    probeTts
  };
})();
