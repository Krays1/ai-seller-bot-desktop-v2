(function () {
  const $ = window.V2.$;

  function showView(name) {
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.view === name);
    });
    document.querySelectorAll('.view').forEach((view) => {
      view.classList.toggle('is-active', view.dataset.view === name);
    });
  }

  function applyZelloStatus(status) {
    const label = $('zello-status');
    const connectedCount = Number(status?.connectedCount || 0);
    const statusText = String(status?.status || '').toLowerCase();
    const connected =
      status?.connected === true ||
      status?.aggregate === 'connected' ||
      connectedCount > 0 ||
      statusText === 'connected' ||
      statusText === 'partial';

    window.V2.state.zelloConnected = connected;
    if (label) {
      if (connected) {
        const n =
          connectedCount ||
          status?.bots?.filter?.((b) => b.status === 'connected')?.length;
        const ch =
          status?.listenOwnerChannel || status?.channelName || '';
        label.textContent = n
          ? 'Connected · ' + n + (ch ? ' · ' + ch : '')
          : 'Connected';
      } else {
        label.textContent = status?.status || status?.message || 'Disconnected';
      }
    }
    window.V2.setDot('dot-zello', connected ? 'on' : 'off');
    $('btn-disconnect').disabled = !connected;
    window.V2.roster?.updateStatuses?.(status);

    if ($('diag-listen-channel')) {
      $('diag-listen-channel').textContent =
        status?.listenOwnerChannel || status?.channelName || '—';
    }
    if ($('diag-listen-bot')) {
      $('diag-listen-bot').textContent =
        status?.listenOwnerUsername || status?.botUsername || '—';
    }
  }

  async function refreshZello() {
    try {
      const status = await window.zelloBot.zelloRuntime.status();
      applyZelloStatus(status || {});
    } catch {
      applyZelloStatus({ status: 'Error' });
      window.V2.setDot('dot-zello', 'warn');
    }
  }
  window.V2._refreshZello = refreshZello;

  async function refreshAudio() {
    try {
      const st = await window.zelloBot.audio.status();
      const el = $('diag-pipeline');
      if (el) {
        const base =
          st?.state || st?.status || (st?.active ? 'Active' : 'Idle');
        const who = st?.activeSpeaker ? ' · ' + st.activeSpeaker : '';
        el.textContent = base + who;
      }
      if ($('diag-listen-channel') && st?.activeChannel) {
        // Prefer live receiving channel when active
        if (st.status === 'receiving') {
          $('diag-listen-channel').textContent = st.activeChannel;
        }
      }
    } catch {
      /* ignore */
    }
  }

  function shortUrl(url) {
    try {
      const u = new URL(String(url || ''));
      return u.host || String(url || '').slice(0, 24);
    } catch {
      return String(url || '').slice(0, 24) || '—';
    }
  }

  async function probeBrain({ force = false } = {}) {
    const el = $('brain-status');
    try {
      const snap = await window.zelloBot.llm.snapshot({ force: !!force });
      const ok = snap?.ok !== false && !snap?.error;
      const model =
        snap?.model || window.V2.state.settings?.ai?.model || '';
      const host = shortUrl(
        snap?.resolvedUrl || snap?.url || window.V2.state.settings?.ai?.ollamaUrl
      );
      if (el) el.textContent = ok ? model || host || 'OK' : 'Down';
      window.V2.setDot('dot-brain', ok ? 'on' : 'warn');
      return ok;
    } catch (e) {
      if (el) el.textContent = 'Down';
      window.V2.setDot('dot-brain', 'warn');
      return false;
    }
  }

  async function probeStt() {
    const el = $('stt-status');
    try {
      const r = await window.zelloBot.voiceBot.sttHealth();
      const ok = window.V2.isServiceOk(r);
      if (el) el.textContent = ok ? 'Listening' : 'Down';
      window.V2.setDot('dot-stt', ok ? 'on' : 'warn');
      return ok;
    } catch {
      if (el) el.textContent = 'Down';
      window.V2.setDot('dot-stt', 'warn');
      return false;
    }
  }

  async function probeTts({ loadVoices = false } = {}) {
    const el = $('tts-status');
    try {
      const r = await window.zelloBot.voiceBot.omnivoiceHealth();
      const ok = window.V2.isServiceOk(r);
      if (el) el.textContent = ok ? 'Ready' : 'Down';
      window.V2.setDot('dot-tts', ok ? 'on' : 'warn');

      if (loadVoices) {
        try {
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
        } catch {
          /* voices optional */
        }
      }
      return ok;
    } catch {
      if (el) el.textContent = 'Down';
      window.V2.setDot('dot-tts', 'warn');
      return false;
    }
  }

  async function refreshHealth({ quiet } = {}) {
    const btn = $('btn-refresh-health');
    // Only flash "Checking…" on manual Refresh — background probes stay quiet
    if (!quiet && btn) {
      btn.classList.add('is-busy');
      btn.textContent = 'Checking…';
    }

    if (quiet) {
      // Light background check: STT/TTS only — leave Brain label alone
      await Promise.all([probeStt(), probeTts({ loadVoices: false })]);
    } else {
      await Promise.all([
        refreshZello(),
        refreshAudio(),
        probeBrain({ force: true }),
        probeStt(),
        probeTts({ loadVoices: true })
      ]);
    }

    const sttEl = $('stt-status');
    if (sttEl && sttEl.textContent === 'Down') {
      window.V2.live?.applyVoiceStatus?.({
        lastError:
          'STT (Hear) is down — start 2-start-stt.bat or START-ALL.bat. Without it, channel talk will not appear in Heard.',
        status: 'error'
      });
    }

    if (!quiet && btn) {
      btn.classList.remove('is-busy');
      btn.textContent = 'Refresh';
    }
  }

  async function loadSettings() {
    const settings = await window.zelloBot.settings.get();
    window.V2.state.settings = settings;
    window.V2.live.fillSpeakAs(settings);
    window.V2.roster.render(settings);
    window.V2.channels.render(settings);
    window.V2.engines.fill(settings);
    const botN = (settings?.bots || []).length;
    if ($('runtime-label')) {
      $('runtime-label').textContent =
        botN > 0 ? botN + ' bots' : 'No bots';
    }
    if ($('brain-status')) {
      $('brain-status').textContent = settings?.ai?.model || '—';
    }
  }

  async function connectBots() {
    $('runtime-label').textContent = 'Connecting…';
    window.V2.setDot('dot-runtime', 'warn');
    if (window.V2.state.settings) {
      const withRoster = window.V2.roster.readRosterIntoSettings(
        window.V2.state.settings
      );
      window.V2.state.settings = await window.zelloBot.settings.save(withRoster);
    }
    try {
      const result = await window.zelloBot.zelloRuntime.connect();
      applyZelloStatus(result || { connected: true });
      const n = (window.V2.state.settings?.bots || []).length;
      $('runtime-label').textContent = n ? n + ' bots' : 'Online';
      window.V2.setDot('dot-runtime', 'on');
    } catch (e) {
      $('runtime-label').textContent = 'Connect failed';
      window.V2.setDot('dot-runtime', 'warn');
      window.V2.live.applyVoiceStatus({
        lastError: e?.message || String(e),
        status: 'error'
      });
    }
    await refreshZello();
  }

  async function disconnectBots() {
    try {
      await window.zelloBot.zelloRuntime.disconnect();
    } catch {
      /* ignore */
    }
    applyZelloStatus({ connected: false, status: 'Disconnected' });
    const n = (window.V2.state.settings?.bots || []).length;
    $('runtime-label').textContent = n ? n + ' bots' : 'Idle';
    window.V2.setDot('dot-runtime', 'off');
  }

  function bindNav() {
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => showView(btn.dataset.view));
    });
  }

  async function boot() {
    const api = window.zelloBot;
    if (!api) {
      $('runtime-label').textContent = 'No preload';
      return;
    }

    $('app-name').textContent = api.appName || 'Bot Desktop V2';
    window.V2.setDot('dot-runtime', 'on');

    window.V2.live.bind();
    window.V2.roster.bind();
    window.V2.channels.bind();
    window.V2.engines.bind();
    bindNav();

    $('btn-connect')?.addEventListener('click', () => connectBots());
    $('btn-disconnect')?.addEventListener('click', () => disconnectBots());
    $('btn-refresh-health')?.addEventListener('click', () =>
      refreshHealth({ quiet: false })
    );

    await loadSettings();

    if (api.voiceBot?.onStatusChanged) {
      api.voiceBot.onStatusChanged((status) => {
        window.V2.live.applyVoiceStatus(status);
      });
    }

    try {
      const vb = await api.voiceBot.status();
      window.V2.live.applyVoiceStatus(vb);
    } catch {
      /* ignore */
    }

    await refreshHealth({ quiet: false });
    // Keep model label stable after first probe
    if ($('brain-status') && (!$('brain-status').textContent || $('brain-status').textContent === '…')) {
      $('brain-status').textContent =
        window.V2.state.settings?.ai?.model || '—';
    }

    // Zello/audio status only
    setInterval(() => {
      refreshZello();
      refreshAudio();
    }, 5000);

    // Light STT/TTS check — does not flash Brain
    setInterval(() => {
      refreshHealth({ quiet: true });
    }, 60000);

    setInterval(async () => {
      try {
        const vb = await api.voiceBot.status();
        window.V2.live.applyVoiceStatus(vb);
      } catch {
        /* ignore */
      }
    }, 8000);
  }

  document.addEventListener('DOMContentLoaded', () => {
    boot().catch((e) => {
      console.error(e);
      $('runtime-label').textContent = 'Boot failed';
    });
  });
})();
