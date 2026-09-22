const OpusScript = require('opusscript');

const MAX_STREAM_BYTES =
  8 * 1024 * 1024;

const MAX_COMPLETED_STREAMS =
  20;

class AudioPipelineService {
  constructor() {
    this.activeStreams =
      new Map();

    this.completedStreams = [];

    this.completedHandler =
      null;

    this.levelHandler =
      null;

    this.streamStartHandler =
      null;

    /** Cap inbound listen; 0 = no force-complete. */
    this.maxUserTalkMs = 20000;

    /** Stream IDs still keyed on Zello after we force-completed locally. */
    this.remoteStillKeyed = new Set();

    this.state = {
      status: 'idle',
      activeStreams: 0,
      activeSpeaker: '',
      activeChannel: '',
      voiceLevel: 0,
      outputLevel: 0,
      packetsReceived: 0,
      bytesReceived: 0,
      streamsCompleted: 0,
      lastSpeaker: '',
      lastChannel: '',
      lastStreamBytes: 0,
      lastStreamPackets: 0,
      lastStreamDurationMs: 0,
      lastError: '',
      lastEventAt:
        new Date().toISOString()
    };
  }

  setLevelHandler(handler) {
    this.levelHandler =
      typeof handler === 'function'
        ? handler
        : null;
  }

  setListenPolicy(policy) {
    const input =
      policy && typeof policy === 'object'
        ? policy
        : {};
    const ms = Number(input.maxUserTalkMs);
    this.maxUserTalkMs =
      Number.isFinite(ms) && ms > 0
        ? Math.min(120000, Math.max(3000, Math.round(ms)))
        : 0;
  }

  clearForceTimer(stream) {
    if (stream && stream.forceTimer) {
      clearTimeout(stream.forceTimer);
      stream.forceTimer = null;
    }
  }

  forceCompleteStream(streamId, reason) {
    const stream =
      this.activeStreams.get(streamId);

    if (!stream || stream.forceCompleted) {
      return null;
    }

    stream.forceCompleted = true;
    stream.forceReason =
      String(reason || 'max-user-talk');

    // Human may still hold Zello PTT — track until real on_stream_stop
    this.remoteStillKeyed.add(streamId);

    return this.stopStream(streamId);
  }

  /** True while a remote user still has the channel button (incl. after local cap). */
  isRemoteChannelBusy() {
    return (
      this.activeStreams.size > 0 ||
      this.remoteStillKeyed.size > 0
    );
  }

  noteRemoteStreamStopped(streamId) {
    if (Number.isInteger(streamId)) {
      this.remoteStillKeyed.delete(streamId);
    }
  }

  emitLevels() {
    if (!this.levelHandler) {
      return;
    }

    try {
      this.levelHandler({
        inputLevel:
          Number.isFinite(
            this.state.voiceLevel
          )
            ? this.state.voiceLevel
            : 0,

        outputLevel:
          Number.isFinite(
            this.state.outputLevel
          )
            ? this.state.outputLevel
            : 0,

        at: Date.now()
      });
    } catch {
      // Meter UI must never affect audio processing.
    }
  }

  setCompletedHandler(handler) {
    this.completedHandler =
      typeof handler === 'function'
        ? handler
        : null;
  }

  setStreamStartHandler(handler) {
    this.streamStartHandler =
      typeof handler === 'function'
        ? handler
        : null;
  }

  touch(changes = {}) {
    this.state = {
      ...this.state,
      ...changes,
      lastEventAt:
        new Date().toISOString()
    };

    if (
      Object.prototype.hasOwnProperty.call(
        changes,
        'voiceLevel'
      ) ||
      Object.prototype.hasOwnProperty.call(
        changes,
        'outputLevel'
      )
    ) {
      this.emitLevels();
    }
  }

  getStatus() {
    return {
      ...this.state,
      activeStreams:
        this.activeStreams.size
    };
  }

  parseMeterCodecHeader(codecHeader) {
    if (
      typeof codecHeader !== 'string' ||
      !codecHeader
    ) {
      return null;
    }

    let header;

    try {
      header = Buffer.from(
        codecHeader,
        'base64'
      );
    } catch {
      return null;
    }

    if (header.length < 4) {
      return null;
    }

    const sampleRate =
      header.readUInt16LE(0);

    if (!sampleRate) {
      return null;
    }

    return { sampleRate };
  }

