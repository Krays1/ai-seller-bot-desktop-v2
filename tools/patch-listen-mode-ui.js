const fs = require('fs');
const p = 'E:/AI-Seller-Bot-Desktop-v2/src/renderer/index.html';
let html = fs.readFileSync(p, 'utf8');

const oldToggle = `              <section class="fight-section fight-toggles">
                <h3>Behaviours</h3>
                <div class="toggle-list">
                  <label class="toggle" for="auto-reply">
                    <input type="checkbox" id="auto-reply">
                    <span class="toggle-text">
                      <strong>Auto reply</strong>
                      <small>Bots answer after speech is heard (off = Speak-as only)</small>
                    </span>
                  </label>`;

const newBlock = `              <section class="fight-section fight-mode">
                <h3>Channel mode</h3>
                <p class="hint">Listening always transcribes into Heard. Auto reply is optional on top.</p>
                <div class="mode-cards">
                  <label class="mode-card" for="mode-listen">
                    <input type="radio" name="channel-mode" id="mode-listen" value="listen">
                    <span class="mode-card-body">
                      <strong>Listen only</strong>
                      <small>Transcribe everyone into Heard. Bots do not seize or answer (Speak-as still works).</small>
                    </span>
                  </label>
                  <label class="mode-card" for="mode-reply">
                    <input type="radio" name="channel-mode" id="mode-reply" value="reply">
                    <span class="mode-card-body">
                      <strong>Listen + auto reply</strong>
                      <small>Transcribe, then bots fight for the button and answer.</small>
                    </span>
                  </label>
                </div>
                <input type="hidden" id="auto-reply" value="1">
              </section>

              <section class="fight-section fight-toggles">
                <h3>Behaviours</h3>
                <div class="toggle-list">`;

if (!html.includes(oldToggle)) {
  throw new Error('auto-reply toggle block not found');
}
html = html.replace(oldToggle, newBlock);

// Live mode badge near Heard
if (!html.includes('id="live-mode"')) {
  html = html.replace(
    '<header class="panel-head"><h2>Heard</h2><span class="meta" id="live-speaker">No speaker</span></header>',
    '<header class="panel-head"><h2>Heard</h2><span class="meta"><span id="live-mode">Listen</span> · <span id="live-speaker">No speaker</span></span></header>'
  );
}

fs.writeFileSync(p, html);
console.log('html patched');
