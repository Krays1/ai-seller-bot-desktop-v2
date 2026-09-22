const fs = require('fs');
const p = 'E:/AI-Seller-Bot-Desktop-v2/src/renderer/index.html';
let html = fs.readFileSync(p, 'utf8');

const old = `          <article class="panel">
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
          </article>`;

const next = `          <article class="panel">
            <header class="panel-head"><h2>Active channels</h2></header>
            <p class="hint" id="channels-hint">1) Add channel · 2) Put bots on it · 3) Reconnect</p>
            <div class="channel-list" id="channel-list"></div>
            <div class="compose-row tight">
              <input type="text" id="channel-add-input" placeholder="Exact Zello channel name">
              <button type="button" class="btn primary" id="channel-add-btn">Add channel</button>
            </div>
            <label class="check channel-add-opts"><input type="checkbox" id="channel-add-assign" checked> Also put <strong>joined</strong> bots on this channel</label>
            <label class="check channel-add-opts"><input type="checkbox" id="channel-add-primary"> Make this the primary channel</label>
          </article>
          <article class="panel">
            <header class="panel-head"><h2>Assign &amp; reconnect</h2></header>
            <p class="hint">Bots only move after reconnect. Use “Use for joined” on a channel row, or pick here.</p>
            <label class="field">
              <span class="field-label">Channel</span>
              <select id="channel-assign-select"></select>
            </label>
            <div class="compose-row tight">
              <button type="button" class="btn" id="channel-assign-joined">Joined bots → channel</button>
              <button type="button" class="btn" id="channel-assign-all">All bots → channel</button>
            </div>
            <div class="compose-row tight" style="margin-top:10px">
              <button type="button" class="btn primary" id="channels-reconnect">Reconnect bots now</button>
              <button type="button" class="btn" id="channels-save">Save only</button>
            </div>
          </article>`;

if (!html.includes('channels-reconnect')) {
  if (!html.includes(old)) {
    console.error('channels block not found');
    process.exit(1);
  }
  html = html.replace(old, next);
  fs.writeFileSync(p, html);
  console.log('patched channels html');
} else {
  console.log('already patched');
}
