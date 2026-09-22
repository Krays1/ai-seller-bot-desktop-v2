import fs from 'fs';
import path from 'path';

export function parseWav(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('Not a valid WAV file');
  }

  let offset = 12;
  let sampleRate = 16000;
  let channels = 1;
  let bits = 16;
  let dataOffset = 0;
  let dataLen = 0;
  let fmtOffset = 0;
  let fmtSize = 0;

  while (offset < buffer.length - 8) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      fmtOffset = offset + 8;
      fmtSize = size;
      channels = buffer.readUInt16LE(offset + 10);
      sampleRate = buffer.readUInt32LE(offset + 12);
      bits = buffer.readUInt16LE(offset + 22);
    }
    if (id === 'data') {
      dataOffset = offset + 8;
      dataLen = size;
      break;
    }
    offset += 8 + size;
  }

  if (!dataOffset || bits !== 16) {
    throw new Error(`Unsupported WAV format (bits=${bits})`);
  }

  return {
    sampleRate,
    channels,
    bits,
    dataOffset,
    dataLen,
    fmtOffset,
    fmtSize,
    bytesPerSample: (bits / 8) * channels,
  };
}

export function trimWavFile(inputPath, outputPath, startMs, endMs) {
  const buf = fs.readFileSync(inputPath);
  const info = parseWav(buf);
  const { sampleRate, channels, bits, dataOffset, dataLen, fmtOffset, fmtSize } = info;
  const bytesPerFrame = (bits / 8) * channels;
  const totalFrames = Math.floor(dataLen / bytesPerFrame);
  const totalMs = (totalFrames / sampleRate) * 1000;

  const clampedStart = Math.max(0, Math.min(startMs, totalMs));
  const clampedEnd = Math.max(clampedStart + 50, Math.min(endMs, totalMs));

  const startFrame = Math.floor((clampedStart / 1000) * sampleRate);
  const endFrame = Math.ceil((clampedEnd / 1000) * sampleRate);
  const sliceFrames = Math.max(1, endFrame - startFrame);

  const srcStart = dataOffset + startFrame * bytesPerFrame;
  const sliceLen = sliceFrames * bytesPerFrame;
  const pcm = buf.subarray(srcStart, Math.min(srcStart + sliceLen, dataOffset + dataLen));

  const header = Buffer.alloc(44);
  const chunkSize = 36 + pcm.length;
  header.write('RIFF', 0);
  header.writeUInt32LE(chunkSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * bytesPerFrame, 28);
  header.writeUInt16LE(bytesPerFrame, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.concat([header, pcm]));

  return {
    durationMs: Math.round((sliceFrames / sampleRate) * 1000),
    sampleRate,
    channels,
    totalMs: Math.round(totalMs),
    startMs: Math.round(clampedStart),
    endMs: Math.round(clampedEnd),
  };
}
