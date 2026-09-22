/**
 * Games + YouTube for AI-Seller-Bot-Desktop-v2 (ESM).
 * Loaded via dynamic import from CommonJS voice-bot-service.
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { ChessGameStore, parseChessMove } from './chess-game-store.js';
import {
  HangmanGameStore,
  parseHangmanGuess,
  parseHangmanSolve
} from './hangman-game-store.js';
import { BlackjackGameStore } from './blackjack-game-store.js';
import {
  Connect4GameStore,
  parseConnect4Move
} from './connect4-game-store.js';
import {
  YouTubeMusicService,
  isYouTubeMusicReady
} from './youtube-music.js';

export { isYouTubeMusicReady };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..', '..', '..');
const DATA_DIR = path.join(
  process.env.APPDATA || path.join(APP_ROOT, 'data'),
  'ai-seller-bot-desktop-v2',
  'channel-games'
);

function parseBetAmount(text) {
  const m = String(text || '').match(
    /\b(?:bet|stake)\s*(\d{1,4})\b|\b(\d{1,4})\s*(?:chips?|points?)\b/i
  );
  if (!m) return null;
  const n = Number(m[1] || m[2]);
  return Number.isFinite(n) && n > 0 ? Math.min(500, n) : null;
}

export function formatFullCommandsList() {
  return [
    'Commands — say bot … OR a bot name (Sugar play, Dave show, Frank picture …):',
    'Chat — ask anything · bot stop / Sugar stop',
    'Time — bot what time is it · Sugar what time is it',
    'Weather — bot weather Manchester · Dave weather London',
    'Picture — bot show / picture / draw + words · Sugar show us a cat · Frank picture pizza',
    'Photos — channel photos get described',
    'Chess — bot start chess · Sugar move e2 e4 · bot chess resign',
    'Hangman — bot start hangman · Dave guess e · bot solve WORD',
    'Blackjack — bot start blackjack · bot hit · bot stick',
    'Connect 4 — bot start connect 4 · bot drop 4',
    'Music — bot play SONG · Sugar play SONG · bot stop (max 5 min; key-up stops)',
    'Help — bot commands · Sugar commands'
  ].join('\n');
}

export function parseChessCommand(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const mentionsChess = /\b(?:chess|chest)\b/i.test(raw);
  const body = raw
    .replace(/\b(?:chess|chest)\b/gi, ' ')
    .replace(/\b(?:please|bot)\b/gi, ' ')
    .trim();
  if (!body && mentionsChess) return { action: 'resume' };
  if (mentionsChess && /\b(?:help|commands?)\b/i.test(body))
    return { action: 'help' };
  if (
    (mentionsChess || /\bgame\b/i.test(body)) &&
    /\b(?:start|new|reset|restart)\b/i.test(body)
  )
    return { action: 'start' };
  if (
    (mentionsChess || /\bgame\b/i.test(body)) &&
    /\b(?:reload|resume|restore|continue)\b/i.test(body)
  )
    return { action: 'resume' };
  if (mentionsChess && /\b(?:board|show|display|image)\b/i.test(body))
    return { action: 'board' };
  if (mentionsChess && /\b(?:status|turn|history|moves)\b/i.test(body))
    return { action: 'status' };
  if (mentionsChess && /\b(?:resign|quit|forfeit)\b/i.test(body))
    return { action: 'resign' };
  const moveText = body.replace(/\bmove\b/i, '').trim();
  const move = parseChessMove(moveText);
  if (move) return { action: 'move', ...move };
  if (/^move\b/i.test(body)) return { action: 'help' };
  if (!mentionsChess) return null;
  return { action: 'help' };
}

export function parseHangmanCommand(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const mentionsHangman =
    /\b(?:hangman|hang\s*man|hanging\s+man)\b/i.test(raw);
  const body = raw
    .replace(/\b(?:hangman|hang\s*man|hanging\s+man)\b/gi, ' ')
    .replace(/\b(?:please|bot)\b/gi, ' ')
    .trim();
  if (!body && mentionsHangman) return { action: 'status' };
  if (mentionsHangman && /\b(?:help|commands?)\b/i.test(body))
    return { action: 'help' };
  if (
    (mentionsHangman || /\bgame\b/i.test(body)) &&
    /\b(?:start|new|reset|restart)\b/i.test(body)
  )
    return { action: 'start' };
  if (mentionsHangman && /\b(?:score|scores)\b/i.test(body))
    return { action: 'scores' };
  if (
    (mentionsHangman || /\bgame\b/i.test(body)) &&
    /\b(?:resume|status|board|show)\b/i.test(body)
  )
    return { action: 'status' };
  if (mentionsHangman && /\b(?:stop|quit|end|cancel)\b/i.test(body))
    return { action: 'stop' };
  const solveMatch = body.match(
    /\b(?:solve|answer|word)\s+([a-zA-Z][a-zA-Z\s-]*)$/i
  );
  if (solveMatch) {
    const answer = parseHangmanSolve(solveMatch[1]);
    if (answer) return { action: 'solve', answer };
  }
  const guessBody = body.replace(/\b(?:guess|letter|try)\b/gi, ' ').trim();
  const letter = parseHangmanGuess(guessBody);
  if (
    letter &&
    (/^(?:guess|letter|try)\b/i.test(body) ||
      (mentionsHangman && /^[a-zA-Z]$/.test(guessBody)))
  ) {
    return { action: 'guess', letter };
  }
  if (!mentionsHangman) return null;
  return { action: 'help' };
}

export function parseBlackjackCommand(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const mentionsBlackjack =
    /\b(?:blackjack|black\s*jack|21|twenty\s*one)\b/i.test(raw);
  const body = raw
    .replace(/\b(?:blackjack|black\s*jack|twenty\s*one)\b/gi, ' ')
    .replace(/\b21\b/gi, ' ')
    .replace(/\b(?:please|bot)\b/gi, ' ')
    .trim();
  if (!body && mentionsBlackjack) return { action: 'board' };
  if (mentionsBlackjack && /\b(?:help|commands?)\b/i.test(body))
    return { action: 'help' };
  if (
    (mentionsBlackjack || /\bgame|hand\b/i.test(body)) &&
    /\b(?:start|new|deal|reset|restart)\b/i.test(body)
  ) {
    return { action: 'start', bet: parseBetAmount(raw) || 10 };
  }
  if (mentionsBlackjack && /\b(?:score|scores)\b/i.test(body))
    return { action: 'scores' };
  if (
    (mentionsBlackjack || /\bme\b/i.test(body)) &&
    /\b(?:hit|card|twist)\b/i.test(body)
  )
    return { action: 'hit' };
  if (/\b(?:hit\s+me|twist)\b/i.test(raw)) return { action: 'hit' };
  if (/\b(?:stick|stand|hold|stay)\b/i.test(body || raw))
    return { action: 'stand' };
  if (
    (mentionsBlackjack || /\bhand\b/i.test(body)) &&
    /\b(?:board|show|status)\b/i.test(body)
  )
    return { action: 'board' };
  if (mentionsBlackjack && /\b(?:stop|quit|end|cancel)\b/i.test(body))
    return { action: 'stop' };
  if (!mentionsBlackjack) return null;
  return { action: 'help' };
}

export function parseConnect4Command(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const mentionsConnect =
    /\b(?:connect\s*(?:4|four)|four\s*in\s*a\s*row)\b/i.test(raw);
  const body = raw
    .replace(/\b(?:connect\s*(?:4|four)|four\s*in\s*a\s*row)\b/gi, ' ')
    .replace(/\b(?:please|bot)\b/gi, ' ')
    .trim();
  if (!body && mentionsConnect) return { action: 'board' };
  if (mentionsConnect && /\b(?:help|commands?)\b/i.test(body))
    return { action: 'help' };
  if (
    (mentionsConnect || /\bgame\b/i.test(body)) &&
    /\b(?:start|new|reset|restart)\b/i.test(body)
  ) {
    return { action: 'start', bet: parseBetAmount(raw) };
  }
  if (mentionsConnect && /\b(?:score|scores)\b/i.test(body))
    return { action: 'scores' };
  if (mentionsConnect && /\b(?:board|show|status)\b/i.test(body))
    return { action: 'board' };
  if (mentionsConnect && /\b(?:stop|quit|end|cancel)\b/i.test(body))
    return { action: 'stop' };
  const drop = body.match(/\b(?:drop|column|col|play)\s*(\d)\b/i);
  if (drop) return { action: 'drop', column: Number(drop[1]) };
  const move = parseConnect4Move(body);
  if (move) return { action: 'drop', column: move.column };
  if (mentionsConnect && /^\d$/.test(body))
    return { action: 'drop', column: Number(body) };
  if (!mentionsConnect) return null;
  return { action: 'help' };
}

export function parseYouTubeCommand(text) {
  let raw = String(text || '').trim();
  if (!raw) return null;

  // STT often inserts commas: "play, drum and bass"
  raw = raw.replace(/^play\s*[,:;!-]+\s*/i, 'play ');

  // "stop" / "stop music" handled by voice-bot stop — keep music stop phrases here too
  if (
    /^(?:stop|cancel)(?:\s+(?:music|song|youtube|yt|playing|playback|audio))?\.?!?$/i.test(
      raw
    )
  ) {
    return { action: 'stop' };
  }

  // Primary: play <song name>  (optional "youtube" / "song" / "me")
  const playMatch =
    raw.match(
      /^\s*play(?:\s+(?:from\s+)?(?:youtube|yt))?(?:\s+song)?(?:\s+me)?[,:!]?\s+(.+)$/i
    ) ||
    raw.match(/\b(?:youtube|yt)\s+play[,:!]?\s+(.+)$/i) ||
    raw.match(/^\s*play[,:!]+\s*(.+)$/i);
  if (playMatch?.[1]?.trim()) {
    const query = playMatch[1]
      .replace(/^[,:!\s]+/, '')
      .replace(/\s+(?:from|on)\s+(?:youtube|yt)\s*$/i, '')
      .trim();
    if (
      query &&
      !/\b(?:chess|hangman|blackjack|connect)\b/i.test(query)
    ) {
      return { action: 'play', query };
    }
  }

  // Optional search still works if they say "search youtube …"
  if (/\b(?:search|find)\s+(?:youtube|yt)\b/i.test(raw)) {
    const searchMatch = raw.match(
      /\b(?:search|find)\s+(?:youtube|yt)\s+(?:for\s+)?(.+)$/i
    );
    return {
      action: 'search',
      query: (searchMatch?.[1] || '').trim() || 'music'
    };
  }

  return null;
}

