import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { Chess } from 'chess.js';

const FILE_WORDS = new Map([
  ['a', 'a'],
  ['ay', 'a'],
  ['b', 'b'],
  ['be', 'b'],
  ['bee', 'b'],
  ['c', 'c'],
  ['see', 'c'],
  ['sea', 'c'],
  ['d', 'd'],
  ['dee', 'd'],
  ['e', 'e'],
  ['f', 'f'],
  ['eff', 'f'],
  ['g', 'g'],
  ['gee', 'g'],
  ['h', 'h'],
  ['aitch', 'h'],
  ['hache', 'h'],
]);

const RANK_WORDS = new Map([
  ['1', '1'],
  ['one', '1'],
  ['won', '1'],
  ['2', '2'],
  ['two', '2'],
  ['too', '2'],
  ['to', '2'],
  ['3', '3'],
  ['three', '3'],
  ['free', '3'],
  ['4', '4'],
  ['four', '4'],
  ['for', '4'],
  ['5', '5'],
  ['five', '5'],
  ['6', '6'],
  ['six', '6'],
  ['7', '7'],
  ['seven', '7'],
  ['8', '8'],
  ['eight', '8'],
  ['ate', '8'],
]);

const PIECE_ICONS = {
  p: 'p',
  n: 'n',
  b: 'b',
  r: 'r',
  q: 'q',
  k: 'k',
  P: 'P',
  N: 'N',
  B: 'B',
  R: 'R',
  Q: 'Q',
  K: 'K',
};

const PIECE_UNICODE = {
  wp: '♙',
  wn: '♘',
  wb: '♗',
  wr: '♖',
  wq: '♕',
  wk: '♔',
  bp: '♟',
  bn: '♞',
  bb: '♝',
  br: '♜',
  bq: '♛',
  bk: '♚',
};

const LABEL_FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  6: ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
};

function svgLabel(char, x, y, scale = 4, fill = '#93a9bd') {
  const rows = LABEL_FONT[String(char).toUpperCase()];
  if (!rows) return '';
  const parts = [];
  for (let row = 0; row < rows.length; row++) {
    for (let col = 0; col < rows[row].length; col++) {
      if (rows[row][col] === '1') {
        parts.push(`<rect x="${x + col * scale}" y="${y + row * scale}" width="${scale}" height="${scale}" fill="${fill}"/>`);
      }
    }
  }
  return parts.join('');
}

function emptyGame(channelKey) {
  const chess = new Chess();
  return {
    channelKey,
    fen: chess.fen(),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    players: {},
    moves: [],
    active: true,
  };
}

function normalizeChannelKey(channelKey) {
  return String(channelKey || '').trim().toLowerCase() || 'default';
}

function safeFilePart(value) {
  return String(value || 'channel')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^\w().+-]+/g, '_')
    .slice(0, 80) || 'channel';
}

function squareFromParts(file, rank) {
  const f = FILE_WORDS.get(String(file || '').toLowerCase());
  const r = RANK_WORDS.get(String(rank || '').toLowerCase());
  return f && r ? `${f}${r}` : null;
}

