const fs = require('fs');
const path = require('path');

const files = [
  'src/renderer/index.html',
  'src/renderer/app.js',
  'src/renderer/app.css',
  'src/renderer/ui/state.js',
  'src/renderer/ui/live.js',
  'src/renderer/ui/roster.js',
  'src/renderer/ui/channels.js',
  'src/renderer/ui/engines.js',
  'src/main/main.js',
  'src/main/preload.js',
  'README.md',
  'START-ALL.bat',
  '3-start-app.bat'
];

for (const f of files) {
  if (!fs.existsSync(path.join(__dirname, '..', f))) {
    throw new Error('missing ' + f);
  }
}

const html = fs.readFileSync(
  path.join(__dirname, '..', 'src/renderer/index.html'),
  'utf8'
);
const ids = [
  'activity-log',
  'roster-body',
  'channel-list',
  'engines-save',
  'voice-drawer',
  'btn-connect',
  'speak-as-bot',
  'view-live',
  'view-roster',
  'view-channels',
  'view-engines'
];
for (const id of ids) {
  if (!html.includes('id="' + id + '"')) {
    throw new Error('missing id ' + id);
  }
}

const main = fs.readFileSync(
  path.join(__dirname, '..', 'src/main/main.js'),
  'utf8'
);
if (!main.includes('ai-seller-bot-desktop-v2')) {
  throw new Error('main.js missing v2 userData name');
}
if (!main.includes('voice-bot:status-changed')) {
  throw new Error('main.js missing status push');
}

const preload = fs.readFileSync(
  path.join(__dirname, '..', 'src/main/preload.js'),
  'utf8'
);
if (!preload.includes('onStatusChanged')) {
  throw new Error('preload missing onStatusChanged');
}

const pkg = require('../package.json');
console.log('smoke-ok', pkg.name, pkg.version);
