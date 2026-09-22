const fs = require('fs');
const p = 'E:/AI-Seller-Bot-Desktop-v2/src/renderer/index.html';
let html = fs.readFileSync(p, 'utf8');
const start = html.indexOf('<article class="panel engines-fight">');
const endMarker = '</article>';
const end = html.indexOf(endMarker, start) + endMarker.length;
if (start < 0 || end < endMarker.length) {
  throw new Error('block not found ' + start + ' ' + end);
}

const next = `<article class="panel engines-fight">
            <header class="panel-head">
              <h2>Fight &amp; chat</h2>
              <span class="meta">How bots grab the button and talk after someone speaks</span>
            </header>

            <div class="fight-layout">
              <section class="fight-section">
                <h3>Who answers</h3>
                <p class="hint">After a human talks, which bots race for the mic.</p>
                <div class="fight-fields">
                  <label class="field">
                    <span class="field-label">Reply style</span>
                    <select id="reply-mode">
                      <option value="random">Random fight — pick fighters at random</option>
                      <option value="roundRobin">Round robin — take turns</option>
                      <option value="preferred">Preferred bot — favour one bot</option>
                    </select>
                  </label>
                  <label class="field">
                    <span class="field-label">Max fighters</span>
                    <span class="field-help">How many bots line up each round</span>
                    <input id="max-fighters" type="number" min="1" max="12">
                  </label>
                  <label class="field">
                    <span class="field-label">Data cooldown (ms)</span>
                    <span class="field-help">Wait after a bot finishes before the next can speak</span>
                    <input id="cooldown-ms" type="number" min="0" max="60000" step="10">
                  </label>
                </div>
              </section>

              <section class="fight-section">
                <h3>Tone</h3>
                <p class="hint">Personality of replies on the radio.</p>
                <div class="fight-fields">
                  <label class="field field-wide">
                    <span class="field-label">Chat flow</span>
                    <select id="chat-mode">
                      <option value="chat">Chat — normal conversation</option>
                      <option value="banter">Banter — playful push-back</option>
                      <option value="argument">Argument — strong disagreement</option>
                      <option value="extreme">Extreme — hard argue / no soft close</option>
                    </select>
                  </label>
                </div>
              </section>

              <section class="fight-section">
                <h3>Timing</h3>
                <p class="hint">How long humans and bots get to hold the channel.</p>
                <div class="fight-fields">
                  <label class="field">
                    <span class="field-label">Max human talk (ms)</span>
                    <span class="field-help">Cap a long human PTT so bots can cut in (20000 = 20s)</span>
                    <input id="max-user-talk" type="number" min="0" step="1000">
                  </label>
                  <label class="field">
                    <span class="field-label">Bot speak target (sec)</span>
                    <span class="field-help">Aim for replies about this long</span>
                    <input id="bot-speak-sec" type="number" min="1" max="60">
                  </label>
                </div>
              </section>

              <section class="fight-section fight-toggles">
                <h3>Behaviours</h3>
                <div class="toggle-list">
                  <label class="toggle" for="auto-reply">
                    <input type="checkbox" id="auto-reply">
                    <span class="toggle-text">
                      <strong>Auto reply</strong>
                      <small>Bots answer after speech is heard (off = Speak-as only)</small>
                    </span>
                  </label>
                  <label class="toggle" for="allow-peer-chat">
                    <input type="checkbox" id="allow-peer-chat">
                    <span class="toggle-text">
                      <strong>Bots steal from each other</strong>
                      <small>Another bot can snatch the button mid-fight</small>
                    </span>
                  </label>
                  <label class="toggle" for="cut-in-capped">
                    <input type="checkbox" id="cut-in-capped">
                    <span class="toggle-text">
                      <strong>Cut in when human talk is capped</strong>
                      <small>Start seizing once max human talk time is hit</small>
                    </span>
                  </label>
                  <label class="toggle" for="interrupt-reset">
                    <input type="checkbox" id="interrupt-reset">
                    <span class="toggle-text">
                      <strong>Stop bot TX when a human keys up</strong>
                      <small>Abort our transmit if someone else starts talking</small>
                    </span>
                  </label>
                </div>
              </section>
            </div>

            <div class="fight-actions">
              <button type="button" class="btn primary" id="engines-save">Save engines</button>
              <span class="meta" id="engines-save-hint"></span>
            </div>
          </article>`;

html = html.slice(0, start) + next + html.slice(end);
fs.writeFileSync(p, html);
console.log('replaced engines-fight ok');
