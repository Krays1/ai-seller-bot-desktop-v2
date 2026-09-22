import fs from 'fs';
import path from 'path';

const HANGMAN_TITLE = '🅷🅰🅽🅶🅼🅰🅽';
const HANGMAN_MARKER = '𓍯🪑';
const HANGMAN_HEAD = '🧕🏿';
const HANGMAN_BODY = '👙';
const HANGMAN_LEFT_ARM = '🫲🏿';
const HANGMAN_RIGHT_ARM = '🫱🏿';
const HANGMAN_LEGS = '👃🏿👃🏿';
const HANGMAN_TOP = '  +---------+';
const HANGMAN_ROPE = '  |---------|';
const HANGMAN_EMPTY = '  |';
const HANGMAN_HEAD_LINE = `  |---------${HANGMAN_HEAD}`;
const HANGMAN_BODY_LINE = `  |---------${HANGMAN_BODY}`;
const HANGMAN_LEFT_ARM_LINE = `  |-----${HANGMAN_LEFT_ARM}${HANGMAN_BODY}`;
const HANGMAN_BOTH_ARMS_LINE = `  |-----${HANGMAN_LEFT_ARM}${HANGMAN_BODY}${HANGMAN_RIGHT_ARM}`;
const HANGMAN_ONE_FOOT_LINE = '  |---------👃🏿';
const HANGMAN_FEET_LINE = `  |-------${HANGMAN_LEGS}`;
const HANGMAN_BASE = '===============';

const HANGMAN_PICS = [
  [
    HANGMAN_TOP,
    HANGMAN_ROPE,
    HANGMAN_EMPTY,
    HANGMAN_EMPTY,
    HANGMAN_EMPTY,
    HANGMAN_EMPTY,
    HANGMAN_BASE,
  ],
  [
    HANGMAN_TOP,
    HANGMAN_ROPE,
    HANGMAN_HEAD_LINE,
    HANGMAN_EMPTY,
    HANGMAN_EMPTY,
    HANGMAN_EMPTY,
    HANGMAN_BASE,
  ],
  [
    HANGMAN_TOP,
    HANGMAN_ROPE,
    HANGMAN_HEAD_LINE,
    HANGMAN_BODY_LINE,
    HANGMAN_EMPTY,
    HANGMAN_EMPTY,
    HANGMAN_BASE,
  ],
  [
    HANGMAN_TOP,
    HANGMAN_ROPE,
    HANGMAN_HEAD_LINE,
    HANGMAN_LEFT_ARM_LINE,
    HANGMAN_EMPTY,
    HANGMAN_EMPTY,
    HANGMAN_BASE,
  ],
  [
    HANGMAN_TOP,
    HANGMAN_ROPE,
    HANGMAN_HEAD_LINE,
    HANGMAN_BOTH_ARMS_LINE,
    HANGMAN_EMPTY,
    HANGMAN_EMPTY,
    HANGMAN_BASE,
  ],
  [
    HANGMAN_TOP,
    HANGMAN_ROPE,
    HANGMAN_HEAD_LINE,
    HANGMAN_BOTH_ARMS_LINE,
    HANGMAN_ONE_FOOT_LINE,
    HANGMAN_EMPTY,
    HANGMAN_BASE,
  ],
  [
    HANGMAN_TOP,
    HANGMAN_ROPE,
    HANGMAN_HEAD_LINE,
    HANGMAN_BOTH_ARMS_LINE,
    HANGMAN_FEET_LINE,
    HANGMAN_EMPTY,
    HANGMAN_BASE,
  ],
];

const WORDS = (
  'ant baboon badger bat bear beaver camel cat clam cobra cougar coyote crow deer dog donkey duck eagle ferret fox frog goat goose hawk lion lizard llama mole monkey moose mouse mule newt otter owl panda parrot pigeon python rabbit ram rat raven rhino salmon seal shark sheep skunk sloth snake spider stork swan tiger toad trout turkey turtle weasel whale wolf wombat zebra'
).split(/\s+/);

function normalizeChannelKey(channelKey) {
  return String(channelKey || '').trim().toLowerCase() || 'default';
}

function pickWord() {
  return WORDS[Math.floor(Math.random() * WORDS.length)] || 'zebra';
}

