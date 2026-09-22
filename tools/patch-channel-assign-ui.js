const fs = require('fs');
const p = 'E:/AI-Seller-Bot-Desktop-v2/src/renderer/index.html';
let html = fs.readFileSync(p, 'utf8');

const oldRosterToolbar = `        <div class="roster-toolbar">
          <div class="toolbar-left">
            <button type="button" class="btn" id="roster-enable-all">Join all</button>
            <button type="button" class="btn" id="roster-disable-all">Leave all</button>
            <button type="button" class="btn" id="roster-speak-all">Speak all</button>
            <button type="button" class="btn" id="roster-mute-all">Mute speak</button>
            <button type="button" class="btn primary" id="roster-save">Save roster</button>
          </div>
          <p class="hint" id="roster-hint">Join = listen/connect · Speak = free talk · Name = reply when called</p>
        </div>`;

const newRosterToolbar = `        <div class="roster-toolbar">
          <div class="toolbar-left">
            <button type="button" class="btn" id="roster-enable-all">Join all</button>
            <button type="button" class="btn" id="roster-disable-all">Leave all</button>
            <button type="button" class="btn" id="roster-speak-all">Speak all</button>
            <button type="button" class="btn" id="roster-mute-all">Mute speak</button>
            <button type="button" class="btn primary" id="roster-save">Save roster</button>
          </div>
          <div class="toolbar-channel">
            <label class="bulk-channel">
              <span>Assign channel</span>
              <select id="roster-bulk-channel"></select>
            </label>
            <button type="button" class="btn" id="roster-assign-channel-joined">To joined</button>
            <button type="button" class="btn" id="roster-assign-channel-all">To all bots</button>
          </div>
          <p class="hint" id="roster-hint">Join = connect · Speak = free talk · Name = when called · <strong>Channel</strong> = pick per bot (blank = primary). Save, then Disconnect → Connect.</p>
        </div>`;

if (!html.includes('roster-bulk-channel')) {
  if (!html.includes(oldRosterToolbar)) throw new Error('roster toolbar not found');
  html = html.replace(oldRosterToolbar, newRosterToolbar);
}

const oldChannels = `      <section class="view" id="view-channels" data-view="channels">
        <div class="split-2">
          <article class="panel">
            <header class="panel-head"><h2>Active channels</h2></header>
            <div class="channel-list" id="channel-list"></div>
            <div class="compose-row tight">
              <input type="text" id="channel-add-input" placeholder="Channel name">
              <button type="button" class="btn primary" id="channel-add-btn">Add</button>
            </div>
            <button type="button" class="btn" id="channels-save">Save channels</button>
          </article>
          <article class="panel">
            <header class="panel-head"><h2>Catalog</h2></header>
            <p class="hint">Imported channels from <code>config/imported-catalog.json</code>. Assign on Roster per bot.</p>
            <div class="channel-list muted" id="catalog-channel-list"></div>
          </article>
        </div>
      </section>`;

const newChannels = `      <section class="view" id="view-channels" data-view="channels">
        <div class="channels-layout">
          <article class="panel">
            <header class="panel-head"><h2>Active channels</h2></header>
            <p class="hint" id="channels-hint">These appear in each bot’s Channel dropdown on Roster. Primary = blank channel on a bot.</p>
            <div class="channel-list" id="channel-list"></div>
            <div class="compose-row tight">
              <input type="text" id="channel-add-input" placeholder="Channel name">
              <button type="button" class="btn primary" id="channel-add-btn">Add</button>
            </div>
          </article>
          <article class="panel">
            <header class="panel-head"><h2>Assign bots to a channel</h2></header>
            <p class="hint">Sets the Roster Channel column. Then Save channels (or Save roster) and reconnect.</p>
            <label class="field">
              <span class="field-label">Channel</span>
              <select id="channel-assign-select"></select>
            </label>
            <div class="compose-row tight">
              <button type="button" class="btn" id="channel-assign-joined">Assign to joined bots</button>
              <button type="button" class="btn" id="channel-assign-all">Assign to all bots</button>
            </div>
            <button type="button" class="btn primary" id="channels-save">Save channels &amp; assignments</button>
          </article>
          <article class="panel channels-catalog">
            <header class="panel-head"><h2>Catalog</h2></header>
            <p class="hint">Imported channel names — click Add to make them active, then assign on Roster.</p>
            <div class="channel-list muted" id="catalog-channel-list"></div>
          </article>
        </div>
      </section>`;

if (!html.includes('channel-assign-select')) {
  if (!html.includes(oldChannels)) throw new Error('channels section not found');
  html = html.replace(oldChannels, newChannels);
}

fs.writeFileSync(p, html);
console.log('html ok', {
  bulk: html.includes('roster-bulk-channel'),
  assign: html.includes('channel-assign-select')
});
