window.V2 = window.V2 || {};

(function () {
  const $ = window.V2.$;

  function activeChannels(settings) {
    const z = settings?.zello || {};
    const names = [];
    const push = (raw) => {
      const n = String(raw || '').trim();
      if (n && !names.includes(n)) names.push(n);
    };
    push(z.channelName);
    for (const c of z.channelNames || []) push(c);
    // Also show channels bots are already assigned to
    for (const b of settings?.bots || []) push(b?.channelName);
    return names;
  }

  function ensureInCatalog(settings, channelName) {
    const n = String(channelName || '').trim();
    if (!n) return settings;
    const next = window.V2.cloneSettings(settings);
    next.catalog = next.catalog || {};
    const list = Array.isArray(next.catalog.channels)
      ? next.catalog.channels.slice()
      : [];
    const exists = list.some((c) => {
      const name = String(c?.name || c?.key || c || '').trim();
      return name.toLowerCase() === n.toLowerCase();
    });
    if (!exists) {
      list.unshift({ key: n, name: n, source: 'user' });
    }
    next.catalog.channels = list;
    return next;
  }

  function botsOnChannel(settings, channelName) {
    const primary = String(settings?.zello?.channelName || '').trim();
    const target = String(channelName || '').trim();
    const bots = settings?.bots || [];
    return bots.filter((b) => {
      const own = String(b.channelName || '').trim();
      const resolved = own || primary;
      return resolved === target;
    });
  }

  function mergeRosterEdits(settings) {
    if (
      !window.V2.roster?.readRosterIntoSettings ||
      !document.querySelector('#roster-body tr[data-bot-id]')
    ) {
      return window.V2.cloneSettings(settings);
    }
    const next = window.V2.roster.readRosterIntoSettings(settings);
    // Never let roster DOM wipe the active channel list
    next.zello = window.V2.cloneSettings(settings.zello || {});
    next.catalog = window.V2.cloneSettings(settings.catalog || {});
    return next;
  }

  async function persist(settings, hint) {
    if (!window.zelloBot?.settings) return settings;
    const saved = await window.zelloBot.settings.save(settings);
    window.V2.state.settings = saved;
    render(saved);
    window.V2.roster?.render?.(saved);
    window.V2.live?.fillSpeakAs?.(saved);
    if (hint) {
      window.V2.showToastHint($('channels-hint'), hint);
    }
    return saved;
  }

  function assignBotsInSettings(settings, channelName, onlyJoined) {
    const next = window.V2.cloneSettings(settings);
    const ch = String(channelName || '').trim();
    for (const b of next.bots || []) {
      if (onlyJoined && b.enabled === false) continue;
      b.channelName = ch;
    }
    return next;
  }

  function render(settings) {
    const list = $('channel-list');
    const catalog = $('catalog-channel-list');
    const assignSel = $('channel-assign-select');
    if (!list) return;

    const channels = activeChannels(settings);
    const primary = String(settings?.zello?.channelName || '').trim();

    list.innerHTML = '';
    if (!channels.length) {
      list.innerHTML = '<p class="hint">No channels yet — type a name and click Add.</p>';
    } else {
      for (const name of channels) {
        const assigned = botsOnChannel(settings, name);
        const joined = assigned.filter((b) => b.enabled !== false);
        const row = document.createElement('div');
        row.className = 'channel-row';

        const left = document.createElement('div');
        left.className = 'channel-row-main';
        const label = document.createElement('strong');
        label.textContent = name + (name === primary ? ' · primary' : '');
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent =
          assigned.length +
          ' bot' +
          (assigned.length === 1 ? '' : 's') +
          ' · ' +
          joined.length +
          ' joined';
        left.appendChild(label);
        left.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'channel-row-actions';

        const useHere = document.createElement('button');
        useHere.type = 'button';
        useHere.className = 'btn primary';
        useHere.textContent = 'Use for joined';
        useHere.title = 'Put all joined bots on this channel and save';
        useHere.addEventListener('click', () => {
          putJoinedOnChannel(name).catch((e) => {
            window.V2.showToastHint(
              $('channels-hint'),
              e?.message || String(e)
            );
          });
        });

        const makePrimary = document.createElement('button');
        makePrimary.type = 'button';
        makePrimary.className = 'btn';
        makePrimary.textContent = 'Primary';
        makePrimary.disabled = name === primary;
        makePrimary.addEventListener('click', () => {
          setPrimary(name).catch((e) => {
            window.V2.showToastHint(
              $('channels-hint'),
              e?.message || String(e)
            );
          });
        });

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn';
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => {
          removeChannel(name).catch((e) => {
            window.V2.showToastHint(
              $('channels-hint'),
              e?.message || String(e)
            );
          });
        });

        actions.appendChild(useHere);
        actions.appendChild(makePrimary);
        actions.appendChild(remove);
        row.appendChild(left);
        row.appendChild(actions);
        list.appendChild(row);
      }
    }

    if (assignSel) {
      const prev = assignSel.value;
      assignSel.innerHTML = '';
      for (const c of channels) {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c + (c === primary ? ' (primary)' : '');
        assignSel.appendChild(opt);
      }
      if (!channels.length) {
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = '(add a channel first)';
        assignSel.appendChild(blank);
      }
      if ([...assignSel.options].some((o) => o.value === prev)) {
        assignSel.value = prev;
      }
    }

    if (catalog) {
      catalog.innerHTML = '';
      const cats = settings?.catalog?.channels || [];
      const activeSet = new Set(channels.map((c) => c.toLowerCase()));
      if (!cats.length) {
        catalog.innerHTML =
          '<p class="hint">No channels yet. Add one above — it will show here too.</p>';
      } else {
        // User-added first, then imported
        const sorted = [...cats].sort((a, b) => {
          const as = String(a?.source || '') === 'user' ? 0 : 1;
          const bs = String(b?.source || '') === 'user' ? 0 : 1;
          if (as !== bs) return as - bs;
          const an = String(a?.name || a || '');
          const bn = String(b?.name || b || '');
          return an.localeCompare(bn);
        });
        for (const c of sorted.slice(0, 150)) {
          const name = String(c?.name || c || '').trim();
          if (!name) continue;
          const isActive = activeSet.has(name.toLowerCase());
          const isUser = String(c?.source || '') === 'user';
          const row = document.createElement('div');
          row.className = 'channel-row' + (isActive ? ' is-active-channel' : '');
          const span = document.createElement('span');
          span.textContent =
            name + (isUser ? ' · yours' : '') + (isActive ? ' · in use' : '');
          const add = document.createElement('button');
          add.type = 'button';
          add.className = 'btn' + (isActive ? '' : ' primary');
          add.textContent = isActive ? 'In Active' : 'Use this';
          add.disabled = isActive;
          add.addEventListener('click', () => {
            addChannel(name).catch((e) => {
              window.V2.showToastHint(
                $('channels-hint'),
                e?.message || String(e)
              );
            });
          });
          row.appendChild(span);
          row.appendChild(add);
          catalog.appendChild(row);
        }
      }
    }
  }

  async function addChannel(rawName) {
    const n = String(rawName || '').trim();
    if (!n) {
      window.V2.showToastHint($('channels-hint'), 'Type a channel name first');
      return;
    }
    if (!window.V2.state.settings) return;

    let next = mergeRosterEdits(window.V2.state.settings);
    next.zello = next.zello || {};
    const all = activeChannels(next);
    if (!all.includes(n)) all.push(n);
    next.zello.channelNames = all;
    if (!next.zello.channelName) next.zello.channelName = n;

    const makePrimary = $('channel-add-primary')?.checked === true;
    if (makePrimary) next.zello.channelName = n;

    const putJoined = $('channel-add-assign')?.checked !== false;
    if (putJoined) {
      next = assignBotsInSettings(next, n, true);
    }

    // Also list under Catalog so it stays visible there
    next = ensureInCatalog(next, n);

    await persist(
      next,
      putJoined
        ? 'Added "' +
            n +
            '" (Active + Catalog). Joined bots assigned. Reconnect now.'
        : 'Added "' +
            n +
            '" to Active + Catalog. Click Use for joined, then Reconnect.'
    );

    if ($('channel-add-input')) $('channel-add-input').value = '';
    if ($('channel-assign-select')) $('channel-assign-select').value = n;
  }

  async function setPrimary(name) {
    let next = mergeRosterEdits(window.V2.state.settings);
    next.zello = next.zello || {};
    const all = activeChannels(next);
    if (!all.includes(name)) all.push(name);
    next.zello.channelNames = all;
    next.zello.channelName = name;
    await persist(
      next,
      'Primary is now "' +
        name +
        '". Bots with blank Channel use this. Reconnect to apply.'
    );
  }

  async function putJoinedOnChannel(name) {
    let next = mergeRosterEdits(window.V2.state.settings);
    next.zello = next.zello || {};
    const all = activeChannels(next);
    if (!all.includes(name)) all.push(name);
    next.zello.channelNames = all;
    next = assignBotsInSettings(next, name, true);
    await persist(
      next,
      'Joined bots → "' + name + '". Click Reconnect now (or Disconnect → Connect).'
    );
  }

  async function removeChannel(name) {
    let next = mergeRosterEdits(window.V2.state.settings);
    next.zello = next.zello || {};
    const all = activeChannels(next).filter((c) => c !== name);
    next.zello.channelNames = all;
    if (next.zello.channelName === name) {
      next.zello.channelName = all[0] || '';
    }
    for (const b of next.bots || []) {
      if (String(b.channelName || '').trim() === name) b.channelName = '';
    }
    await persist(next, 'Removed "' + name + '". Reconnect if bots were on it.');
  }

  async function assignFromPanel(onlyJoined) {
    const ch = $('channel-assign-select')?.value || '';
    if (!ch) {
      window.V2.showToastHint($('channels-hint'), 'Add / pick a channel first');
      return;
    }
    let next = mergeRosterEdits(window.V2.state.settings);
    next.zello = next.zello || {};
    const all = activeChannels(next);
    if (!all.includes(ch)) all.push(ch);
    next.zello.channelNames = all;
    next = assignBotsInSettings(next, ch, onlyJoined);
    await persist(
      next,
      (onlyJoined ? 'Joined bots' : 'All bots') +
        ' → "' +
        ch +
        '". Click Reconnect bots now.'
    );
  }

  async function saveChannels() {
    let next = mergeRosterEdits(window.V2.state.settings);
    await persist(
      next,
      'Saved. Reconnect bots so they join their channels.'
    );
  }

  async function reconnectBots() {
    if (!window.zelloBot?.zelloRuntime) return;
    window.V2.showToastHint($('channels-hint'), 'Reconnecting…');
    try {
      // Persist roster channel picks first
      if (window.V2.state.settings) {
        const withRoster = mergeRosterEdits(window.V2.state.settings);
        window.V2.state.settings = await window.zelloBot.settings.save(withRoster);
      }
      try {
        await window.zelloBot.zelloRuntime.disconnect();
      } catch {
        /* ignore */
      }
      const result = await window.zelloBot.zelloRuntime.connect();
      const ch =
        result?.listenOwnerChannel ||
        result?.channelName ||
        window.V2.state.settings?.zello?.channelName ||
        '';
      const n = result?.connectedCount || 0;
      window.V2.showToastHint(
        $('channels-hint'),
        'Connected ' + n + (ch ? ' · listen on ' + ch : '')
      );
      // Refresh top bar if app helpers exist
      if (typeof window.V2._refreshZello === 'function') {
        await window.V2._refreshZello();
      }
      window.V2.roster?.render?.(window.V2.state.settings, result);
    } catch (e) {
      window.V2.showToastHint(
        $('channels-hint'),
        e?.message || 'Reconnect failed'
      );
    }
  }

  function bind() {
    $('channel-add-btn')?.addEventListener('click', () => {
      addChannel($('channel-add-input')?.value).catch(console.error);
    });
    $('channel-add-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        $('channel-add-btn')?.click();
      }
    });
    $('channels-save')?.addEventListener('click', () => {
      saveChannels().catch(console.error);
    });
    $('channel-assign-joined')?.addEventListener('click', () => {
      assignFromPanel(true).catch(console.error);
    });
    $('channel-assign-all')?.addEventListener('click', () => {
      assignFromPanel(false).catch(console.error);
    });
    $('channels-reconnect')?.addEventListener('click', () => {
      reconnectBots().catch(console.error);
    });
  }

  window.V2.channels = {
    bind,
    render,
    saveChannels,
    addChannel,
    putJoinedOnChannel,
    reconnectBots
  };
})();
