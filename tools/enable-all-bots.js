/**
 * Force enabled=true on every bot in settings.json
 */
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(
  process.env.APPDATA || '',
  'ai-seller-bot-desktop',
  'settings.json'
);

if (!fs.existsSync(file)) {
  console.error('No settings yet. Run import-my-setup.bat first.');
  process.exit(1);
}

const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
const bots = Array.isArray(settings.bots) ? settings.bots : [];
if (!bots.length) {
  console.error('No bots in settings. Run import-my-setup.bat first.');
  process.exit(1);
}

let n = 0;
for (const bot of bots) {
  if (!bot.enabled) n += 1;
  bot.enabled = true;
  if (typeof bot.canSpeak !== 'boolean') {
    bot.canSpeak = true;
  }
}
settings.bots = bots;

const first = bots[0];
if (first) {
  settings.zello = {
    ...(settings.zello || {}),
    botUsername: first.username || '',
    password: first.password || '',
    token: first.token || '',
  };
}

fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
console.log(`Enabled ${bots.length}/${bots.length} bots (turned on ${n} that were off).`);
console.log('In the app: Save is optional — click Connect bots.');
