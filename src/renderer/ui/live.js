window.V2 = window.V2 || {};

(function () {
  const $ = window.V2.$;
  let activityCount = 0;

  function formatTime(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  }

  function appendActivity(entry, { scroll = true } = {}) {
    const log = $('activity-log');
    if (!log || !entry) return;
    if (entry.id && entry.id <= window.V2.state.lastActivityId) return;

    const row = document.createElement('div');
    row.className = 'activity-row' + (entry.level === 'error' ? ' error' : entry.level === 'warn' ? ' warn' : '');
    row.innerHTML =
      '<span class="time">' + formatTime(entry.at) + '</span>' +
      '<span class="src">' + (entry.source || 'System') + '</span>' +
      '<span class="msg"></span>';
    row.querySelector('.msg').textContent = entry.message || '';
    log.appendChild(row);
    activityCount += 1;

    while (log.children.length > 150) {
      log.removeChild(log.firstChild);
    }

    if (entry.id) window.V2.state.lastActivityId = entry.id;
    const countEl = $('activity-count');
    if (countEl) countEl.textContent = String(activityCount);
    if (scroll) log.scrollTop = log.scrollHeight;
  }

  function resetActivity(entries) {
    const log = $('activity-log');
    if (!log) return;
    log.innerHTML = '';
    activityCount = 0;
    window.V2.state.lastActivityId = 0;
    const list = Array.isArray(entries) ? entries : [];
    for (const e of list) appendActivity(e, { scroll: false });
    log.scrollTop = log.scrollHeight;
  }

  function statusLabel(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'transcribing') return 'Transcribing';
    if (s === 'listening' || s === 'idle') return 'Listening';
    if (s === 'thinking' || s === 'processing') return 'Thinking';
    if (s === 'speaking') return 'Speaking';
    if (s === 'error') return 'Error';
    return status || 'Idle';
  }

  function updateModeBadge(settings) {
    const el = $('live-mode');
    if (!el) return;
    if (settings?.zello?.anonymousListen === true) {
      el.textContent = 'Anonymous listen';
      return;
    }
    const grabOnly =
      settings?.multiBot?.grabMode === true && settings?.multiBot?.grabOnly === true;
    const listenOnly = settings?.ai?.autoReply === false;
    el.textContent = grabOnly ? 'Grab only' : listenOnly ? 'Listen only' : 'Auto reply';
  }

  function renderAnonymousListen(settings) {
    const btn = $('btn-anonymous-listen');
    if (!btn) return;
    const on = settings?.zello?.anonymousListen === true;
    btn.textContent = on ? 'Auth: Anonymous listen' : 'Auth: Normal';
    btn.classList.toggle('danger', on);
  }

  async function toggleAnonymousListen() {
    if (!window.zelloBot?.settings) return;
    try {
      const current = await window.zelloBot.settings.get();
      const nextOn = current?.zello?.anonymousListen !== true;
      const next = {
        ...current,
        zello: {
          ...(current?.zello || {}),
          anonymousListen: nextOn
        }
      };
      // Anonymous cannot talk — turn off transmit helpers that would fail
      if (nextOn) {
        next.multiBot = {
          ...(next.multiBot || {}),
          grabMode: false,
          grabOnly: false
        };
        try {
          if (window.V2.state.constantRequests?.on) {
            await window.zelloBot.zelloRuntime?.setConstantRequests?.({
              enabled: false
            });
          }
        } catch {
          /* ignore */
        }
      }
      const saved = await window.zelloBot.settings.save(next);
      window.V2.state.settings = saved;
      renderAnonymousListen(saved);
      renderGrabMode(saved);
      updateModeBadge(saved);

      // Auth shape changes on logon — reconnect if already joined
      if (window.V2.state.zelloConnected && window.zelloBot?.zelloRuntime) {
        try {
          await window.zelloBot.zelloRuntime.disconnect();
        } catch {
          /* ignore */
        }
        await window.zelloBot.zelloRuntime.connect();
        await window.V2._refreshZello?.();
      }
    } catch (e) {
      const err = $('live-error');
      if (err) {
        err.textContent = e?.message || String(e);
        err.classList.remove('is-hidden');
      }
    }
  }

  function applyVoiceStatus(status) {
    if (!status || typeof status !== 'object') return;

    if (status.activityAppend) {
      appendActivity(status.activityAppend);
    } else if (Array.isArray(status.activityLog)) {
      const newest = status.activityLog[status.activityLog.length - 1];
      if (!newest || newest.id !== window.V2.state.lastActivityId) {
        if (!window.V2.state.lastActivityId) {
          resetActivity(status.activityLog);
        } else {
          for (const e of status.activityLog) {
            if (e.id > window.V2.state.lastActivityId) appendActivity(e);
          }
        }
      }
    }

    const speaker = $('live-speaker');
    const transcript = $('live-transcript');
    const response = $('live-response');
    const state = $('live-bot-state');
    const err = $('live-error');
    const processing = $('diag-processing');

    if (speaker) speaker.textContent = status.speaker || 'No speaker';
    if (transcript) transcript.textContent = status.transcript || 'Waiting for speech…';
    if (response) {
      const anon = window.V2.state.settings?.zello?.anonymousListen === true;
      const listenOnly = window.V2.state.settings?.ai?.autoReply === false;
      response.textContent =
        status.responseText ||
        (anon
          ? '(anonymous listen — JWT only, cannot talk)'
          : listenOnly
            ? '(listen only — not replying)'
            : 'No response yet');
    }
    if (state) state.textContent = statusLabel(status.status);
    if (processing) processing.textContent = status.processing ? 'Yes' : 'No';

    const error = typeof status.lastError === 'string' ? status.lastError.trim() : '';
    if (err) {
      err.textContent = error;
      err.classList.toggle('is-hidden', !error);
    }
  }

  function grabState(settings) {
    if (settings?.multiBot?.grabMode !== true) return 'off';
    return settings?.multiBot?.grabOnly === true ? 'only' : 'reply';
  }

  function renderGrabMode(settings) {
    const btn = $('btn-grab-mode');
    if (!btn) return;
    const state = grabState(settings);
    btn.textContent =
      state === 'only' ? 'Grab: ONLY (no voice)' : state === 'reply' ? 'Grab: + reply' : 'Grab: OFF';
    btn.classList.toggle('danger', state !== 'off');
  }

  async function toggleGrabMode() {
    if (!window.zelloBot?.settings) return;
    try {
      const current = await window.zelloBot.settings.get();
      if (current?.zello?.anonymousListen === true) {
        throw new Error(
          'Anonymous listen cannot grab the button. Turn Auth back to Normal and reconnect.'
        );
      }
      const state = grabState(current);
      const nextState = state === 'off' ? 'reply' : state === 'reply' ? 'only' : 'off';
      const next = {
        ...current,
        multiBot: {
          ...(current?.multiBot || {}),
          grabMode: nextState !== 'off',
          grabOnly: nextState === 'only'
        }
      };
      const saved = await window.zelloBot.settings.save(next);
      window.V2.state.settings = {
        ...(window.V2.state.settings || saved),
        multiBot: saved.multiBot
      };
      renderGrabMode(saved);
      updateModeBadge(saved);
    } catch (e) {
      const err = $('live-error');
      if (err) {
        err.textContent = e?.message || String(e);
        err.classList.remove('is-hidden');
      }
    }
  }

  function botLabel(settings, botId) {
    const bot = (settings?.bots || []).find((b) => String(b?.id) === String(botId));
    return bot ? bot.identityName || bot.username : String(botId || '');
  }

  function fillConstantBots(settings) {
    const sel = $('constant-bot');
    if (!sel) return;
    const saved = String(settings?.multiBot?.constantBotId || '');
    const prev = sel.value || saved;
    sel.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Pick a bot…';
    sel.appendChild(none);
    for (const bot of settings?.bots || []) {
      if (!bot?.username || bot.id === undefined || bot.id === null) continue;
      const opt = document.createElement('option');
      opt.value = String(bot.id);
      opt.textContent = bot.identityName || bot.username;
      sel.appendChild(opt);
    }
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }

  /** Paint the Constant requests button + status from zello:status (status.constantRequests). */
  function applyConstantStatus(status) {
    const btn = $('btn-constant-requests');
    const label = $('constant-status');
    const cr = status?.constantRequests;
    if (!btn || !cr) return;
    window.V2.state.constantRequests = cr;
    btn.textContent = cr.on ? 'Constant requests: ON' : 'Constant requests: OFF';
    btn.classList.toggle('danger', cr.on === true);
    if (!label) return;

    const settings = window.V2.state.settings;
    const botId = cr.on ? cr.botId : $('constant-bot')?.value || cr.botId;
    const name = cr.botName || botLabel(settings, botId);
    const rt = (status?.bots || []).find((b) => String(b.id) === String(botId));
    const botOnline = rt?.status === 'connected';
    let text = 'Off';
    let warn = false;
    if (cr.on) {
      if (cr.state === 'dj') text = 'Waiting — DJ mode holds the channel (resumes after DJ off)';
      else if (cr.state === 'holding') text = 'Holding the channel as ' + name;
      else if (cr.state === 'paused') text = 'Paused — ' + name + ' is transmitting';
      else if (cr.state === 'offline') {
        text = name + ' is offline — waiting (no other bot used)';
        warn = true;
      } else text = 'Requesting the button as ' + name + '…';
    } else if (botId && !botOnline) {
      text = 'Off · ' + name + ' is offline';
      warn = true;
    }
    label.textContent = text;
    label.classList.toggle('is-warn', warn);
  }

  async function toggleConstantRequests() {
    const api = window.zelloBot?.zelloRuntime;
    if (!api?.setConstantRequests) return;
    const on = window.V2.state.constantRequests?.on === true;
    const botId = $('constant-bot')?.value || '';
    try {
      if (!on && !botId) throw new Error('Pick a bot for Constant requests first.');
      await api.setConstantRequests({ enabled: !on, botId });
    } catch (e) {
      const err = $('live-error');
      if (err) {
        err.textContent = e?.message || String(e);
        err.classList.remove('is-hidden');
      }
    }
    await window.V2._refreshZello?.();
  }

  async function onConstantBotChange() {
    const botId = $('constant-bot')?.value || '';
    try {
      const current = await window.zelloBot.settings.get();
      const saved = await window.zelloBot.settings.save({
        ...current,
        multiBot: { ...(current?.multiBot || {}), constantBotId: botId }
      });
      window.V2.state.settings = {
        ...(window.V2.state.settings || saved),
        multiBot: saved.multiBot
      };
      // Already ON → switch the hold to the newly chosen bot
      if (window.V2.state.constantRequests?.on && botId) {
        await window.zelloBot.zelloRuntime.setConstantRequests({ enabled: true, botId });
      }
    } catch (e) {
      const err = $('live-error');
      if (err) {
        err.textContent = e?.message || String(e);
        err.classList.remove('is-hidden');
      }
    }
    await window.V2._refreshZello?.();
  }

  function fillSpeakAs(settings) {
    updateModeBadge(settings);
    renderAnonymousListen(settings);
    renderGrabMode(settings);
    fillConstantBots(settings);
    const sel = $('speak-as-bot');
    if (!sel) return;
    const bots = settings?.bots || [];
    const prev = sel.value;
    sel.innerHTML = '';
    for (const bot of bots) {
      if (!bot?.username) continue;
      const opt = document.createElement('option');
      opt.value = bot.id || bot.username;
      opt.textContent = bot.identityName || bot.username;
      sel.appendChild(opt);
    }
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }

  async function speakText() {
    const api = window.zelloBot?.voiceBot;
    if (!api?.speakText) return;
    if (window.V2.state.settings?.zello?.anonymousListen === true) {
      const err = $('live-error');
      if (err) {
        err.textContent =
          'Anonymous listen cannot talk. Turn Auth back to Normal and reconnect.';
        err.classList.remove('is-hidden');
      }
      return;
    }
    const botId = $('speak-as-bot')?.value || '';
    const text = ($('speak-text')?.value || '').trim();
    if (!text) return;
    try {
      await api.speakText({ botId, text });
      $('speak-text').value = '';
    } catch (e) {
      const err = $('live-error');
      if (err) {
        err.textContent = e?.message || String(e);
        err.classList.remove('is-hidden');
      }
    }
  }

  function bind() {
    $('btn-speak-text')?.addEventListener('click', () => speakText());
    $('btn-anonymous-listen')?.addEventListener('click', () => toggleAnonymousListen());
    $('btn-grab-mode')?.addEventListener('click', () => toggleGrabMode());
    $('btn-constant-requests')?.addEventListener('click', () => toggleConstantRequests());
    $('constant-bot')?.addEventListener('change', () => onConstantBotChange());
    // Faster status refresh while Constant requests is ON (app polls every 5 s otherwise)
    setInterval(() => {
      if (window.V2.state.constantRequests?.on) window.V2._refreshZello?.();
    }, 1000);
    $('speak-text')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        speakText();
      }
    });
  }

  window.V2.live = {
    bind,
    applyVoiceStatus,
    fillSpeakAs,
    applyConstantStatus,
    updateModeBadge,
    resetActivity,
    appendActivity
  };
})();
