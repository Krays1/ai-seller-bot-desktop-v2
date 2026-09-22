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
    const listenOnly = settings?.ai?.autoReply === false;
    el.textContent = listenOnly ? 'Listen only' : 'Auto reply';
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
      const listenOnly = window.V2.state.settings?.ai?.autoReply === false;
      response.textContent =
        status.responseText ||
        (listenOnly ? '(listen only — not replying)' : 'No response yet');
    }
    if (state) state.textContent = statusLabel(status.status);
    if (processing) processing.textContent = status.processing ? 'Yes' : 'No';

    const error = typeof status.lastError === 'string' ? status.lastError.trim() : '';
    if (err) {
      err.textContent = error;
      err.classList.toggle('is-hidden', !error);
    }
  }

  function fillSpeakAs(settings) {
    updateModeBadge(settings);
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
    updateModeBadge,
    resetActivity,
    appendActivity
  };
})();