  createMeterDecoder(codecHeader) {
    const format =
      this.parseMeterCodecHeader(
        codecHeader
      );

    if (!format) {
      return null;
    }

    try {
      return new OpusScript(
        format.sampleRate,
        1,
        OpusScript.Application.VOIP
      );
    } catch {
      return null;
    }
  }

  calculatePcmRmsLevel(pcm) {
    if (
      !Buffer.isBuffer(pcm) ||
      pcm.length < 2
    ) {
      return 0;
    }

    const sampleCount =
      Math.floor(pcm.length / 2);

    let sumSquares = 0;

    for (
      let offset = 0;
      offset < sampleCount * 2;
      offset += 2
    ) {
      const sample =
        pcm.readInt16LE(offset) /
        32768;

      sumSquares +=
        sample * sample;
    }

    const rms =
      Math.sqrt(
        sumSquares / sampleCount
      );

    const db =
      rms > 0
        ? 20 * Math.log10(rms)
        : -60;

    return Math.max(
      0,
      Math.min(
        1,
        (db + 48) / 48
      )
    );
  }

  setOutputLevel(level) {
    const safeLevel =
      Number.isFinite(level)
        ? Math.max(
            0,
            Math.min(1, level)
          )
        : 0;

    this.touch({
      outputLevel: safeLevel
    });
  }

  setOutputPcmLevel(pcm) {
    this.setOutputLevel(
      this.calculatePcmRmsLevel(
        pcm
      )
    );
  }

  closeMeterDecoder(stream) {
    if (
      !stream ||
      !stream.meterDecoder
    ) {
      return;
    }

    try {
      stream.meterDecoder.delete();
    } catch {
      // Ignore meter decoder cleanup failure.
    }

    stream.meterDecoder = null;
  }

  startStream(metadata) {
    if (
      !metadata ||
      !Number.isInteger(
        metadata.streamId
      )
    ) {
      return null;
    }

    const stream = {
      streamId:
        metadata.streamId,

      channel:
        typeof metadata.channel ===
          'string'
          ? metadata.channel
          : '',

      from:
        typeof metadata.from ===
          'string'
          ? metadata.from
          : '',

      codec:
        typeof metadata.codec ===
          'string'
          ? metadata.codec
          : '',

      codecHeader:
        typeof metadata.codecHeader ===
          'string'
          ? metadata.codecHeader
          : '',

      packetDuration:
        Number.isFinite(
          metadata.packetDuration
        )
          ? metadata.packetDuration
          : 0,

      startedAt:
        Date.now(),

      stoppedAt:
        null,

      packetCount: 0,
      byteCount: 0,
      storedByteCount: 0,
      droppedBytes: 0,
      packets: [],

      meterDecoder:
        this.createMeterDecoder(
          metadata.codecHeader
        ),

      meterLevel: 0,

      forceCompleted: false,
      forceReason: '',
      forceTimer: null
    };

    this.activeStreams.set(
      stream.streamId,
      stream
    );

    if (this.maxUserTalkMs > 0) {
      const cappedId = stream.streamId;
      stream.forceTimer = setTimeout(() => {
        this.forceCompleteStream(
          cappedId,
          'max-user-talk'
        );
      }, this.maxUserTalkMs);
    }

    this.touch({
      status: 'receiving',
      activeSpeaker:
        stream.from,
      activeChannel:
        stream.channel,
      voiceLevel: 0,
      lastError: ''
    });

    if (typeof this.streamStartHandler === 'function') {
      try {
        this.streamStartHandler({
          from: stream.from,
          channel: stream.channel,
          streamId: stream.streamId
        });
      } catch {
        /* ignore */
      }
    }

    return {
      ...stream,
      packets: undefined,
      forceTimer: undefined
    };
  }

