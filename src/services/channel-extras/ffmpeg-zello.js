import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

/** 16 kHz mono PCM WAV — same format voice-transmit expects. No duration cap. */
export function resolveFfmpegExecutable(env = process.env) {
  const custom = (env.FFMPEG_PATH || '').trim();
  if (custom && fs.existsSync(custom)) return custom;

  const onPath = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (onPath.status === 0) return 'ffmpeg';

  const py = path.join(
    PROJECT_ROOT,
    'alltalk_tts-main',
    'alltalk_environment',
    'env',
    'python.exe'
  );
  if (fs.existsSync(py)) {
    const install = spawnSync(py, ['-m', 'pip', 'install', 'imageio-ffmpeg', '-q'], {
      encoding: 'utf8',
    });
    if (install.status === 0) {
      const probe = spawnSync(
        py,
        [
          '-c',
          'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())',
        ],
        { encoding: 'utf8' }
      );
      const exe = probe.stdout?.trim();
      if (probe.status === 0 && exe && fs.existsSync(exe)) return exe;
    }
  }

  throw new Error(
    'ffmpeg not found — install ffmpeg or run AllTalk setup (uses bundled ffmpeg)'
  );
}

export function convertAudioToZelloWav(srcPath, destPath, env = process.env) {
  if (!srcPath || !fs.existsSync(srcPath)) {
    throw new Error('Audio file not found');
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const ffmpeg = resolveFfmpegExecutable(env);
  const run = spawnSync(
    ffmpeg,
    [
      '-y',
      '-i',
      path.resolve(srcPath),
      '-ar',
      '16000',
      '-ac',
      '1',
      '-sample_fmt',
      's16',
      path.resolve(destPath),
    ],
    { encoding: 'utf8' }
  );
  if (run.status !== 0 || !fs.existsSync(destPath)) {
    throw new Error(
      run.stderr?.trim()?.split('\n').slice(-3).join(' ') ||
        'Failed to convert audio for Zello transmit'
    );
  }
  return destPath;
}

/** Convert saved voice WAV to MP3 (e.g. for Telegram daily zip exports). */
export function convertWavToMp3(srcPath, destPath, env = process.env) {
  if (!srcPath || !fs.existsSync(srcPath)) {
    throw new Error('WAV file not found');
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const ffmpeg = resolveFfmpegExecutable(env);
  const run = spawnSync(
    ffmpeg,
    [
      '-y',
      '-i',
      path.resolve(srcPath),
      '-codec:a',
      'libmp3lame',
      '-q:a',
      '4',
      path.resolve(destPath),
    ],
    { encoding: 'utf8' }
  );
  if (run.status !== 0 || !fs.existsSync(destPath)) {
    throw new Error(
      run.stderr?.trim()?.split('\n').slice(-3).join(' ') ||
        'Failed to convert WAV to MP3'
    );
  }
  return destPath;
}
