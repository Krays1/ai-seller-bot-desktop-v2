export const SUITS = ['S', 'H', 'D', 'C'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const SUIT_SYMBOLS = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
};

export function normalizeChannelKey(channelKey) {
  return String(channelKey || '').trim().toLowerCase() || 'default';
}

export function safeFilePart(value) {
  return String(value || 'channel')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^\w().+-]+/g, '_')
    .slice(0, 80) || 'channel';
}

export function newDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

export function shuffle(deck) {
  const cards = [...deck];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function cardCode(card) {
  return card ? `${card.rank}${card.suit}` : '';
}

export function cardLabel(card) {
  return card ? `${card.rank}${SUIT_SYMBOLS[card.suit] || card.suit}` : '';
}

export function cardColor(card) {
  return card?.suit === 'H' || card?.suit === 'D' ? '#dc2626' : '#111827';
}

export function rankValue(rank) {
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  return Number(rank) || 0;
}

export function blackjackValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards || []) {
    if (!card) continue;
    if (card.rank === 'A') {
      aces += 1;
      total += 11;
    } else if (['K', 'Q', 'J'].includes(card.rank)) {
      total += 10;
    } else {
      total += Number(card.rank) || 0;
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

export function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const BLOCK_FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  6: ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
};

export function blockTextWidth(text, scale = 4, gap = 2) {
  const chars = String(text || '').toUpperCase().split('');
  return chars.reduce((total, char, index) => {
    if (char === ' ') return total + 3 * scale;
    const rows = BLOCK_FONT[char];
    const width = rows?.[0]?.length || 0;
    return total + width * scale + (index < chars.length - 1 ? gap * scale : 0);
  }, 0);
}

export function blockTextSvg(text, x, y, scale = 4, fill = '#111827', gap = 2) {
  const parts = [];
  let cursor = x;
  for (const char of String(text || '').toUpperCase()) {
    if (char === ' ') {
      cursor += 3 * scale;
      continue;
    }
    const rows = BLOCK_FONT[char];
    if (!rows) continue;
    for (let row = 0; row < rows.length; row++) {
      for (let col = 0; col < rows[row].length; col++) {
        if (rows[row][col] === '1') {
          parts.push(`<rect x="${cursor + col * scale}" y="${y + row * scale}" width="${scale}" height="${scale}" fill="${fill}"/>`);
        }
      }
    }
    cursor += rows[0].length * scale + gap * scale;
  }
  return parts.join('');
}

function suitShapeSvg(suit, cx, cy, size, fill) {
  const s = Number(size) || 24;
  if (suit === 'H') {
    return `<path d="M ${cx} ${cy + s * 0.42} C ${cx - s * 0.95} ${cy - s * 0.2}, ${cx - s * 0.48} ${cy - s * 0.92}, ${cx} ${cy - s * 0.42} C ${cx + s * 0.48} ${cy - s * 0.92}, ${cx + s * 0.95} ${cy - s * 0.2}, ${cx} ${cy + s * 0.42} Z" fill="${fill}"/>`;
  }
  if (suit === 'D') {
    return `<polygon points="${cx},${cy - s * 0.72} ${cx + s * 0.58},${cy} ${cx},${cy + s * 0.72} ${cx - s * 0.58},${cy}" fill="${fill}"/>`;
  }
  if (suit === 'C') {
    return [
      `<circle cx="${cx}" cy="${cy - s * 0.28}" r="${s * 0.32}" fill="${fill}"/>`,
      `<circle cx="${cx - s * 0.34}" cy="${cy + s * 0.08}" r="${s * 0.32}" fill="${fill}"/>`,
      `<circle cx="${cx + s * 0.34}" cy="${cy + s * 0.08}" r="${s * 0.32}" fill="${fill}"/>`,
      `<path d="M ${cx - s * 0.12} ${cy + s * 0.26} L ${cx - s * 0.28} ${cy + s * 0.68} H ${cx + s * 0.28} L ${cx + s * 0.12} ${cy + s * 0.26} Z" fill="${fill}"/>`,
    ].join('');
  }
  return `<path d="M ${cx} ${cy - s * 0.7} C ${cx - s * 0.9} ${cy + s * 0.02}, ${cx - s * 0.36} ${cy + s * 0.6}, ${cx - s * 0.06} ${cy + s * 0.28} L ${cx - s * 0.24} ${cy + s * 0.72} H ${cx + s * 0.24} L ${cx + s * 0.06} ${cy + s * 0.28} C ${cx + s * 0.36} ${cy + s * 0.6}, ${cx + s * 0.9} ${cy + s * 0.02}, ${cx} ${cy - s * 0.7} Z" fill="${fill}"/>`;
}

export function cardSvg(card, x, y, width = 92, height = 128, options = {}) {
  const rx = 10;
  if (options.hidden) {
    return [
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="#1d4ed8" stroke="#bfdbfe" stroke-width="3"/>`,
      `<rect x="${x + 10}" y="${y + 10}" width="${width - 20}" height="${height - 20}" rx="7" fill="none" stroke="#93c5fd" stroke-width="2"/>`,
      blockTextSvg('Z', x + width / 2 - 10, y + height / 2 - 14, 4, '#dbeafe'),
    ].join('');
  }
  if (!card) {
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="none" stroke="#cbd5e1" stroke-width="3" stroke-dasharray="9 8" opacity="0.8"/>`;
  }
  const fill = cardColor(card);
  const faceFill = fill === '#dc2626' ? '#fff1f2' : '#f8fafc';
  const rank = String(card.rank || '');
  const rankScale = rank === '10' ? 3 : 4;
  const topRank = blockTextSvg(rank, x + 10, y + 10, rankScale, fill, 1);
  const bottomRankWidth = blockTextWidth(rank, rankScale, 1);
  const bottomRank = blockTextSvg(rank, x + width - bottomRankWidth - 10, y + height - 38, rankScale, fill, 1);
  const topSuit = suitShapeSvg(card.suit, x + 22, y + 54, 15, fill);
  const bottomSuit = suitShapeSvg(card.suit, x + width - 22, y + height - 54, 15, fill);
  const bigSuit = suitShapeSvg(card.suit, x + width / 2, y + height / 2 + 4, 34, fill);
  return [
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${faceFill}" stroke="#0f172a" stroke-width="2"/>`,
    topRank,
    topSuit,
    bigSuit,
    bottomSuit,
    bottomRank,
  ].join('');
}
