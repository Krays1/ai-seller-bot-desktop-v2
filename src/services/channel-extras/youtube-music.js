import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { convertAudioToZelloWav, resolveFfmpegExecutable } from './ffmpeg-zello.js';
import { parseWav } from './wav-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

function getYtDlpLauncher(env = process.env) {
  const custom = (env.YT_DLP_PATH || '').trim();
  if (custom && fs.existsSync(custom)) {
    return { command: custom, prefix: [] };
  }

  const onPath = spawnSync('yt-dlp', ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (onPath.status === 0) return { command: 'yt-dlp', prefix: [] };

  const py = (env.PYTHON_PATH || 'python').trim() || 'python';
  const mod = spawnSync(py, ['-m', 'yt_dlp', '--version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (mod.status === 0) return { command: py, prefix: ['-m', 'yt_dlp'] };

  throw new Error(
    'yt-dlp not found — run setup-youtube-music.bat or: pip install yt-dlp'
  );
}

/** @deprecated use getYtDlpLauncher */
export function resolveYtDlpExecutable(env = process.env) {
  const launcher = getYtDlpLauncher(env);
  return launcher.prefix.length
    ? `${launcher.command} ${launcher.prefix.join(' ')}`
    : launcher.command;
}

export function isYouTubeMusicReady(env = process.env) {
  try {
    getYtDlpLauncher(env);
    return true;
  } catch {
    return false;
  }
}

function runYtDlpSync(args, env = process.env) {
  const launcher = getYtDlpLauncher(env);
  const run = spawnSync(launcher.command, [...launcher.prefix, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    const err =
      run.stderr?.trim()?.split('\n').slice(-4).join(' ') ||
      run.stdout?.trim()?.split('\n').slice(-2).join(' ') ||
      'yt-dlp failed';
    throw new Error(err);
  }
  return run.stdout || '';
}

function runYtDlpAsync(args, env = process.env) {
  const launcher = getYtDlpLauncher(env);
  return new Promise((resolve, reject) => {
    const proc = spawn(launcher.command, [...launcher.prefix, ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    proc.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        reject(
          new Error(
            stderr.trim().split('\n').slice(-4).join(' ') ||
              stdout.trim().split('\n').slice(-2).join(' ') ||
              'yt-dlp failed'
          )
        );
      }
    });
  });
}

function trimWavMaxDuration(wavPath, maxSec, env = process.env) {
  if (!maxSec || maxSec <= 0 || !fs.existsSync(wavPath)) return;
  let durationSec = null;
  try {
    const info = parseWav(fs.readFileSync(wavPath));
    durationSec = info.dataLen / 2 / info.channels / info.sampleRate;
  } catch {
    return;
  }
  if (!durationSec || durationSec <= maxSec + 0.5) return;

  const tmp = `${wavPath}.trim.wav`;
  const ffmpeg = resolveFfmpegExecutable(env);
  const run = spawnSync(
    ffmpeg,
    ['-y', '-i', path.resolve(wavPath), '-t', String(maxSec), path.resolve(tmp)],
    { encoding: 'utf8', windowsHide: true }
  );
  if (run.status === 0 && fs.existsSync(tmp)) {
    fs.renameSync(tmp, wavPath);
  } else if (fs.existsSync(tmp)) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

export class YouTubeMusicService {
  constructor(options = {}) {
    this.cacheDir =
      options.cacheDir || path.join(PROJECT_ROOT, 'data', 'youtube-cache');
    this.env = options.env || process.env;
    this.maxDurationSec = Math.max(
      60,
      Math.min(
        900,
        parseInt(
          this.env.YOUTUBE_MAX_DURATION_SEC ||
            options.maxDurationSec ||
            '300',
          10
        ) || 300
      )
    );
    this.searchLimit = Math.max(
      1,
      Math.min(10, parseInt(this.env.YOUTUBE_SEARCH_LIMIT || '5', 10) || 5)
    );
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  getStatus() {
    let ready = false;
    let hint = '';
    try {
      getYtDlpLauncher(this.env);
      ready = true;
    } catch (err) {
      hint = err.message;
    }
    return {
      enabled: this.env.YOUTUBE_MUSIC_ENABLED !== 'false',
      ready,
      hint,
      cacheDir: this.cacheDir,
      maxDurationSec: this.maxDurationSec,
      searchLimit: this.searchLimit,
    };
  }

  /** Search YouTube via yt-dlp `ytsearchN:query`. */
  search(query, limit = this.searchLimit) {
    const q = String(query || '').trim();
    if (!q) return [];
    const n = Math.max(1, Math.min(10, limit));
    const out = runYtDlpSync(
      [
        '--flat-playlist',
        '--dump-single-json',
        '--no-warnings',
        '--no-playlist',
        `ytsearch${n}:${q}`,
      ],
      this.env
    );
    const parsed = JSON.parse(out);
    const entries = Array.isArray(parsed?.entries)
      ? parsed.entries
      : parsed?.id
        ? [parsed]
        : [];
    return entries
      .filter((e) => e?.id)
      .map((e) => ({
        id: e.id,
        title: e.title || 'Unknown',
        url: e.url || e.webpage_url || `https://www.youtube.com/watch?v=${e.id}`,
        durationSec: Number(e.duration) || null,
        channel: e.channel || e.uploader || '',
      }));
  }

  findBestMatch(query) {
    const results = this.search(query, this.searchLimit);
    if (!results.length) return null;
    const q = String(query || '').toLowerCase();
    let best = results[0];
    let bestScore = 0;
    for (const row of results) {
      const title = String(row.title || '').toLowerCase();
      let score = 0;
      if (title === q) score = 100;
      else if (title.includes(q)) score = 80;
      else if (q.split(/\s+/).every((w) => w.length > 2 && title.includes(w))) score = 70;
      else score = 50 - results.indexOf(row);
      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
    }
    return best;
  }

  formatSearchList(results, max = 5) {
    if (!results?.length) return 'No YouTube matches found.';
    const lines = results.slice(0, max).map((r, i) => {
      const dur = r.durationSec ? ` (${Math.round(r.durationSec)}s)` : '';
      return `${i + 1}. ${r.title}${dur}`;
    });
    return `YouTube matches:\n${lines.join('\n')}\nSay bot play or Sugar play then the song name.`;
  }

  async downloadAudio(videoId, url) {
    const id = String(videoId || '').trim();
    if (!id) throw new Error('Video id required');
    const watchUrl = url || `https://www.youtube.com/watch?v=${id}`;
    const base = path.join(this.cacheDir, id);
    const existing = [`${base}.m4a`, `${base}.webm`, `${base}.opus`, `${base}.mp3`].find((p) =>
      fs.existsSync(p)
    );
    if (existing) return existing;

    const outTemplate = `${base}.%(ext)s`;
    const launcher = getYtDlpLauncher(this.env);
    await new Promise((resolve, reject) => {
      const args = [
        '--no-warnings',
        '--no-playlist',
        '-f',
        'bestaudio/best',
        '-x',
        '--audio-format',
        'm4a',
        // Only pull what we will play (long mixes) — saves time/disk
        '--download-sections',
        `*0-${this.maxDurationSec}`,
        '--force-keyframes-at-cuts',
        '-o',
        outTemplate,
        watchUrl,
      ];
      const proc = spawn(launcher.command, [...launcher.prefix, ...args], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      proc.stderr?.on('data', (c) => {
        stderr += c;
      });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else {
          // Older yt-dlp may not support download-sections — retry full download
          if (/download-sections|Unsupported/i.test(stderr)) {
            const fallback = [
              '--no-warnings',
              '--no-playlist',
              '-f',
              'bestaudio/best',
              '-x',
              '--audio-format',
              'm4a',
              '-o',
              outTemplate,
              watchUrl,
            ];
            const p2 = spawn(launcher.command, [...launcher.prefix, ...fallback], {
              windowsHide: true,
              stdio: ['ignore', 'pipe', 'pipe'],
            });
            let err2 = '';
            p2.stderr?.on('data', (c) => {
              err2 += c;
            });
            p2.on('error', reject);
            p2.on('close', (code2) => {
              if (code2 === 0) resolve();
              else
                reject(
                  new Error(
                    err2.split('\n').slice(-4).join(' ') || 'Download failed'
                  )
                );
            });
            return;
          }
          reject(
            new Error(stderr.split('\n').slice(-4).join(' ') || 'Download failed')
          );
        }
      });
    });

    const downloaded = [`${base}.m4a`, `${base}.webm`, `${base}.opus`, `${base}.mp3`].find((p) =>
      fs.existsSync(p)
    );
    if (!downloaded) throw new Error('Download finished but audio file missing');
    return downloaded;
  }

  /**
   * Search YouTube, download audio, convert to 16 kHz mono WAV for Zello transmit.
   */
  async prepareQuery(query) {
    const match = this.findBestMatch(query);
    if (!match) {
      throw new Error(`No YouTube result for "${query}"`);
    }
    // Long mixes are OK — we trim the WAV to maxDurationSec (default 30 min).
    // Do not reject by metadata length.
    const audioPath = await this.downloadAudio(match.id, match.url);
    const wavPath = path.join(this.cacheDir, `${match.id}.zello.wav`);
    const audioMtime = fs.statSync(audioPath).mtimeMs;
    if (fs.existsSync(wavPath)) {
      const wavMtime = fs.statSync(wavPath).mtimeMs;
      if (wavMtime >= audioMtime) {
        trimWavMaxDuration(wavPath, this.maxDurationSec, this.env);
        return { ...match, wavPath, filename: `${match.id}.zello.wav`, source: 'youtube' };
      }
    }
    convertAudioToZelloWav(audioPath, wavPath, this.env);
    trimWavMaxDuration(wavPath, this.maxDurationSec, this.env);
    return { ...match, wavPath, filename: `${match.id}.zello.wav`, source: 'youtube' };
  }
}