export function parseChessMove(text) {
  const raw = String(text || '').toLowerCase();
  const compact = raw.replace(/[^a-h1-8qrbn]+/g, '');
  const compactMatch = compact.match(/([a-h][1-8])([a-h][1-8])([qrbn])?/);
  if (compactMatch) {
    return {
      from: compactMatch[1],
      to: compactMatch[2],
      promotion: compactMatch[3] || undefined,
    };
  }

  const cleaned = raw
    .replace(/\b(?:move|chess|from|square|please|bot)\b/g, ' ')
    .replace(/\b(?:to|too)\b/g, ' to ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  const squares = [];
  for (let i = 0; i < words.length; i++) {
    const glued = words[i].match(/^([a-h])([1-8])$/);
    if (glued) {
      squares.push(glued[0]);
      continue;
    }
    const sq = squareFromParts(words[i], words[i + 1]);
    if (sq) {
      squares.push(sq);
      i += 1;
    }
  }
  if (squares.length >= 2) {
    const promo = words.find((w) => ['queen', 'rook', 'bishop', 'knight', 'q', 'r', 'b', 'n'].includes(w));
    const promotion = promo
      ? ({ queen: 'q', rook: 'r', bishop: 'b', knight: 'n' }[promo] || promo)
      : undefined;
    return { from: squares[0], to: squares[1], promotion };
  }
  return null;
}

export class ChessGameStore {
  constructor(dataFile) {
    this.dataFile = path.resolve(dataFile);
    this.boardDir = path.join(path.dirname(this.dataFile), 'chess-boards');
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
    const game = emptyGame(key);
    if (starter) game.players.white = starter;
    this.games[key] = game;
    this.save();
    return game;
  }

  resign(channelKey, by = '') {
    const game = this.gameFor(channelKey);
    if (!game?.active) return null;
    game.active = false;
    game.resignedBy = by || null;
    game.updatedAt = new Date().toISOString();
    this.save();
    return game;
  }

  chess(game) {
    return new Chess(game?.fen || undefined);
  }

  move(channelKey, from, to, by = '', promotion = 'q') {
    const key = normalizeChannelKey(channelKey);
    const game = this.games[key] || this.start(key, by);
    if (!game.active) throw new Error('Chess game is over. Say chess start for a new one.');
    const chess = this.chess(game);
    const color = chess.turn() === 'w' ? 'white' : 'black';
    if (by && !game.players[color]) game.players[color] = by;
    const piece = chess.get(from);
    if (!piece) {
      throw new Error(`No piece on ${from} — the board may be out of date. Reopen the game.`);
    }
    if (piece.color !== chess.turn()) {
      throw new Error(`It is ${color}'s turn, but ${from} holds a ${piece.color === 'w' ? 'white' : 'black'} piece. Refresh the board.`);
    }
    let move = null;
    try {
      move = chess.move({ from, to, promotion: promotion || 'q' });
    } catch {
      move = null;
    }
    if (!move) throw new Error(`Illegal move ${from} to ${to}.`);
    game.fen = chess.fen();
    game.updatedAt = new Date().toISOString();
    game.moves.push({
      san: move.san,
      from,
      to,
      by: by || null,
      at: game.updatedAt,
    });
    if (chess.isGameOver()) game.active = false;
    this.save();
    return { game, move, chess };
  }

  /**
   * Build a move-by-move replay: the starting position followed by the board
   * state after every move. Frames are computed with chess.js so castling,
   * en-passant and promotions all resolve correctly.
   */
  replayFrames(channelKey) {
    const game = this.gameFor(channelKey);
    if (!game) return null;
    const chess = new Chess();
    const boardMatrix = () =>
      chess.board().map((row) =>
        row.map((piece) => (piece ? { color: piece.color, type: piece.type } : null))
      );
    const frames = [
      {
        index: 0,
        san: null,
        from: null,
        to: null,
        by: null,
        fen: chess.fen(),
        board: boardMatrix(),
        turn: chess.turn() === 'w' ? 'white' : 'black',
      },
    ];
    for (let i = 0; i < (game.moves || []).length; i++) {
      const m = game.moves[i];
      let applied = null;
      try {
        applied = m.san
          ? chess.move(m.san, { sloppy: true })
          : chess.move({ from: m.from, to: m.to, promotion: 'q' });
      } catch {
        applied = null;
      }
      if (!applied) {
        try {
          applied = chess.move({ from: m.from, to: m.to, promotion: 'q' });
        } catch {
          applied = null;
        }
      }
      if (!applied) break;
      frames.push({
        index: i + 1,
        san: applied.san,
        from: applied.from,
        to: applied.to,
        by: m.by || null,
        fen: chess.fen(),
        board: boardMatrix(),
        turn: chess.turn() === 'w' ? 'white' : 'black',
      });
    }
    return {
      id: game.channelKey,
      name: game.webName || game.channelKey.replace(/^web-/, ''),
      players: game.players || {},
      totalMoves: frames.length - 1,
      frames,
    };
  }

  render(channelKey) {
    const game = this.gameFor(channelKey);
    if (!game) return 'No chess game in this channel. Say bot chess start.';
    const chess = this.chess(game);
    const board = chess.board();
    const lines = ['  a b c d e f g h'];
    for (let row = 0; row < 8; row++) {
      const rank = 8 - row;
      const cells = board[row].map((piece) => {
        if (!piece) return '.';
        const symbol = piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
        return PIECE_ICONS[symbol] || symbol;
      });
      lines.push(`${rank} ${cells.join(' ')} ${rank}`);
    }
    lines.push('  a b c d e f g h');
    const turn = chess.turn() === 'w' ? 'White' : 'Black';
    const status = chess.isCheckmate()
      ? `Checkmate. ${turn} is mated.`
      : chess.isDraw()
        ? 'Draw.'
        : chess.isCheck()
          ? `${turn} to move, in check.`
          : `${turn} to move.`;
    const last = game.moves.at(-1)?.san;
    return `${lines.join('\n')}\n${status}${last ? ` Last move: ${last}.` : ''}`;
  }

  status(channelKey) {
    const game = this.gameFor(channelKey);
    if (!game) return 'No chess game in this channel. Say bot chess start.';
    const chess = this.chess(game);
    const moves = game.moves.length;
    const turn = chess.turn() === 'w' ? 'White' : 'Black';
    if (game.resignedBy) return `Chess game ended. ${game.resignedBy} resigned after ${moves} move(s).`;
    if (chess.isCheckmate()) return `Chess game over: checkmate after ${moves} move(s).`;
    if (chess.isDraw()) return `Chess game over: draw after ${moves} move(s).`;
    return `Chess game active. ${turn} to move. ${moves} move(s) played.`;
  }

  turnSummary(channelKey) {
    const game = this.gameFor(channelKey);
    if (!game) return 'No chess game in this channel.';
    const chess = this.chess(game);
    const white = game.players?.white || 'unclaimed';
    const black = game.players?.black || 'unclaimed';
    const moves = game.moves.length;
    if (game.resignedBy) {
      return `Game over. ${game.resignedBy} resigned. White: ${white}. Black: ${black}.`;
    }
    if (chess.isCheckmate()) {
      return `Checkmate after ${moves} move(s). White: ${white}. Black: ${black}.`;
    }
    if (chess.isDraw()) {
      return `Draw after ${moves} move(s). White: ${white}. Black: ${black}.`;
    }
    const turn = chess.turn() === 'w' ? 'White' : 'Black';
    const player = chess.turn() === 'w' ? white : black;
    const check = chess.isCheck() ? ' Check.' : '';
    return `${turn} to move${player !== 'unclaimed' ? ` (${player})` : ''}.${check} White: ${white}. Black: ${black}. Moves: ${moves}.`;
  }

  boardSvg(channelKey) {
    const game = this.gameFor(channelKey);
    if (!game) throw new Error('No chess game in this channel');
    const chess = this.chess(game);
    const board = chess.board();
    const blackPerspective = chess.turn() === 'b';
    const files = blackPerspective ? 'hgfedcba' : 'abcdefgh';
    const size = 720;
    const margin = 56;
    const square = 76;
    const boardSize = square * 8;
    const last = game.moves.at(-1) || null;
    const highlights = new Set([last?.from, last?.to].filter(Boolean));
    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
      '<defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity="0.35"/></filter></defs>',
      '<rect width="100%" height="100%" fill="#08111f"/>',
      `<rect x="${margin}" y="${margin}" width="${boardSize}" height="${boardSize}" rx="12" fill="#111827" filter="url(#shadow)"/>`,
    ];

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const file = files[col];
        const rank = String(blackPerspective ? row + 1 : 8 - row);
        const sq = `${file}${rank}`;
        const x = margin + col * square;
        const y = margin + row * square;
        const light = (row + col) % 2 === 0;
        const fill = highlights.has(sq)
          ? '#facc15'
          : light
            ? '#d8e6d0'
            : '#47734c';
        parts.push(`<rect x="${x}" y="${y}" width="${square}" height="${square}" fill="${fill}"/>`);
        const piece = board[8 - Number(rank)]?.['abcdefgh'.indexOf(file)];
        if (piece) {
          const icon = PIECE_UNICODE[`${piece.color}${piece.type}`] || piece.type;
          const color = piece.color === 'w' ? '#f8fafc' : '#111827';
          const stroke = piece.color === 'w' ? '#111827' : '#f8fafc';
          parts.push(
            `<text x="${x + square / 2}" y="${y + 55}" text-anchor="middle" fill="${color}" stroke="${stroke}" stroke-width="1" font-family="Segoe UI Symbol, Noto Sans Symbols, Arial, sans-serif" font-size="54">${icon}</text>`
          );
        }
      }
    }

    for (let i = 0; i < 8; i++) {
      const file = 'abcdefgh'[i];
      const rank = String(8 - i);
      parts.push(`<text x="${margin + i * square + square / 2}" y="${margin + boardSize + 28}" text-anchor="middle" fill="#93a9bd" font-family="Segoe UI, Arial, sans-serif" font-size="18">${file}</text>`);
      parts.push(`<text x="${margin + i * square + square / 2}" y="${margin - 16}" text-anchor="middle" fill="#93a9bd" font-family="Segoe UI, Arial, sans-serif" font-size="18">${file}</text>`);
      parts.push(`<text x="${margin - 24}" y="${margin + i * square + square / 2 + 6}" text-anchor="middle" fill="#93a9bd" font-family="Segoe UI, Arial, sans-serif" font-size="18">${rank}</text>`);
      parts.push(`<text x="${margin + boardSize + 24}" y="${margin + i * square + square / 2 + 6}" text-anchor="middle" fill="#93a9bd" font-family="Segoe UI, Arial, sans-serif" font-size="18">${rank}</text>`);
    }

    parts.push('</svg>');
    return parts.join('');
  }

  writeBoardImage(channelKey, options = {}) {
    fs.mkdirSync(this.boardDir, { recursive: true });
    const key = normalizeChannelKey(channelKey);
    const game = this.gameFor(key);
    if (!game) throw new Error('No chess game in this channel');
    const filename = `${safeFilePart(key)}-${Date.now()}.svg`;
    const localPath = path.join(this.boardDir, filename);
    fs.writeFileSync(localPath, this.boardSvg(key, options), 'utf8');
    return {
      localPath,
      filename,
      url: `/chess-boards/${encodeURIComponent(filename)}`,
    };
  }

  async writeBoardJpeg(channelKey, options = {}) {
    fs.mkdirSync(this.boardDir, { recursive: true });
    const key = normalizeChannelKey(channelKey);
    const game = this.gameFor(key);
    if (!game) throw new Error('No chess game in this channel');
    const filename = `${safeFilePart(key)}-${Date.now()}.jpg`;
    const localPath = path.join(this.boardDir, filename);

    const chess = this.chess(game);
    const board = chess.board();
    const blackPerspective = chess.turn() === 'b';
    const files = blackPerspective ? 'hgfedcba' : 'abcdefgh';
    const size = 720;
    const margin = 56;
    const square = 76;
    const boardSize = square * 8;
    const last = game.moves.at(-1) || null;
    const highlights = new Set([last?.from, last?.to].filter(Boolean));
    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
      '<defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity="0.35"/></filter></defs>',
      '<rect width="100%" height="100%" fill="#08111f"/>',
      `<rect x="${margin}" y="${margin}" width="${boardSize}" height="${boardSize}" rx="12" fill="#111827" filter="url(#shadow)"/>`,
    ];
    const composites = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const file = files[col];
        const rank = String(blackPerspective ? row + 1 : 8 - row);
        const sq = `${file}${rank}`;
        const x = margin + col * square;
        const y = margin + row * square;
        const light = (row + col) % 2 === 0;
        const fill = highlights.has(sq)
          ? '#facc15'
          : light
            ? '#d8e6d0'
            : '#47734c';
        parts.push(`<rect x="${x}" y="${y}" width="${square}" height="${square}" fill="${fill}"/>`);
        const piece = board[8 - Number(rank)]?.['abcdefgh'.indexOf(file)];
        if (piece) {
          const spriteName = `${piece.color}${piece.type}.png`;
          const spriteUrl = new URL(`./chess-piece-sprites/${spriteName}`, import.meta.url);
          composites.push({
            input: fs.readFileSync(spriteUrl),
            left: x,
            top: y,
          });
        }
      }
    }
    for (let i = 0; i < 8; i++) {
      const file = files[i].toUpperCase();
      const rank = String(blackPerspective ? i + 1 : 8 - i);
      const labelScale = 4;
      const fileX = margin + i * square + square / 2 - 10;
      const rankY = margin + i * square + square / 2 - 14;
      parts.push(svgLabel(file, fileX, margin + boardSize + 16, labelScale));
      parts.push(svgLabel(file, fileX, margin - 34, labelScale));
      parts.push(svgLabel(rank, margin - 36, rankY, labelScale));
      parts.push(svgLabel(rank, margin + boardSize + 16, rankY, labelScale));
    }
    parts.push('</svg>');
    const svg = Buffer.from(parts.join(''));
    const rendered = sharp(svg).composite(composites);
    const buffer = await rendered
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
      url: `/chess-boards/${encodeURIComponent(filename)}`,
      buffer,
      thumbnailBuffer,
      width: size,
      height: size,
    };
  }
}
