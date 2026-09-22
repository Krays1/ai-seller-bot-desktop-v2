import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { blockTextSvg, normalizeChannelKey, safeFilePart } from './playing-cards.js';

const ROWS = 6;
const COLS = 7;

function emptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function emptyGame(channelKey, starter = '') {
  const now = new Date().toISOString();
  return {
    channelKey,
    startedAt: now,
    updatedAt: now,
    active: true,
    turn: 'red',
    players: starter ? { red: starter } : {},
    board: emptyBoard(),
    moves: [],
    winner: null,
    winningCells: [],
  };
}

function cleanColumn(value) {
  const match = String(value || '').match(/[1-7]/);
  return match ? Number(match[0]) : null;
}

export function parseConnect4Move(text) {
  const raw = String(text || '').trim();
  const match =
    raw.match(/\b(?:drop|play|put|column|col|move)\s+([1-7])\b/i) ||
    raw.match(/\b([1-7])\b/);
  const column = cleanColumn(match?.[1]);
  return column ? { column } : null;
}

function winnerFrom(board, row, col, color) {
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (const [dr, dc] of dirs) {
    const cells = [[row, col]];
    for (const sign of [-1, 1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === color) {
        cells.push([r, c]);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (cells.length >= 4) return cells.slice(0, 4);
  }
  return [];
}

function isDraw(board) {
  return board[0].every(Boolean);
}

function canonicalColor(token) {
  if (!token) return null;
  if (token === 'black') return 'yellow';
  return token === 'red' || token === 'yellow' ? token : null;
}

function playerForColor(game, color) {
  const piece = canonicalColor(color) || color;
  return (
    game.players?.[color] ||
    game.players?.[piece] ||
    (piece === 'yellow' ? game.players?.black : null) ||
    null
  );
}

function classicDiscParts(cx, cy, token, isWin) {
  const piece = canonicalColor(token);
  if (!piece) return [];
  const isRed = piece === 'red';
  const gradId = isRed ? 'redDisc' : 'yellowDisc';
  const rim = isRed ? '#7f1d1d' : '#a16207';
  const parts = [
    '<g filter="url(#discShadow)">',
    `<ellipse cx="${cx}" cy="${cy + 5}" rx="31" ry="7" fill="#000" opacity="0.32"/>`,
    `<circle cx="${cx}" cy="${cy}" r="33" fill="url(#${gradId})" stroke="${rim}" stroke-width="1.8"/>`,
    `<ellipse cx="${cx - 11}" cy="${cy - 13}" rx="13" ry="9" fill="#fff" opacity="${isRed ? 0.38 : 0.48}"/>`,
    `<circle cx="${cx + 9}" cy="${cy + 11}" r="4" fill="#fff" opacity="0.18"/>`,
  ];
  if (isWin) {
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="37" fill="none" stroke="#fff" stroke-width="5" opacity="0.95"/>`
    );
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="41" fill="none" stroke="#fde047" stroke-width="2.5" opacity="0.85"/>`
    );
  }
  parts.push('</g>');
  return parts;
}

function boardFrameParts(frameX, frameY, boardW, boardH) {
  const outerX = frameX - 28;
  const outerY = frameY - 34;
  const outerW = boardW + 56;
  const outerH = boardH + 74;
  const trayY = frameY + boardH + 18;
  return [
    '<g filter="url(#frameShadow)">',
    `<rect x="${outerX - 6}" y="${outerY - 6}" width="${outerW + 12}" height="${outerH + 12}" rx="34" fill="#021024" opacity="0.55"/>`,
    `<rect x="${outerX}" y="${outerY}" width="${outerW}" height="${outerH}" rx="30" fill="url(#frameBody)" stroke="#0b2f6b" stroke-width="3"/>`,
    `<rect x="${outerX + 10}" y="${outerY + 10}" width="${outerW - 20}" height="${outerH - 20}" rx="24" fill="none" stroke="#4f8fe8" stroke-width="2" opacity="0.35"/>`,
    `<rect x="${frameX - 14}" y="${frameY - 14}" width="${boardW + 28}" height="${boardH + 28}" rx="20" fill="url(#playSurface)" stroke="#08306b" stroke-width="2"/>`,
    `<rect x="${outerX + 18}" y="${outerY + 12}" width="${outerW - 36}" height="18" rx="9" fill="#fff" opacity="0.12"/>`,
    `<rect x="${outerX + 24}" y="${trayY}" width="${outerW - 48}" height="34" rx="10" fill="url(#trayGrad)" stroke="#0b2f6b" stroke-width="2"/>`,
    `<polygon points="${outerX + 42},${outerY + outerH + 8} ${outerX + outerW - 42},${outerY + outerH + 8} ${outerX + outerW - 70},${outerY + outerH + 34} ${outerX + 70},${outerY + outerH + 34}" fill="url(#legGrad)" stroke="#052148" stroke-width="2"/>`,
    '</g>',
  ];
}

export class Connect4GameStore {
  constructor(dataFile) {
    this.dataFile = path.resolve(dataFile);
    this.boardDir = path.join(path.dirname(this.dataFile), 'connect4-boards');
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

  stop(channelKey, by = '') {
    const game = this.gameFor(channelKey);
    if (!game?.active) return null;
    game.active = false;
    game.stoppedBy = by || null;
    game.updatedAt = new Date().toISOString();
    this.save();
    return game;
  }

  drop(channelKey, columnInput, by = '') {
    const key = normalizeChannelKey(channelKey);
    const game = this.games[key] || this.start(key, by);
    if (!game.active) throw new Error('Connect 4 game is over. Say bot start connect 4.');
    const column = cleanColumn(columnInput);
    if (!column) throw new Error('Choose a column from 1 to 7.');
    const col = column - 1;
    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (!game.board[r][col]) {
        row = r;
        break;
      }
    }
    if (row < 0) throw new Error(`Column ${column} is full. Pick another column.`);

    const color = game.turn || 'red';
    if (by && !game.players[color]) game.players[color] = by;
    game.board[row][col] = color;
    game.updatedAt = new Date().toISOString();
    game.moves.push({ column, row, color, by: by || null, at: game.updatedAt });

    const winningCells = winnerFrom(game.board, row, col, color);
    if (winningCells.length) {
      game.active = false;
      game.winner = color;
      game.winningCells = winningCells;
    } else if (isDraw(game.board)) {
      game.active = false;
      game.draw = true;
    } else {
      game.turn = color === 'red' ? 'yellow' : 'red';
    }
    this.save();
    return { game, column, row, color };
  }

  summary(channelKey) {
    const game = this.gameFor(channelKey);
    if (!game) return 'No Connect 4 game. Say bot start connect 4.';
    if (game.winner) {
      const winner = canonicalColor(game.winner) || game.winner;
      const player = playerForColor(game, game.winner) || winner;
      return `Connect 4 over. ${winner.toUpperCase()} wins${player ? ` (${player})` : ''}.`;
    }
    if (game.draw) return 'Connect 4 over. Draw.';
    const turn = canonicalColor(game.turn) || game.turn || 'red';
    const player = playerForColor(game, game.turn) || 'unclaimed';
    return `${turn.toUpperCase()} to drop${player !== 'unclaimed' ? ` (${player})` : ''}. Say bot drop 1-7.`;
  }

  async writeBoardJpeg(channelKey) {
    fs.mkdirSync(this.boardDir, { recursive: true });
    const key = normalizeChannelKey(channelKey);
    const game = this.gameFor(key);
    if (!game) throw new Error('No Connect 4 game in this channel');
    const filename = `${safeFilePart(key)}-${Date.now()}.jpg`;
    const localPath = path.join(this.boardDir, filename);
    const width = 920;
    const height = 820;
    const frameX = 108;
    const frameY = 118;
    const cell = 88;
    const gap = 8;
    const boardW = COLS * cell + (COLS - 1) * gap;
    const boardH = ROWS * cell + (ROWS - 1) * gap;
    const winSet = new Set((game.winningCells || []).map(([r, c]) => `${r},${c}`));
    const turnPiece = canonicalColor(game.turn) || game.turn || 'red';
    const turnLabel = game.winner
      ? `${(canonicalColor(game.winner) || game.winner).toUpperCase()} WINS`
      : game.draw
        ? 'DRAW'
        : `${turnPiece.toUpperCase()} TURN`;
    const turnDot = turnPiece === 'red' ? '#ef4444' : '#facc15';

    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      '<defs>',
      '<linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">',
      '<stop offset="0%" stop-color="#0b1730"/>',
      '<stop offset="55%" stop-color="#132a52"/>',
      '<stop offset="100%" stop-color="#081224"/>',
      '</linearGradient>',
      '<linearGradient id="frameBody" x1="0%" y1="0%" x2="0%" y2="100%">',
      '<stop offset="0%" stop-color="#2f7be8"/>',
      '<stop offset="48%" stop-color="#1d5fbf"/>',
      '<stop offset="100%" stop-color="#123f86"/>',
      '</linearGradient>',
      '<linearGradient id="playSurface" x1="0%" y1="0%" x2="0%" y2="100%">',
      '<stop offset="0%" stop-color="#1a56b7"/>',
      '<stop offset="100%" stop-color="#0f3f8d"/>',
      '</linearGradient>',
      '<linearGradient id="trayGrad" x1="0%" y1="0%" x2="0%" y2="100%">',
      '<stop offset="0%" stop-color="#2a6fd0"/>',
      '<stop offset="100%" stop-color="#164f9f"/>',
      '</linearGradient>',
      '<linearGradient id="legGrad" x1="0%" y1="0%" x2="0%" y2="100%">',
      '<stop offset="0%" stop-color="#0d3f84"/>',
      '<stop offset="100%" stop-color="#082a5a"/>',
      '</linearGradient>',
      '<radialGradient id="holeGrad" cx="50%" cy="42%" r="58%">',
      '<stop offset="0%" stop-color="#07152d"/>',
      '<stop offset="72%" stop-color="#030a16"/>',
      '<stop offset="100%" stop-color="#01050d"/>',
      '</radialGradient>',
      '<radialGradient id="redDisc" cx="34%" cy="28%" r="72%">',
      '<stop offset="0%" stop-color="#ff7b7b"/>',
      '<stop offset="42%" stop-color="#ef4444"/>',
      '<stop offset="100%" stop-color="#991b1b"/>',
      '</radialGradient>',
      '<radialGradient id="yellowDisc" cx="34%" cy="28%" r="72%">',
      '<stop offset="0%" stop-color="#fff59d"/>',
      '<stop offset="42%" stop-color="#facc15"/>',
      '<stop offset="100%" stop-color="#ca8a04"/>',
      '</radialGradient>',
      '<filter id="frameShadow" x="-20%" y="-20%" width="140%" height="140%">',
      '<feDropShadow dx="0" dy="16" stdDeviation="14" flood-color="#000" flood-opacity="0.45"/>',
      '</filter>',
      '<filter id="discShadow" x="-40%" y="-40%" width="180%" height="180%">',
      '<feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#000" flood-opacity="0.35"/>',
      '</filter>',
      '</defs>',
      '<rect width="100%" height="100%" fill="url(#bgGrad)"/>',
      '<ellipse cx="460" cy="760" rx="300" ry="34" fill="#000" opacity="0.28"/>',
      ...boardFrameParts(frameX, frameY, boardW, boardH),
    ];

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cx = frameX + col * (cell + gap) + cell / 2;
        const cy = frameY + row * (cell + gap) + cell / 2;
        parts.push(`<circle cx="${cx}" cy="${cy}" r="37" fill="url(#holeGrad)" stroke="#08244d" stroke-width="2"/>`);
        parts.push(`<circle cx="${cx}" cy="${cy}" r="35" fill="none" stroke="#000" stroke-width="1.2" opacity="0.22"/>`);
      }
    }

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cx = frameX + col * (cell + gap) + cell / 2;
        const cy = frameY + row * (cell + gap) + cell / 2;
        const token = game.board[row][col];
        if (!token) continue;
        const isWin = winSet.has(`${row},${col}`);
        parts.push(...classicDiscParts(cx, cy, token, isWin));
      }
    }

    const trayY = frameY + boardH + 30;
    for (let col = 0; col < COLS; col++) {
      const text = String(col + 1);
      const cx = frameX + col * (cell + gap) + cell / 2;
      parts.push(`<circle cx="${cx}" cy="${trayY + 16}" r="22" fill="#0b2f6b" stroke="#7dd3fc" stroke-width="2.5"/>`);
      parts.push(`<circle cx="${cx}" cy="${trayY + 16}" r="18" fill="#164f9f" opacity="0.85"/>`);
      const textW = text.length * 4 * 4;
      parts.push(blockTextSvg(text, cx - textW / 2, trayY + 8, 4, '#f8fafc', 1));
    }

    parts.push(`<rect x="250" y="34" width="420" height="54" rx="16" fill="#041225" opacity="0.78" stroke="#1d4ed8" stroke-width="2"/>`);
    parts.push(blockTextSvg('CONNECT 4', 318, 46, 4, '#dbeafe', 1));
    parts.push(`<rect x="612" y="44" width="34" height="34" rx="17" fill="${turnDot}" stroke="#fff" stroke-width="2.5"/>`);
    parts.push(blockTextSvg(turnLabel, 652, 50, turnLabel.length > 10 ? 3 : 4, '#fef9c3', 1));
    parts.push('</svg>');

    const buffer = await sharp(Buffer.from(parts.join('')))
      .jpeg({ quality: 94, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer();
    const thumbnailBuffer = await sharp(buffer)
      .resize(720, 720, { fit: 'inside' })
      .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer();
    fs.writeFileSync(localPath, buffer);
    return {
      localPath,
      filename,
      url: `/connect4-boards/${encodeURIComponent(filename)}`,
      buffer,
      thumbnailBuffer,
      width,
      height,
    };
  }
}