function cleanLetter(value) {
  const match = String(value || '').toLowerCase().match(/[a-z]/);
  return match ? match[0] : '';
}

function cleanSolve(value) {
  return String(value || '').toLowerCase().replace(/[^a-z]/g, '');
}

function emptyGame(channelKey, starter = '', word = pickWord()) {
  const now = new Date().toISOString();
  return {
    channelKey,
    word,
    startedAt: now,
    updatedAt: now,
    starter: starter || null,
    active: true,
    guesses: [],
    wrong: [],
    moves: [],
    winner: null,
    lost: false,
  };
}

export class HangmanGameStore {
  constructor(dataFile) {
    this.dataFile = path.resolve(dataFile);
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

  resume(channelKey) {
    return this.gameFor(channelKey);
  }

  guess(channelKey, letterInput, by = '') {
    const key = normalizeChannelKey(channelKey);
    const game = this.games[key] || this.start(key, by);
    if (!game.active) throw new Error('Hangman game is over. Say bot start hangman for a new one.');
    const letter = cleanLetter(letterInput);
    if (!letter) throw new Error('Guess one letter, like bot guess e.');
    if (game.guesses.includes(letter)) throw new Error(`Letter ${letter.toUpperCase()} was already guessed.`);

    game.guesses.push(letter);
    const hit = game.word.includes(letter);
    if (!hit) game.wrong.push(letter);
    game.updatedAt = new Date().toISOString();
    game.moves.push({ type: 'guess', guess: letter, hit, by: by || null, at: game.updatedAt });
    this._settle(game, by);
    this.save();
    return { game, hit, letter };
  }

  solve(channelKey, answerInput, by = '') {
    const key = normalizeChannelKey(channelKey);
    const game = this.games[key] || this.start(key, by);
    if (!game.active) throw new Error('Hangman game is over. Say bot start hangman for a new one.');
    const answer = cleanSolve(answerInput);
    if (!answer) throw new Error('Say the word after solve, like bot solve tiger.');
    const hit = answer === game.word;
    game.updatedAt = new Date().toISOString();
    game.moves.push({ type: 'solve', guess: answer, hit, by: by || null, at: game.updatedAt });
    if (hit) {
      game.active = false;
      game.winner = by || 'player';
      for (const letter of new Set(game.word.split(''))) {
        if (!game.guesses.includes(letter)) game.guesses.push(letter);
      }
    } else {
      game.wrong.push(`solve:${answer}`);
      this._settle(game, by);
    }
    this.save();
    return { game, hit, answer };
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

  _settle(game, by = '') {
    const won = game.word.split('').every((letter) => game.guesses.includes(letter));
    if (won) {
      game.active = false;
      game.winner = by || 'player';
      return;
    }
    if (game.wrong.length >= HANGMAN_PICS.length - 1) {
      game.active = false;
      game.lost = true;
    }
  }

  maskedWord(game) {
    return game.word
      .split('')
      .map((letter) => (game.guesses.includes(letter) ? letter.toUpperCase() : '_'))
      .join(' ');
  }

  render(channelKey) {
    const game = this.gameFor(channelKey);
    if (!game) return 'No Hangman game here. Say bot start hangman.';
    const wrongCount = Math.min(game.wrong.length, HANGMAN_PICS.length - 1);
    const pic = HANGMAN_PICS[wrongCount].join('\n');
    const wrongLetters = game.wrong
      .filter((g) => !String(g).startsWith('solve:'))
      .map((g) => String(g).toUpperCase())
      .join(', ') || 'none';
    const status = game.winner
      ? `Solved by ${game.winner}. Word: ${game.word.toUpperCase()}.`
      : game.lost
        ? `Game over. Word was ${game.word.toUpperCase()}.`
        : game.active
          ? `Guess a letter: bot guess e. Or solve: bot solve word.`
          : `Hangman stopped. Word was ${game.word.toUpperCase()}.`;
    return `${HANGMAN_TITLE} ${HANGMAN_MARKER}\n${pic}\nWord: ${this.maskedWord(game)}\nWrong: ${wrongLetters} (${wrongCount}/${HANGMAN_PICS.length - 1})\n${status}`;
  }
}

export function parseHangmanGuess(text) {
  return cleanLetter(text);
}

export function parseHangmanSolve(text) {
  return cleanSolve(text);
}
