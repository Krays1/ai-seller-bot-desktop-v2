const fs = require('fs');
const p = 'E:/AI-Seller-Bot-Desktop-v2/src/renderer/index.html';
let h = fs.readFileSync(p, 'utf8');
h = h.replace(/\s*<input type="hidden" id="auto-reply"[^>]*>/, '');
fs.writeFileSync(p, h);
console.log('auto-reply hidden gone:', !h.includes('id="auto-reply"'));
console.log('mode-listen:', h.includes('id="mode-listen"'));
console.log('live-mode:', h.includes('id="live-mode"'));
