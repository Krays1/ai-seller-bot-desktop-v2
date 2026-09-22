window.V2 = window.V2 || {};

(function () {
  const $ = window.V2.$;
  let voiceTargetBtn = null;

  function openVoiceDrawer(botId, currentVoice, buttonEl) {
    window.V2.state.voicePickBotId = botId;
    voiceTargetBtn = buttonEl;
    const drawer = $('voice-drawer');
    drawer?.classList.remove('is-hidden');
    drawer?.setAttribute('aria-hidden', 'false');
    $('voice-drawer-filter').value = '';
    renderVoiceList(currentVoice || '');
    $('voice-drawer-filter')?.focus();
  }

  function closeVoiceDrawer() {
    const drawer = $('voice-drawer');
    drawer?.classList.add('is-hidden');
    drawer?.setAttribute('aria-hidden', 'true');
    window.V2.state.voicePickBotId = null;
    voiceTargetBtn = null;
  }

  function renderVoiceList(selected) {
    const list = $('voice-drawer-list');
    if (!list) return;
    const filter = ($('voice-drawer-filter')?.value || '').trim().toLowerCase();
    list.innerHTML = '';
    const voices = window.V2.state.voices || [];
    const filtered = voices.filter((v) => {
      const name = String(v?.name || v || '');
      return !filter || name.toLowerCase().includes(filter);
    });
    if (!filtered.length) {
      list.innerHTML = '<p class="hint">No voices found. Probe OmniVoice on Engines.</p>';
      return;
    }
    for (const v of filtered) {
      const name = String(v?.name || v || '');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'voice-item';
      btn.textContent = name + (name === selected ? ' ✓' : '');
      btn.addEventListener('click', () => {
        const id = window.V2.state.voicePickBotId;
        if (id && voiceTargetBtn) {
          voiceTargetBtn.dataset.voice = name;
          voiceTargetBtn.textContent = name || '(default)';
        }
        const bot = (window.V2.state.settings?.bots || []).find((b) => b.id === id);
        if (bot) bot.omnivoiceVoice = name;
        closeVoiceDrawer();
      });
      list.appendChild(btn);
    }
  }

  function primaryLabel(settings) {
    const p = String(settings?.zello?.channelName || '').trim();
    return p ? 'Primary · ' + p : 'Primary channel';
  }

  function fillChannelSelect(select, settings, selected) {
    const channels = window.V2.channelOptions(settings);
    select.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = primaryLabel(settings);
    select.appendChild(blank);
    for (const c of channels) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      select.appendChild(opt);
    }
    const cur = String(selected || '').trim();
    if (cur && ![...select.options].some((o) => o.value === cur)) {
      const orphan = document.createElement('option');
      orphan.value = cur;
      orphan.textContent = cur + ' (not in list)';
      select.appendChild(orphan);
    }
    select.value = cur;
  }

  function botStatusLabel(bot, zelloStatus) {
    const bots = zelloStatus?.bots || zelloStatus?.roster || [];
    const hit = bots.find?.(
      (b) =>
        String(b.id) === String(bot.id) ||
        b.username === bot.username ||
        b.botUsername === bot.username
    );
    const st = String(hit?.status || '').toLowerCase();
    if (st === 'connected' || hit?.connected || hit?.online) {
      return { text: 'Online', on: true };
    }
    if (st === 'connecting') return { text: '…', on: false };
    if (bot.enabled !== false) return { text: 'Ready', on: false };
    return { text: 'Off', on: false };
  }

  function updateStatuses(zelloStatus) {
    for (const row of document.querySelectorAll('#roster-body tr[data-bot-id]')) {
      const botId = row.dataset.botId;
      const bots = zelloStatus?.bots || [];
      const hit = bots.find?.(
        (b) =>
          String(b.id) === String(botId) ||
          b.username === row.querySelector('.meta')?.textContent
      );
      const badge = row.querySelector('.badge');
      if (!badge) continue;
      const st = String(hit?.status || '').toLowerCase();
      if (st === 'connected') {
        badge.textContent = 'Online';
        badge.classList.add('on');
      } else if (st === 'connecting') {
        badge.textContent = '…';
        badge.classList.remove('on');
      } else {
        const join = row.querySelector('.r-join')?.checked;
        badge.textContent = join ? 'Ready' : 'Off';
        badge.classList.remove('on');
      }
    }
  }

  function render(settings, zelloStatus) {
    const body = $('roster-body');
    if (!body) return;
    const bots = settings?.bots || [];
    body.innerHTML = '';

    // Bulk channel picker options
    const bulk = $('roster-bulk-channel');
    if (bulk) fillChannelSelect(bulk, settings, bulk.value || '');

    if (!bots.length) {
      body.innerHTML =
        '<tr><td colspan="7" class="hint">No bots in settings. Import or enable bots first.</td></tr>';
      return;
    }

    for (const bot of bots) {
      const tr = document.createElement('tr');
      tr.dataset.botId = bot.id;

      const join = document.createElement('input');
      join.type = 'checkbox';
      join.className = 'r-join';
      join.checked = bot.enabled !== false;

      const speak = document.createElement('input');
      speak.type = 'checkbox';
      speak.className = 'r-speak';
      speak.checked = bot.canSpeak !== false;

      const nameCall = document.createElement('input');
      nameCall.type = 'checkbox';
      nameCall.className = 'r-name';
      nameCall.checked = bot.calledByName === true;

      const nameCell = document.createElement('td');
      nameCell.innerHTML = '<strong></strong><div class="meta"></div>';
      nameCell.querySelector('strong').textContent =
        bot.identityName || bot.username;
      nameCell.querySelector('.meta').textContent = bot.username;

      const channel = document.createElement('select');
      channel.className = 'r-channel';
      channel.title = 'Channel this bot joins. Blank = primary channel.';
      fillChannelSelect(channel, settings, bot.channelName || '');

      const voiceBtn = document.createElement('button');
      voiceBtn.type = 'button';
      voiceBtn.className = 'btn voice-pick-btn';
      voiceBtn.dataset.voice = bot.omnivoiceVoice || '';
      voiceBtn.textContent = bot.omnivoiceVoice || '(default)';
      voiceBtn.addEventListener('click', () =>
        openVoiceDrawer(bot.id, voiceBtn.dataset.voice, voiceBtn)
      );

      const st = botStatusLabel(bot, zelloStatus);
      const status = document.createElement('span');
      status.className = 'badge' + (st.on ? ' on' : '');
      status.textContent = st.text;

      const td = (node) => {
        const cell = document.createElement('td');
        cell.appendChild(node);
        return cell;
      };

      tr.appendChild(td(join));
      tr.appendChild(td(speak));
      tr.appendChild(td(nameCall));
      tr.appendChild(nameCell);
      tr.appendChild(td(channel));
      tr.appendChild(td(voiceBtn));
      tr.appendChild(td(status));
      body.appendChild(tr);
    }
  }

  function readRosterIntoSettings(settings) {
    const next = window.V2.cloneSettings(settings);
    const byId = new Map((next.bots || []).map((b) => [b.id, b]));
    for (const row of document.querySelectorAll('#roster-body tr[data-bot-id]')) {
      const bot = byId.get(row.dataset.botId);
      if (!bot) continue;
      bot.enabled = row.querySelector('.r-join')?.checked === true;
      bot.canSpeak = row.querySelector('.r-speak')?.checked === true;
      bot.calledByName = row.querySelector('.r-name')?.checked === true;
      bot.channelName = row.querySelector('.r-channel')?.value || '';
      bot.omnivoiceVoice =
        row.querySelector('.voice-pick-btn')?.dataset.voice || '';
    }
    return next;
  }

  function setAll(field, value) {
    const sel =
      field === 'join'
        ? '.r-join'
        : field === 'speak'
          ? '.r-speak'
          : '.r-name';
    document.querySelectorAll('#roster-body ' + sel).forEach((el) => {
      el.checked = value;
    });
  }

  function applyBulkChannel(onlyJoined) {
    const ch = $('roster-bulk-channel')?.value || '';
    document.querySelectorAll('#roster-body tr[data-bot-id]').forEach((row) => {
      if (onlyJoined && !row.querySelector('.r-join')?.checked) return;
      const sel = row.querySelector('.r-channel');
      if (sel) sel.value = ch;
    });
    window.V2.showToastHint(
      $('roster-hint'),
      ch
        ? 'Set channel to "' + ch + '"' + (onlyJoined ? ' (joined only)' : '')
        : 'Set channel to primary' + (onlyJoined ? ' (joined only)' : '')
    );
  }

  async function saveRoster() {
    if (!window.zelloBot?.settings || !window.V2.state.settings) return;
    const next = readRosterIntoSettings(window.V2.state.settings);
    const saved = await window.zelloBot.settings.save(next);
    window.V2.state.settings = saved;
    window.V2.live?.fillSpeakAs?.(saved);
    window.V2.channels?.render?.(saved);
    window.V2.showToastHint($('roster-hint'), 'Roster saved — Disconnect then Connect to apply channels');
    render(saved);
  }

  function bind() {
    $('roster-save')?.addEventListener('click', () => saveRoster());
    $('roster-enable-all')?.addEventListener('click', () => setAll('join', true));
    $('roster-disable-all')?.addEventListener('click', () => setAll('join', false));
    $('roster-speak-all')?.addEventListener('click', () => setAll('speak', true));
    $('roster-mute-all')?.addEventListener('click', () => setAll('speak', false));
    $('roster-assign-channel-all')?.addEventListener('click', () =>
      applyBulkChannel(false)
    );
    $('roster-assign-channel-joined')?.addEventListener('click', () =>
      applyBulkChannel(true)
    );
    $('voice-drawer-close')?.addEventListener('click', closeVoiceDrawer);
    $('voice-drawer-backdrop')?.addEventListener('click', closeVoiceDrawer);
    $('voice-drawer-filter')?.addEventListener('input', () => {
      const btn = voiceTargetBtn;
      renderVoiceList(btn?.dataset.voice || '');
    });
  }

  window.V2.roster = {
    bind,
    render,
    updateStatuses,
    saveRoster,
    readRosterIntoSettings,
    closeVoiceDrawer,
    applyBulkChannel
  };
})();