  pushPacket(
    streamId,
    packetId,
    audioBuffer
  ) {
    const stream =
      this.activeStreams.get(
        streamId
      );

    if (
      !stream ||
      !Buffer.isBuffer(
        audioBuffer
      )
    ) {
      return false;
    }

    stream.packetCount += 1;
    stream.byteCount +=
      audioBuffer.length;

    if (
      stream.storedByteCount +
        audioBuffer.length <=
      MAX_STREAM_BYTES
    ) {
      stream.packets.push({
        packetId,
        data:
          Buffer.from(
            audioBuffer
          )
      });

      stream.storedByteCount +=
        audioBuffer.length;
    } else {
      stream.droppedBytes +=
        audioBuffer.length;
    }

    this.touch({
      status: 'receiving',
      activeSpeaker:
        stream.from,
      activeChannel:
        stream.channel,

      packetsReceived:
        this.state
          .packetsReceived + 1,

      bytesReceived:
        this.state
          .bytesReceived +
        audioBuffer.length
    });


    if (stream.meterDecoder) {
      try {
        const decoded =
          stream.meterDecoder.decode(
            audioBuffer
          );

        const level =
          this.calculatePcmRmsLevel(
            Buffer.from(decoded)
          );

        stream.meterLevel =
          Math.max(
            level,
            stream.meterLevel * 0.72
          );

        this.touch({
          voiceLevel:
            stream.meterLevel
        });
      } catch {
        // Metering must never interrupt audio handling.
      }
    }

    return true;
  }

  stopStream(streamId) {
    this.noteRemoteStreamStopped(streamId);

    const stream =
      this.activeStreams.get(
        streamId
      );

    if (!stream) {
      return null;
    }

    this.clearForceTimer(stream);

    this.closeMeterDecoder(
      stream
    );

    this.activeStreams.delete(
      streamId
    );

    stream.stoppedAt =
      Date.now();

    const durationMs =
      Math.max(
        0,
        stream.stoppedAt -
        stream.startedAt
      );

    const completed = {
      streamId:
        stream.streamId,

      channel:
        stream.channel,

      from:
        stream.from,

      codec:
        stream.codec,

      codecHeader:
        stream.codecHeader,

      packetDuration:
        stream.packetDuration,

      startedAt:
        stream.startedAt,

      stoppedAt:
        stream.stoppedAt,

      durationMs,

      packetCount:
        stream.packetCount,

      byteCount:
        stream.byteCount,

      droppedBytes:
        stream.droppedBytes,

      forceCompleted:
        stream.forceCompleted === true,

      forceReason:
        stream.forceReason || '',

      packets:
        stream.packets
    };

    this.completedStreams.unshift(
      completed
    );

    if (
      this.completedStreams.length >
      MAX_COMPLETED_STREAMS
    ) {
      this.completedStreams.length =
        MAX_COMPLETED_STREAMS;
    }

    const nextActive =
      this.activeStreams
        .values()
        .next()
        .value ||
      null;

    this.touch({
      status:
        this.activeStreams.size
          ? 'receiving'
          : 'idle',

      activeSpeaker:
        nextActive
          ? nextActive.from
          : '',

      activeChannel:
        nextActive
          ? nextActive.channel
          : '',

      voiceLevel:
        nextActive
          ? nextActive.meterLevel || 0
          : 0,

      streamsCompleted:
        this.state
          .streamsCompleted + 1,

      lastSpeaker:
        stream.from,

      lastChannel:
        stream.channel,

      lastStreamBytes:
        stream.byteCount,

      lastStreamPackets:
        stream.packetCount,

      lastStreamDurationMs:
        durationMs
    });

    if (
      this.completedHandler
    ) {
      Promise.resolve(
        this.completedHandler(
          completed
        )
      ).catch((error) => {
        this.setError(
          error &&
          error.message
            ? error.message
            : String(error)
        );
      });
    }

    return {
      ...completed,
      packets: undefined
    };
  }

  clearActiveStreams() {
    for (
      const stream of
        this.activeStreams.values()
    ) {
      this.clearForceTimer(stream);
      this.closeMeterDecoder(
        stream
      );
    }

    this.activeStreams.clear();
    this.remoteStillKeyed.clear();

    this.activeStreams.clear();

    this.touch({
      status: 'idle',
      activeSpeaker: '',
      activeChannel: '',
      voiceLevel: 0,
      outputLevel: 0
    });
  }

  setError(message) {
    this.touch({
      status: 'error',

      lastError:
        typeof message ===
          'string'
          ? message
          : 'Audio pipeline error.'
    });
  }

  getLatestCompletedStream() {
    return (
      this.completedStreams[0] ||
      null
    );
  }
}

module.exports = {
  AudioPipelineService,
  MAX_STREAM_BYTES
};
