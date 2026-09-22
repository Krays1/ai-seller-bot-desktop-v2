import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  blackjackValue,
  blockTextSvg,
  blockTextWidth,
  cardLabel,
  cardSvg,
  newDeck,
  normalizeChannelKey,
  safeFilePart,
  shuffle,
  xmlEscape,
} from './playing-cards.js';

function drawCard(game) {
  if (!game.deck.length) {
    game.deck = shuffle(newDeck());
  }
  return game.deck.pop();
}

function settle(game) {
  game.dealerHidden = false;
  while (blackjackValue(game.dealer) < 17) {
    game.dealer.push(drawCard(game));
  }
  const playerTotal = blackjackValue(game.player);
  const dealerTotal = blackjackValue(game.dealer);
  if (playerTotal > 21) game.result = 'bust';
  else if (dealerTotal > 21) game.result = 'dealer bust';
  else if (playerTotal > dealerTotal) game.result = 'player wins';
  else if (playerTotal < dealerTotal) game.result = 'dealer wins';
  else game.result = 'push';
  game.active = false;
}

function emptyGame(channelKey, starter = '') {
  const game = {
    channelKey,
    starter: starter || null,
    playerName: starter || 'player',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    active: true,
    deck: shuffle(newDeck()),
    player: [],
    dealer: [],
    dealerHidden: true,
    result: null,
    moves: [],
  };
  game.player.push(drawCard(game), drawCard(game));
  game.dealer.push(drawCard(game), drawCard(game));
  if (blackjackValue(game.player) === 21) settle(game);
  return game;
}

export class BlackjackGameStore {
  constructor(dataFile) {
    this.dataFile = path.resolve(dataFile);
    this.boardDir = path.join(path.dirname(this.dataFile), 'blackjack-boards');
    this.games = {};
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.dataFile)) {
        const raw = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
        this.games = raw?.games && typeof raw.games === 'object' ? raw.games : {};
      }
    } catch {
      this.games = {};
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
    fs.writeFileSync(this.dataFile, JSON.stringify({ games: this.games }, null, 2));
  }

  gameFor(channelKey) {
    return this.games[normalizeChannelKey(channelKey)] || null;
  }

  start(channelKey, starter = '') {
    const key = normalizeChannelKey(channelKey);
    const game = emptyGame(key, starter);
    this.games[key] = game;
    this.save();
    return game;
  }

  hit(channelKey, by = '') {
    const key = normalizeChannelKey(channelKey);
    const game = this.games[key] || this.start(key, by);
    if (!game.active) throw new Error('Blackjack hand is over. Say bot start blackjack for a new hand.');
    game.player.push(drawCard(game));
    game.updatedAt = new Date().toISOString();
    game.moves.push({ type: 'hit', by: by || null, at: game.updatedAt });
    if (blackjackValue(game.player) > 21) {
      game.dealerHidden = false;
      game.result = 'bust';
      game.active = false;
    }
    this.save();
    return game;
  }

  stand(channelKey, by = '') {
    const key = normalizeChannelKey(channelKey);
    const game = this.games[key] || this.start(key, by);
    if (!game.active) throw new Error('Blackjack hand is over. Say bot start blackjack for a new hand.');
    game.updatedAt = new Date().toISOString();
    game.moves.push({ type: 'stand', by: by || null, at: game.updatedAt });
    settle(game);
    this.save();
    return game;
  }

  stop(channelKey, by = '') {
    const game = this.gameFor(channelKey);
    if (!game?.active) return null;
    game.active = false;
    game.result = 'stopped';
    game.stoppedBy = by || null;
    game.updatedAt = new Date().toISOString();
    this.save();
    return game;
  }

  summary(channelKey) {
    const game = this.gameFor(channelKey);
    if (!game) return 'No blackjack hand. Say bot start blackjack.';
    const playerTotal = blackjackValue(game.player);
    const dealerTotal = game.dealerHidden
      ? blackjackValue([game.dealer[0]])
      : blackjackValue(game.dealer);
    if (game.active) {
      return `Blackjack: ${game.playerName || 'Player'} has ${playerTotal}. Dealer shows ${dealerTotal}. Say bot hit me or bot stick.`;
    }
    return `Blackjack over: ${game.result}. Player ${playerTotal}. Dealer ${blackjackValue(game.dealer)}.`;
  }

  async writeBoardJpeg(channelKey) {
    fs.mkdirSync(this.boardDir, { recursive: true });
    const key = normalizeChannelKey(channelKey);
    const game = this.gameFor(key);
    if (!game) throw new Error('No blackjack game in this channel');
    const filename = `${safeFilePart(key)}-${Date.now()}.jpg`;
    const localPath = path.join(this.boardDir, filename);
    const width = 900;
    const height = 620;
    const cardW = 106;
    const cardH = 148;
    const gap = 22;
    const dealerTotal = game.dealerHidden ? blackjackValue([game.dealer[0]]) : blackjackValue(game.dealer);
    const playerTotal = blackjackValue(game.player);
    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      '<rect width="100%" height="100%" fill="#14532d"/>',
      '<circle cx="450" cy="310" r="285" fill="none" stroke="#facc15" stroke-width="5" opacity="0.45"/>',
      '<text x="36" y="52" font-family="Arial, sans-serif" font-size="38" font-weight="900" fill="#f8fafc">Zello Blackjack 21</text>',
      `<text x="36" y="88" font-family="Arial, sans-serif" font-size="22" fill="#d1fae5">Commands: bot hit me | bot stick | bot start blackjack</text>`,
      `<text x="44" y="140" font-family="Arial, sans-serif" font-size="28" font-weight="900" fill="#fef3c7">Dealer ${game.dealerHidden ? 'shows' : 'total'}: ${dealerTotal}</text>`,
      `<text x="44" y="372" font-family="Arial, sans-serif" font-size="28" font-weight="900" fill="#fef3c7">${xmlEscape(game.playerName || 'Player')}: ${playerTotal}</text>`,
    ];
    game.dealer.forEach((card, i) => {
      parts.push(cardSvg(card, 44 + i * (cardW + gap), 158, cardW, cardH, { hidden: game.dealerHidden && i === 1 }));
    });
    game.player.forEach((card, i) => {
      parts.push(cardSvg(card, 44 + i * (cardW + gap), 392, cardW, cardH));
    });
    if (game.result) {
      const result = game.result.toUpperCase();
      const scale = result.length > 10 ? 4 : 5;
      const textWidth = blockTextWidth(result, scale, 1);
      parts.push(`<rect x="500" y="228" width="340" height="112" rx="18" fill="#020617" opacity="0.82"/>`);
      parts.push(blockTextSvg(result, 670 - textWidth / 2, 270, scale, '#fde68a', 1));
    } else {
      parts.push('<text x="540" y="292" font-family="Arial, sans-serif" font-size="34" font-weight="900" fill="#fde68a">Hit or Stick?</text>');
    }
    parts.push('</svg>');
    const buffer = await sharp(Buffer.from(parts.join('')))
      .jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer();
    const thumbnailBuffer = await sharp(buffer)
      .resize(720, 720, { fit: 'inside' })
      .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer();
    fs.writeFileSync(localPath, buffer);
    return {
      localPath,
      filename,
      url: `/blackjack-boards/${encodeURIComponent(filename)}`,
      buffer,
      thumbnailBuffer,
      width,
      height,
    };
  }
}
