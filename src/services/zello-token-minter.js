const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DAY_MS = 24 * 60 * 60 * 1000;

function tokenExpiryMs(token) {
  try {
    const payload = JSON.parse(
      Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')
    );
    return (Number(payload.exp) || 0) * 1000;
  } catch {
    return 0;
  }
}

/**
 * Signs Zello Channel API tokens with the developer key kept in userData
 * (zello-private-key.pem + zello-dev-key.json { issuer }). Tokens are not
 * tied to a Zello username, so one token serves every bot account.
 */
class ZelloTokenMinter {
  constructor(userDataDir, options = {}) {
    this.keyFile = path.join(userDataDir, 'zello-private-key.pem');
    this.configFile = path.join(userDataDir, 'zello-dev-key.json');
    this.ttlMs = options.ttlMs || 7 * DAY_MS;
    this.renewWithinMs = options.renewWithinMs || 3 * DAY_MS;
    this.cached = null;
  }

  loadKey() {
    if (this.cached) return this.cached;
    if (!fs.existsSync(this.keyFile) || !fs.existsSync(this.configFile)) {
      return null;
    }
    const issuer = String(
      JSON.parse(fs.readFileSync(this.configFile, 'utf8'))?.issuer || ''
    ).trim();
    if (!issuer) return null;
    const key = crypto.createPrivateKey(fs.readFileSync(this.keyFile));
    this.cached = { issuer, key };
    return this.cached;
  }

  isConfigured() {
    try {
      return Boolean(this.loadKey());
    } catch {
      return false;
    }
  }

  mint() {
    const dev = this.loadKey();
    if (!dev) throw new Error('Zello developer key or issuer missing');
    const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const body =
      enc({ typ: 'JWT', alg: 'RS256' }) +
      '.' +
      enc({
        iss: dev.issuer,
        exp: Math.floor((Date.now() + this.ttlMs) / 1000),
        azp: 'dev'
      });
    const sig = crypto
      .sign('RSA-SHA256', Buffer.from(body), dev.key)
      .toString('base64url');
    return body + '.' + sig;
  }

  /**
   * Gives a fresh token to every bot whose token is missing or expires
   * within renewWithinMs. Returns the usernames that were renewed.
   */
  renewBotTokens(settingsStore) {
    if (!this.isConfigured()) return [];
    const settings = settingsStore.read();
    const bots = Array.isArray(settings?.bots) ? settings.bots : [];
    const cutoff = Date.now() + this.renewWithinMs;
    let fresh = '';
    const renewed = [];
    const nextBots = bots.map((bot) => {
      if (!bot || !bot.username) return bot;
      if (tokenExpiryMs(bot.token) > cutoff) return bot;
      fresh = fresh || this.mint();
      renewed.push(String(bot.username));
      return { ...bot, token: fresh };
    });
    if (renewed.length) {
      settingsStore.write({ ...settings, bots: nextBots });
    }
    return renewed;
  }
}

module.exports = { ZelloTokenMinter, tokenExpiryMs };