let stores = null;

export function getStores() {
  if (stores) return stores;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  stores = {
    chess: new ChessGameStore(path.join(DATA_DIR, 'chess.json')),
    hangman: new HangmanGameStore(path.join(DATA_DIR, 'hangman.json')),
    blackjack: new BlackjackGameStore(path.join(DATA_DIR, 'blackjack.json')),
    connect4: new Connect4GameStore(path.join(DATA_DIR, 'connect4.json')),
    youtube: new YouTubeMusicService({
      cacheDir: path.join(DATA_DIR, 'youtube-cache'),
      env: process.env
    })
  };
  return stores;
}

/**
 * @returns {Promise<{ handled: boolean, text?: string, image?: object, wavPath?: string, speak?: string }|null>}
 */
export async function handleExtrasCommand({
  text,
  from,
  channelKey
} = {}) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const key = String(channelKey || 'default').toLowerCase();
  const who = String(from || 'player');
  const s = getStores();

  // Chess
  const chessCmd = parseChessCommand(raw);
  if (chessCmd) {
    try {
      let out = '';
      let image = null;
      if (chessCmd.action === 'help') {
        out =
          'Chess: start chess · move e2 e4 · chess (board) · chess status · chess resign';
      } else if (chessCmd.action === 'start') {
        s.chess.start(key, who);
        image = await s.chess.writeBoardJpeg(key, { title: 'New Chess Game' });
        out = `Chess started. ${who} is White. ${s.chess.turnSummary(key)}`;
      } else if (
        chessCmd.action === 'board' ||
        chessCmd.action === 'resume' ||
        chessCmd.action === 'image'
      ) {
        if (!s.chess.gameFor(key)) {
          out = 'No chess game. Say start chess.';
        } else {
          image = await s.chess.writeBoardJpeg(key, {
            title: 'Chess board'
          });
          out = `Chess board. ${s.chess.turnSummary(key)}`;
        }
      } else if (chessCmd.action === 'status') {
        out = s.chess.gameFor(key)
          ? s.chess.turnSummary(key)
          : 'No chess game. Say start chess.';
      } else if (chessCmd.action === 'resign') {
        const g = s.chess.resign(key, who);
        out = g ? `${who} resigned.` : 'No active chess game.';
      } else if (chessCmd.action === 'move') {
        const result = s.chess.move(
          key,
          chessCmd.from,
          chessCmd.to,
          who,
          chessCmd.promotion || 'q'
        );
        image = await s.chess.writeBoardJpeg(key, {
          title: `Move ${result.move.san}`
        });
        out = `Move ${result.move.san} by ${who}. ${s.chess.turnSummary(key)}`;
      }
      return { handled: true, text: out, image, speak: out };
    } catch (err) {
      return {
        handled: true,
        text: `Chess error: ${err.message}`,
        speak: `Chess error: ${err.message}`
      };
    }
  }

  // Hangman
  const hangCmd = parseHangmanCommand(raw);
  if (hangCmd) {
    try {
      let out = '';
      if (hangCmd.action === 'help') {
        out =
          'Hangman: start hangman · guess e · solve WORD · hangman · hangman stop';
      } else if (hangCmd.action === 'start') {
        s.hangman.start(key, who);
        out = s.hangman.render(key);
      } else if (hangCmd.action === 'status') {
        out = s.hangman.render(key);
      } else if (hangCmd.action === 'scores') {
        out = s.hangman.render(key);
      } else if (hangCmd.action === 'stop') {
        s.hangman.stop(key, who);
        out = s.hangman.render(key) || 'Hangman stopped.';
      } else if (hangCmd.action === 'guess') {
        s.hangman.guess(key, hangCmd.letter, who);
        out = s.hangman.render(key);
      } else if (hangCmd.action === 'solve') {
        s.hangman.solve(key, hangCmd.answer, who);
        out = s.hangman.render(key);
      }
      return { handled: true, text: String(out), speak: String(out) };
    } catch (err) {
      return {
        handled: true,
        text: `Hangman error: ${err.message}`,
        speak: `Hangman error: ${err.message}`
      };
    }
  }

  // Blackjack
  const bjCmd = parseBlackjackCommand(raw);
  if (bjCmd) {
    try {
      let out = '';
      let image = null;
      if (bjCmd.action === 'help') {
        out =
          'Blackjack: start blackjack · hit · stick · blackjack board · blackjack stop';
      } else if (bjCmd.action === 'start') {
        s.blackjack.start(key, who);
        out = s.blackjack.summary(key);
        try {
          image = await s.blackjack.writeBoardJpeg(key);
        } catch {
          /* text ok */
        }
      } else if (bjCmd.action === 'hit') {
        s.blackjack.hit(key, who);
        out = s.blackjack.summary(key);
        try {
          image = await s.blackjack.writeBoardJpeg(key);
        } catch {
          /* */
        }
      } else if (bjCmd.action === 'stand') {
        s.blackjack.stand(key, who);
        out = s.blackjack.summary(key);
        try {
          image = await s.blackjack.writeBoardJpeg(key);
        } catch {
          /* */
        }
      } else if (bjCmd.action === 'board') {
        out = s.blackjack.summary(key);
        image = await s.blackjack.writeBoardJpeg(key);
      } else if (bjCmd.action === 'scores') {
        out = s.blackjack.summary(key);
      } else if (bjCmd.action === 'stop') {
        s.blackjack.stop(key, who);
        out = s.blackjack.summary(key) || 'Blackjack stopped.';
      }
      return { handled: true, text: String(out), image, speak: String(out) };
    } catch (err) {
      return {
        handled: true,
        text: `Blackjack error: ${err.message}`,
        speak: `Blackjack error: ${err.message}`
      };
    }
  }

  // Connect 4
  const c4Cmd = parseConnect4Command(raw);
  if (c4Cmd) {
    try {
      let out = '';
      let image = null;
      if (c4Cmd.action === 'help') {
        out =
          'Connect 4: start connect 4 · drop 4 · connect 4 board · connect 4 stop';
      } else if (c4Cmd.action === 'start') {
        s.connect4.start(key, who);
        out = s.connect4.summary(key);
        try {
          image = await s.connect4.writeBoardJpeg(key);
        } catch {
          /* */
        }
      } else if (c4Cmd.action === 'drop') {
        s.connect4.drop(key, c4Cmd.column, who);
        out = s.connect4.summary(key);
        try {
          image = await s.connect4.writeBoardJpeg(key);
        } catch {
          /* */
        }
      } else if (c4Cmd.action === 'board') {
        out = s.connect4.summary(key);
        image = await s.connect4.writeBoardJpeg(key);
      } else if (c4Cmd.action === 'scores') {
        out = s.connect4.summary(key);
      } else if (c4Cmd.action === 'stop') {
        s.connect4.stop(key, who);
        out = s.connect4.summary(key) || 'Connect 4 stopped.';
      }
      return { handled: true, text: String(out), image, speak: String(out) };
    } catch (err) {
      return {
        handled: true,
        text: `Connect 4 error: ${err.message}`,
        speak: `Connect 4 error: ${err.message}`
      };
    }
  }

  // YouTube
  const ytCmd = parseYouTubeCommand(raw);
  if (ytCmd) {
    if (ytCmd.action === 'stop') {
      return { handled: true, text: 'Stopped.' };
    }
    if (!isYouTubeMusicReady(process.env)) {
      return {
        handled: true,
        text:
          'YouTube needs yt-dlp. Run: pip install yt-dlp  (and have ffmpeg on PATH).',
        speak: 'YouTube is not set up. Install yt-dlp first.'
      };
    }
    if (ytCmd.action === 'search') {
      try {
        const results = await s.youtube.search(ytCmd.query);
        const out =
          typeof s.youtube.formatSearchList === 'function'
            ? s.youtube.formatSearchList(results)
            : results
                .slice(0, 8)
                .map((r, i) => `${i + 1}. ${r.title}`)
                .join('\n') || 'No results.';
        return { handled: true, text: out, speak: `Found ${results.length || 0} YouTube results.` };
      } catch (err) {
        return {
          handled: true,
          text: `YouTube search failed: ${err.message}`,
          speak: 'YouTube search failed.'
        };
      }
    }
    if (ytCmd.action === 'play') {
      try {
        const track = await s.youtube.prepareQuery(ytCmd.query);
        let thumb = null;
        try {
          thumb = await s.youtube.prepareThumbnail?.(track.id);
        } catch {
          /* optional */
        }
        return {
          handled: true,
          // Short channel text only — no spoken intro; audio is the song
          text: `Playing: ${track.title}`,
          wavPath: track.wavPath,
          image: thumb
            ? {
                buffer: thumb.imageBuffer,
                thumbnailBuffer: thumb.thumbnailBuffer,
                width: thumb.width,
                height: thumb.height
              }
            : null
        };
      } catch (err) {
        return {
          handled: true,
          text: `Play failed: ${err.message}`
        };
      }
    }
  }

  return null;
}
