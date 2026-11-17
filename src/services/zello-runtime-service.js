const WebSocket = require('ws');
const OpusScript = require('opusscript');

const ZELLO_SERVER_URL =
  'wss://zello.io/ws';

const CONNECTION_TIMEOUT_MS =
  15000;

const COMMAND_TIMEOUT_MS =
  10000;

const OUTPUT_SAMPLE_RATE =
  16000;

const OUTPUT_FRAME_DURATION_MS =
  20;

const OUTPUT_FRAME_SAMPLES =
  OUTPUT_SAMPLE_RATE *
  OUTPUT_FRAME_DURATION_MS /
  1000;

const OUTPUT_FRAME_BYTES =
  OUTPUT_FRAME_SAMPLES * 2;

/** Opus rates the codec_header may carry (Zello decoders handle all of them). */
const OPUS_RATES = [8000, 12000, 16000, 24000, 48000];

// Server events we already understand; anything else seen mid-transmit is reported for logging
const KNOWN_SERVER_EVENTS = new Set([
  'on_channel_status',
  'on_stream_start',
  'on_stream_stop',
  'on_text_message',
  'on_image',
  'on_location',
  'on_transcription',
  'on_dispatch_call_status',
  'on_error'
]);

function summarizeServerMessage(message) {
  try {
    const text = JSON.stringify(message, (key, value) =>
      /token|password|secret|key/i.test(key) ? '[hidden]' : value
    );
    return text.length > 300 ? text.slice(0, 300) + '…' : text;
  } catch {
    return '(unreadable message)';
  }
}

class ZelloRuntimeService {
  constructor(
    settingsStore,
    audioPipelineService
  ) {
    this.settingsStore =
      settingsStore;

    this.audioPipelineService =
      audioPipelineService;

    this.socket = null;
    this.sequence = 1;

    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
    this.connectTimer = null;

    this.pendingRequests =
      new Map();

    this.txAbortRequested = false;
    this.foreignStreamStartHandler = null;
    this.foreignStreamStopHandler = null;
    /** @type {Map<number, { from: string, channel: string }>} on_stream_stop has no sender */
    this.remoteStreamInfo = new Map();
    this.textMessageHandler = null;
    this.imageMessageHandler = null;
    /** @type {Map<number, { messageId: number, channel: string, from: string, thumbnail: Buffer|null, full: Buffer|null, startedAt: number }>} */
    this.activeImages = new Map();
    this._imageFinalizeTimers = new Map();
    /** Our live outgoing stream ({ streamId, lost }) while sendPcmHoldingWhile runs */
    this.outgoing = null;
    this.txEventHandler = null;

    /** When true, logon uses JWT only + listen_only (no username/password). */
    this.anonymousListen = false;

    this.state = {
      status: 'disconnected',
      channelName: '',
      botUsername: '',
      channelStatus: 'offline',
      usersOnline: 0,
      transmitting: false,
      anonymousListen: false,
      lastError: '',
      lastEventAt:
        new Date().toISOString()
    };
  }

  setForeignStreamStartHandler(handler) {
    this.foreignStreamStartHandler =
      typeof handler === 'function' ? handler : null;
  }

  setForeignStreamStopHandler(handler) {
    this.foreignStreamStopHandler =
      typeof handler === 'function' ? handler : null;
  }

  setTextMessageHandler(handler) {
    this.textMessageHandler =
      typeof handler === 'function' ? handler : null;
  }

  /** Receives { type: 'floor-lost' | 'server-message', ... } while we transmit. */
  setTxEventHandler(handler) {
    this.txEventHandler =
      typeof handler === 'function' ? handler : null;
  }

  emitTxEvent(event) {
    if (typeof this.txEventHandler !== 'function') return;
    try {
      this.txEventHandler(event);
    } catch {
      /* ignore */
    }
  }

  /** Flag the current outgoing stream as no longer ours (someone took the button). */
  markFloorLost(info = {}) {
    const out = this.outgoing;
    if (!out || out.lost) return;
    out.lost = { ...info, at: Date.now() };
    this.emitTxEvent({
      type: 'floor-lost',
      streamId: out.streamId,
      ...out.lost
    });
  }

  /** Watch server traffic for signs our outgoing stream was cut. */
  watchOutgoing(message) {
    const out = this.outgoing;
    if (!out || !message || typeof message !== 'object') return;
    const hasSeq = Number.isInteger(message.seq);
    if (hasSeq && this.pendingRequests.has(message.seq)) return;

    const command = String(message.command || '');
    const me = String(this.state.botUsername || '').trim().toLowerCase();

    if (command === 'on_stream_start') {
      const from = String(message.from || '').trim();
      if (
        from &&
        from.toLowerCase() !== me &&
        message.stream_id !== out.streamId
      ) {
        this.markFloorLost({
          reason: 'foreign-start',
          from,
          foreignStreamId: message.stream_id
        });
      }
      return;
    }
    if (command === 'on_stream_stop') {
      if (message.stream_id === out.streamId) {
        this.markFloorLost({ reason: 'stream-stopped' });
      }
      return;
    }
    if (command === 'on_error') {
      this.markFloorLost({
        reason: 'server-error',
        error: String(message.error || 'unknown error')
      });
      return;
    }
    if (command === 'on_channel_status') {
      if (message.status && message.status !== 'online') {
        this.markFloorLost({
          reason: 'channel-offline',
          error: String(message.error || message.status)
        });
      }
      return;
    }
    if (KNOWN_SERVER_EVENTS.has(command)) return;

    this.emitTxEvent({
      type: 'server-message',
      text: summarizeServerMessage(message)
    });
    // Unsolicited error (no command reply) mid-stream: treat as losing the button
    if (!hasSeq && typeof message.error === 'string' && message.error) {
      this.markFloorLost({ reason: 'server-error', error: message.error });
    }
  }

  setImageMessageHandler(handler) {
    this.imageMessageHandler =
      typeof handler === 'function' ? handler : null;
  }

  static buildImagePacket(imageId, imageType, imageData) {
    const header = Buffer.alloc(9);
    header.writeUInt8(0x02, 0);
    header.writeUInt32BE(Number(imageId) >>> 0, 1);
    header.writeUInt32BE(Number(imageType) >>> 0, 5);
    return Buffer.concat([header, imageData]);
  }

  requestTxAbort() {
    this.txAbortRequested = true;
  }

  getStatus() {
    return {
      ...this.state
    };
  }

  setState(changes) {
    this.state = {
      ...this.state,
      ...changes,
      lastEventAt:
        new Date().toISOString()
    };

    return this.getStatus();
  }

  nextSequence() {
    const value =
      this.sequence;

    this.sequence += 1;

    if (
      this.sequence >
      2147483647
    ) {
      this.sequence = 1;
    }

    return value;
  }

  readCredentials(override) {
    const settings =
      this.settingsStore.read();

    const zello =
      settings &&
      settings.zello &&
      typeof settings.zello ===
        'object'
        ? settings.zello
        : {};

    const anonymousListen =
      (override &&
        typeof override === 'object' &&
        override.anonymousListen === true) ||
      zello.anonymousListen === true;

    if (
      override &&
      typeof override === 'object' &&
      override.channelName &&
      override.token
    ) {
      const channelName = String(override.channelName).trim();
      const token = String(override.token).trim();
      if (!channelName) {
        throw new Error('No active Zello channel is configured.');
      }
      if (!token) {
        throw new Error(
          'No Zello authentication token is configured.'
        );
      }
      if (anonymousListen) {
        const label =
          String(override.botUsername || '').trim() ||
          '(anonymous)';
        return {
          channelName,
          botUsername: label,
          password: '',
          token,
          anonymousListen: true
        };
      }
      const botUsername = String(override.botUsername || '').trim();
      const password =
        typeof override.password === 'string'
          ? override.password
          : '';
      if (!botUsername) {
        throw new Error('No Zello bot username is configured.');
      }
      if (!password) {
        throw new Error('No Zello bot password is configured.');
      }
      return {
        channelName,
        botUsername,
        password,
        token,
        anonymousListen: false
      };
    }

    const channelName =
      typeof zello.channelName ===
        'string'
        ? zello.channelName.trim()
        : '';

    const botUsername =
      typeof zello.botUsername ===
        'string'
        ? zello.botUsername.trim()
        : '';

    const password =
      typeof zello.password ===
        'string'
        ? zello.password
        : '';

    const token =
      typeof zello.token ===
        'string'
        ? zello.token.trim()
        : '';

    if (!channelName) {
      throw new Error(
        'No active Zello channel is configured.'
      );
    }

    if (!token) {
      throw new Error(
        'No Zello authentication token is configured.'
      );
    }

    if (anonymousListen) {
      return {
        channelName,
        botUsername: botUsername || '(anonymous)',
        password: '',
        token,
        anonymousListen: true
      };
    }

    if (!botUsername) {
      throw new Error(
        'No Zello bot username is configured.'
      );
    }

    if (!password) {
      throw new Error(
        'No Zello bot password is configured.'
      );
    }

    return {
      channelName,
      botUsername,
      password,
      token,
      anonymousListen: false
    };
  }

  async connect(credentialsOverride) {
    if (
      this.socket &&
      this.socket.readyState ===
        WebSocket.OPEN &&
      this.state.status ===
        'connected'
    ) {
      return this.getStatus();
    }

    if (
      this.state.status ===
        'connecting' &&
      this.connectPromise
    ) {
      return this.connectPromise;
    }

    const credentials =
      this.readCredentials(
        credentialsOverride
      );

    this.anonymousListen =
      credentials.anonymousListen === true;

    this.cleanupSocket();

    this.setState({
      status: 'connecting',
      channelName:
        credentials.channelName,
      botUsername:
        credentials.botUsername,
      channelStatus:
        'offline',
      usersOnline: 0,
      transmitting: false,
      anonymousListen:
        this.anonymousListen,
      lastError: ''
    });

    this.connectPromise =
      new Promise(
        (resolve, reject) => {
          this.connectResolve =
            resolve;

          this.connectReject =
            reject;

          let socket;

          try {
            socket =
              new WebSocket(
                ZELLO_SERVER_URL
              );
          } catch (error) {
            this.failConnection(
              error instanceof Error
                ? error.message
                : String(error)
            );

            return;
          }

          this.socket = socket;

          this.connectTimer =
            setTimeout(
              () => {
                this.failConnection(
                  'Timed out while connecting to Zello.'
                );
              },
              CONNECTION_TIMEOUT_MS
            );

          socket.on(
            'open',
            () => {
              if (
                socket !==
                this.socket
              ) {
                return;
              }

              const logon = {
                command: 'logon',
                seq: this.nextSequence(),
                auth_token: credentials.token,
                channels: [credentials.channelName],
                features: {
                  transcriptions: true
                },
                version: '2.0',
                platform_type: 'desktop',
                platform_name: 'Zello Bot Desktop 2.0'
              };
              if (credentials.anonymousListen) {
                // F&F anonymous: JWT only, no username/password
                logon.listen_only = true;
              } else {
                logon.username = credentials.botUsername;
                logon.password = credentials.password;
              }
              socket.send(JSON.stringify(logon));
            }
          );

          socket.on(
            'message',
            (data, isBinary) => {
              if (
                socket !==
                this.socket
              ) {
                return;
              }

              if (isBinary) {
                this.handleBinaryMessage(
                  data
                );

                return;
              }

              this.handleTextMessage(
                data
              );
            }
          );

          socket.on(
            'error',
            (error) => {
              if (
                socket !==
                this.socket
              ) {
                return;
              }

              const message =
                error &&
                error.message
                  ? error.message
                  : 'Zello WebSocket error.';

              if (
                this.state.status ===
                'connecting'
              ) {
                this.failConnection(
                  message
                );

                return;
              }

              this.setState({
                status: 'error',
                lastError: message
              });
            }
          );

          socket.on(
            'close',
            (
              code,
              reasonBuffer
            ) => {
              if (
                socket !==
                this.socket
              ) {
                return;
              }

              this.clearConnectTimer();

              const reason =
                reasonBuffer &&
                reasonBuffer.length
                  ? reasonBuffer
                      .toString('utf8')
                  : '';

              const wasConnecting =
                this.state.status ===
                'connecting';

              this.socket = null;

              this.rejectAllPending(
                new Error(
                  reason ||
                  'Zello connection closed.'
                )
              );

              if (
                this.audioPipelineService
              ) {
                this.audioPipelineService
                  .clearActiveStreams();
              }

              if (wasConnecting) {
                this.rejectPendingConnection(
                  new Error(
                    reason ||
                    `Zello connection closed (${code}).`
                  )
                );
              }

              this.setState({
                status:
                  'disconnected',

                channelStatus:
                  'offline',

                usersOnline: 0,
                transmitting: false,

                lastError:
                  code === 1000
                    ? ''
                    : (
                        reason ||
                        (
                          code
                            ? `Connection closed (${code}).`
                            : ''
                        )
                      )
              });
            }
          );
        }
      );

    return this.connectPromise;
  }

  handleTextMessage(data) {
    let message;

    try {
      message =
        JSON.parse(
          data.toString(
            'utf8'
          )
        );
    } catch {
      return;
    }

    this.watchOutgoing(message);

    if (
      Number.isInteger(
        message.seq
      ) &&
      this.pendingRequests.has(
        message.seq
      )
    ) {
      const pending =
        this.pendingRequests.get(
          message.seq
        );

      this.pendingRequests.delete(
        message.seq
      );

      clearTimeout(
        pending.timer
      );

      if (
        message.success ===
          false ||
        message.error
      ) {
        pending.reject(
          new Error(
            message.error ||
            'Zello command failed.'
          )
        );
      } else {
        pending.resolve(
          message
        );
      }

      return;
    }

    if (
      this.state.status ===
        'connecting' &&
      Object.prototype
        .hasOwnProperty.call(
          message,
          'success'
        )
    ) {
      if (
        message.success === true
      ) {
        this.clearConnectTimer();

        const status =
          this.setState({
            status: 'connected',
            lastError: ''
          });

        this.resolvePendingConnection(
          status
        );

        return;
      }

      this.failConnection(
        typeof message.error ===
          'string' &&
        message.error
          ? message.error
          : 'Zello authentication failed.'
      );

      return;
    }

    if (
      message.command ===
        'on_channel_status'
    ) {
      this.setState({
        channelStatus:
          typeof message.status ===
            'string'
            ? message.status
            : 'offline',

        usersOnline:
          Number.isInteger(
            message.users_online
          )
            ? message.users_online
            : 0,

        lastError:
          typeof message.error ===
            'string'
            ? message.error
            : ''
      });

      return;
    }

    if (
      message.command ===
        'on_stream_start'
    ) {
      if (
        message.type !==
          'audio' ||
        message.codec !==
          'opus'
      ) {
        return;
      }

      if (Number.isInteger(message.stream_id)) {
        this.remoteStreamInfo.set(message.stream_id, {
          from: String(message.from || ''),
          channel: String(message.channel || '')
        });
        if (this.remoteStreamInfo.size > 50) {
          this.remoteStreamInfo.delete(
            this.remoteStreamInfo.keys().next().value
          );
        }
      }

      if (
        typeof this.foreignStreamStartHandler ===
        'function'
      ) {
        try {
          this.foreignStreamStartHandler(
            message.from,
            message.channel
          );
        } catch {
          /* ignore */
        }
      }

      if (
        this.audioPipelineService
      ) {
        this.audioPipelineService
          .startStream({
            streamId:
              message.stream_id,

            channel:
              message.channel,

            from:
              message.from,

            codec:
              message.codec,

            codecHeader:
              message.codec_header,

            packetDuration:
              message.packet_duration
          });
      }

      return;
    }

    if (
      message.command ===
        'on_stream_stop'
    ) {
      const info =
        this.remoteStreamInfo.get(message.stream_id) || null;
      this.remoteStreamInfo.delete(message.stream_id);

      // Fires before any decode/STT so grab mode can key up in the same tick
      if (
        info &&
        typeof this.foreignStreamStopHandler ===
        'function'
      ) {
        try {
          this.foreignStreamStopHandler({
            streamId: message.stream_id,
            from: info.from,
            channel: info.channel || this.state.channelName
          });
        } catch {
          /* ignore */
        }
      }

      if (
        this.audioPipelineService
      ) {
        this.audioPipelineService
          .stopStream(
            message.stream_id
          );
      }

      return;
    }

    if (
      message.command ===
        'on_text_message'
    ) {
      const text = String(message.text || '').trim();
      const from = String(message.from || '').trim();
      if (
        text &&
        typeof this.textMessageHandler === 'function'
      ) {
        try {
          Promise.resolve(
            this.textMessageHandler({
              from,
              text,
              channel:
                typeof message.channel === 'string'
                  ? message.channel
                  : '',
              messageId: message.message_id
            })
          ).catch(() => {});
        } catch {
          /* ignore */
        }
      }
      return;
    }

    if (message.command === 'on_image') {
      this.handleImageStart(message);
      return;
    }

    if (
      typeof message.error ===
        'string' &&
      message.error
    ) {
      this.setState({
        lastError:
          message.error
      });
    }
  }

  handleImageStart(msg) {
    const messageId = Number(
      msg.message_id ?? msg.image_id ?? msg.id
    );
    if (!Number.isFinite(messageId)) return;

    const image = {
      messageId,
      channel:
        typeof msg.channel === 'string'
          ? msg.channel
          : this.state.channelName || '',
      from:
        typeof msg.from === 'string' ? msg.from : 'unknown',
      thumbnail: null,
      full: null,
      startedAt: Date.now()
    };
    this.activeImages.set(messageId, image);
    this.scheduleImageFinalize(messageId, 8000);
  }

  scheduleImageFinalize(messageId, delayMs) {
    const prev = this._imageFinalizeTimers.get(messageId);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      this._imageFinalizeTimers.delete(messageId);
      this.finalizeIncomingImage(messageId);
    }, delayMs);
    this._imageFinalizeTimers.set(messageId, timer);
  }

  finalizeIncomingImage(messageId) {
    const image = this.activeImages.get(messageId);
    if (!image) return;
    this.activeImages.delete(messageId);
    const t = this._imageFinalizeTimers.get(messageId);
    if (t) {
      clearTimeout(t);
      this._imageFinalizeTimers.delete(messageId);
    }

    const buffer = image.full || image.thumbnail;
    if (!buffer || buffer.length < 32) return;
    if (typeof this.imageMessageHandler !== 'function') return;

    try {
      Promise.resolve(
        this.imageMessageHandler({
          messageId,
          from: image.from,
          channel: image.channel,
          buffer,
          thumbnailBuffer: image.thumbnail,
          fullBuffer: image.full,
          thumbOnly: !image.full && !!image.thumbnail
        })
      ).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  handleImageBinary(buffer) {
    if (buffer.length < 9) return;
    const messageId = buffer.readUInt32BE(1);
    let imageType = buffer.readUInt32BE(5);
    let imageData = buffer.subarray(9);

    if (imageType !== 1 && imageType !== 2 && buffer.length >= 6) {
      const compactType = buffer.readUInt8(5);
      if (compactType === 1 || compactType === 2) {
        imageType = compactType;
        imageData = buffer.subarray(6);
      }
    }

    if (!imageData?.length) return;

    let image = this.activeImages.get(messageId);
    if (!image) {
      // Binary arrived before on_image — create a stub
      image = {
        messageId,
        channel: this.state.channelName || '',
        from: 'unknown',
        thumbnail: null,
        full: null,
        startedAt: Date.now()
      };
      this.activeImages.set(messageId, image);
    }

    if (imageType === 1) {
      image.full = image.full
        ? Buffer.concat([image.full, imageData])
        : imageData;
    } else if (imageType === 2) {
      image.thumbnail = image.thumbnail
        ? Buffer.concat([image.thumbnail, imageData])
        : imageData;
    } else if (
      imageData[0] === 0xff &&
      imageData[1] === 0xd8
    ) {
      if (!image.thumbnail) image.thumbnail = imageData;
      else image.full = imageData;
    }

    if (image.full) {
      this.finalizeIncomingImage(messageId);
    } else {
      this.scheduleImageFinalize(messageId, 6500);
    }
  }

  /**
   * Send a channel text message (Zello send_text_message).
   */
  async sendText(text, options = {}) {
    const message = String(text || '').trim();
    if (!message) {
      throw new Error('No text to send');
    }
    if (
      this.state.status !== 'connected' ||
      this.state.channelStatus !== 'online'
    ) {
      throw new Error('Zello channel is not ready.');
    }
    const channelName =
      this.state.channelName ||
      this.settingsStore.read()?.zello?.channelName;
    if (!channelName) {
      throw new Error('No Zello channel configured.');
    }
    const payload = {
      command: 'send_text_message',
      channel: channelName,
      text: message.slice(0, 512)
    };
    if (options.forUser) payload.for = options.forUser;
    await this.requestCommand(payload, options.timeoutMs || 10000);
    return { ok: true, bytes: message.length };
  }

  /**
   * Send a JPEG to the current channel (Zello Channel API send_image).
   */
  async sendImage({
    imageBuffer,
    thumbnailBuffer,
    width,
    height,
    forUser = null,
    timeoutMs = 15000
  } = {}) {
    if (!imageBuffer?.length) {
      throw new Error('No image data to send');
    }
    if (
      this.state.status !== 'connected' ||
      this.state.channelStatus !== 'online'
    ) {
      throw new Error('Zello channel is not ready.');
    }

    const channelName = this.state.channelName ||
      this.settingsStore.read()?.zello?.channelName;
    if (!channelName) {
      throw new Error('No Zello channel configured.');
    }

    const thumb =
      thumbnailBuffer?.length ? thumbnailBuffer : imageBuffer;
    const payload = {
      command: 'send_image',
      channel: channelName,
      type: 'jpeg',
      source: 'camera',
      width: Number(width) || 720,
      height: Number(height) || 720,
      thumbnail_content_length: thumb.length,
      content_length: imageBuffer.length
    };
    if (forUser) payload.for = forUser;

    const resp = await this.requestCommand(payload, timeoutMs);
    const imageId = resp.image_id ?? resp.message_id ?? resp.id;
    if (imageId == null) {
      throw new Error(
        'Zello rejected send_image' +
          (resp.error ? ': ' + resp.error : '')
      );
    }

    if (
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN
    ) {
      throw new Error('Zello is not connected.');
    }

    this.socket.send(
      ZelloRuntimeService.buildImagePacket(imageId, 0x02, thumb)
    );
    this.socket.send(
      ZelloRuntimeService.buildImagePacket(imageId, 0x01, imageBuffer)
    );

    return { imageId, bytes: imageBuffer.length };
  }

  handleBinaryMessage(data) {
    const buffer =
      Buffer.isBuffer(data)
        ? data
        : Buffer.from(data);

    if (buffer.length < 9) {
      if (
        this.audioPipelineService
      ) {
        this.audioPipelineService
          .setError(
            'Received malformed Zello audio packet.'
          );
      }

      return;
    }

    const packetType =
      buffer.readUInt8(0);

    if (packetType === 0x02) {
      this.handleImageBinary(buffer);
      return;
    }

    if (packetType !== 0x01) {
      return;
    }

    const streamId =
      buffer.readUInt32BE(1);

    const packetId =
      buffer.readUInt32BE(5);

    const opusData =
      buffer.subarray(9);

    if (
      this.audioPipelineService
    ) {
      this.audioPipelineService
        .pushPacket(
          streamId,
          packetId,
          opusData
        );
    }
  }

  requestCommand(
    command,
    timeoutMs =
      COMMAND_TIMEOUT_MS
  ) {
    if (
      !this.socket ||
      this.socket.readyState !==
        WebSocket.OPEN
    ) {
      return Promise.reject(
        new Error(
          'Zello is not connected.'
        )
      );
    }

    const seq =
      this.nextSequence();

    const payload = {
      ...command,
      seq
    };

    return new Promise(
      (resolve, reject) => {
        const timer =
          setTimeout(
            () => {
              this.pendingRequests
                .delete(seq);

              reject(
                new Error(
                  'Zello command timed out.'
                )
              );
            },
            timeoutMs
          );

        this.pendingRequests.set(
          seq,
          {
            resolve,
            reject,
            timer
          }
        );

        try {
          this.socket.send(
            JSON.stringify(
              payload
            )
          );
        } catch (error) {
          clearTimeout(timer);

          this.pendingRequests
            .delete(seq);

          reject(error);
        }
      }
    );
  }

  /** {sample_rate_hz(16LE), frames_per_packet, frame_size_ms} — see Zello API.md. */
  createOutputCodecHeader(
    sampleRate = OUTPUT_SAMPLE_RATE,
    frameSizeMs = 60
  ) {
    const header =
      Buffer.alloc(4);

    header.writeUInt16LE(
      sampleRate,
      0
    );

    header.writeUInt8(
      1,
      2
    );

    header.writeUInt8(
      frameSizeMs,
      3
    );

    return header.toString(
      'base64'
    );
  }

  /**
   * Bare start_stream (grab-mode hammer). Resolves the new stream id.
   * options.sampleRate: Opus rate for the stream (DJ mode); default 16 kHz.
   */
  requestStartStream(options = {}) {
    if (this.anonymousListen || this.state.anonymousListen) {
      return Promise.reject(
        new Error(
          'Anonymous listen mode cannot transmit. Turn it off on Live and reconnect.'
        )
      );
    }
    if (this.state.status !== 'connected') {
      return Promise.reject(new Error('Zello is not connected.'));
    }
    const channelName =
      this.state.channelName ||
      this.settingsStore.read().zello.channelName;
    const rate = OPUS_RATES.includes(Number(options.sampleRate))
      ? Number(options.sampleRate)
      : 0;
    return this.requestCommand({
      command: 'start_stream',
      channel: channelName,
      type: 'audio',
      codec: 'opus',
      codec_header: rate
        ? this.createOutputCodecHeader(rate, OUTPUT_FRAME_DURATION_MS)
        : this.createOutputCodecHeader(),
      packet_duration: OUTPUT_FRAME_DURATION_MS
    }).then((response) => {
      if (!Number.isInteger(response.stream_id)) {
        throw new Error('Zello did not return an outgoing stream ID.');
      }
      return response.stream_id;
    });
  }

  /** Let go of a stream we won but no longer want. */
  releaseStreamId(streamId) {
    const channelName =
      this.state.channelName ||
      this.settingsStore.read().zello.channelName;
    return this.requestCommand({
      command: 'stop_stream',
      stream_id: streamId,
      channel: channelName
    }).catch(() => {});
  }

  async sendPcmAudio(
    pcmBuffer,
    options = {}
  ) {
    if (
      !Buffer.isBuffer(pcmBuffer) ||
      !pcmBuffer.length
    ) {
      throw new Error('No PCM audio was provided.');
    }

    return this.sendPcmHoldingWhile(
      async () => pcmBuffer,
      { holdSilence: false, fastStop: options.fastStop === true }
    );
  }

  /**
   * Race for the button: start_stream ASAP, optionally hold with silence
   * while producePcm() runs (STT/LLM/TTS), then send real speech.
   */
  async sendPcmHoldingWhile(
    producePcm,
    options = {}
  ) {
    if (this.anonymousListen || this.state.anonymousListen) {
      throw new Error(
        'Anonymous listen mode cannot transmit. Turn it off on Live and reconnect.'
      );
    }
    const holdSilence = options.holdSilence !== false;
    const maxHoldMs = Math.min(
      90000,
      Math.max(
        5000,
        Number(options.maxHoldMs) || 45000
      )
    );

    if (
      this.state.status !==
        'connected'
    ) {
      throw new Error(
        'Zello is not connected.'
      );
    }

    // channelStatus can be stale while the socket still works; Zello's
    // start_stream reply decides whether transmit is possible.
    // Each bot transmits on the channel it joined, not the global default.
    const channelName =
      this.state.channelName ||
      this.settingsStore.read().zello.channelName;

    // Grab mode may hand over a stream it already won
    const startResponse = Number.isInteger(options.streamId)
      ? { stream_id: options.streamId }
      : await this.requestCommand({
        command:
          'start_stream',

        channel:
          channelName,

        type:
          'audio',

        codec:
          'opus',

        codec_header:
          this.createOutputCodecHeader(),

        packet_duration:
          OUTPUT_FRAME_DURATION_MS
      });

    if (
      !Number.isInteger(
        startResponse.stream_id
      )
    ) {
      throw new Error(
        'Zello did not return an outgoing stream ID.'
      );
    }

    const streamId =
      startResponse.stream_id;

    // Grab floor: stop holding the moment Zello shows the button went to someone else
    const abortOnFloorLoss = options.abortOnFloorLoss === true;
    const watch = { streamId, lost: null };
    this.outgoing = watch;
    let floorLost = null;

    if (typeof options.onStarted === 'function') {
      try {
        options.onStarted(streamId);
      } catch {
        /* ignore */
      }
    }

    const encoder =
      new OpusScript(
        OUTPUT_SAMPLE_RATE,
        1,
        OpusScript.Application.VOIP
      );

    this.setState({
      transmitting: true
    });

    this.txAbortRequested = false;

    const transmissionStartedAt =
      Date.now();

    const transmittingSocket =
      this.socket;

    let transmittedFrames = 0;
    let transmissionInterrupted = false;
    let pcmBuffer = null;
    let produceError = null;
    let produceDone = false;

    const producePromise = Promise.resolve()
      .then(() => producePcm())
      .then((buf) => {
        pcmBuffer = buf;
        produceDone = true;
      })
      .catch((err) => {
        produceError = err;
        produceDone = true;
      });

    const sendFrame = async (framePcm) => {
      let frame = framePcm;
      if (frame.length < OUTPUT_FRAME_BYTES) {
        const padded = Buffer.alloc(OUTPUT_FRAME_BYTES);
        frame.copy(padded, 0);
        frame = padded;
      }

      if (
        this.audioPipelineService &&
        typeof this.audioPipelineService
          .setOutputPcmLevel === 'function'
      ) {
        this.audioPipelineService.setOutputPcmLevel(frame);
      }

      const encoded = Buffer.from(
        encoder.encode(frame, OUTPUT_FRAME_SAMPLES)
      );
      const packet = Buffer.alloc(9 + encoded.length);
      packet.writeUInt8(0x01, 0);
      packet.writeUInt32BE(streamId, 1);
      packet.writeUInt32BE(0, 5);
      encoded.copy(packet, 9);

      if (
        !this.socket ||
        this.socket !== transmittingSocket ||
        transmittingSocket.readyState !== WebSocket.OPEN
      ) {
        transmissionInterrupted = true;
        return false;
      }

      transmittingSocket.send(packet, { binary: true });
      transmittedFrames += 1;

      const targetSendTime =
        transmissionStartedAt +
        transmittedFrames * OUTPUT_FRAME_DURATION_MS;
      const waitMs = Math.max(0, targetSendTime - Date.now());
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      return true;
    };

    const silenceFrame = Buffer.alloc(OUTPUT_FRAME_BYTES);
    const holdPcm =
      Buffer.isBuffer(options.holdPcm) && options.holdPcm.length
        ? options.holdPcm
        : null;
    const maxFillerMs = Math.min(
      4000,
      Math.max(400, Number(options.maxFillerMs) || 2500)
    );

    const shouldRelease =
      typeof options.shouldRelease === 'function'
        ? options.shouldRelease
        : null;
    let released = false;
    let streamStopped = false;

    try {
      // Hold the button with spoken filler (or silence fallback) while speech builds
      if (holdSilence) {
        let holdOffset = 0;
        const holdStartedAt = Date.now();
        while (!produceDone) {
          if (this.txAbortRequested) {
            transmissionInterrupted = true;
            break;
          }
          if (abortOnFloorLoss && watch.lost) {
            floorLost = watch.lost;
            transmissionInterrupted = true;
            break;
          }
          // Another transmit on this app needs the channel — drop the hold now
          if (shouldRelease && shouldRelease()) {
            released = true;
            transmissionInterrupted = true;
            break;
          }
          if (Date.now() - transmissionStartedAt > maxHoldMs) {
            produceError = new Error(
              'Button hold timed out waiting for speech.'
            );
            break;
          }

          let frame;
          if (
            holdPcm &&
            Date.now() - holdStartedAt < maxFillerMs
          ) {
            // Prefer cutting filler early when main reply is ready (checked via produceDone)
            if (holdOffset >= holdPcm.length) {
              // Chain: restart filler clips until cap, then tiny silence
              holdOffset = 0;
            }
            frame = holdPcm.subarray(
              holdOffset,
              holdOffset + OUTPUT_FRAME_BYTES
            );
            holdOffset += OUTPUT_FRAME_BYTES;
            if (frame.length < OUTPUT_FRAME_BYTES) {
              const padded = Buffer.alloc(OUTPUT_FRAME_BYTES);
              frame.copy(padded, 0);
              frame = padded;
              holdOffset = holdPcm.length; // end of this pass
            }
          } else {
            frame = silenceFrame;
          }

          const ok = await sendFrame(frame);
          if (!ok) {
            if (abortOnFloorLoss) {
              this.markFloorLost({ reason: 'disconnected', error: 'connection dropped' });
              floorLost = watch.lost;
            }
            break;
          }
        }
      }

      // Floor holds never wait out their hold window once cut short (abort / loss / release)
      const skipProduce =
        released ||
        Boolean(floorLost) ||
        (abortOnFloorLoss && transmissionInterrupted);
      if (!skipProduce) {
        await producePromise;
      }

      if (this.txAbortRequested) {
        transmissionInterrupted = true;
      }

      if (produceError && !skipProduce) {
        throw produceError;
      }

      if (
        !transmissionInterrupted &&
        Buffer.isBuffer(pcmBuffer) &&
        pcmBuffer.length
      ) {
        for (
          let offset = 0;
          offset < pcmBuffer.length;
          offset += OUTPUT_FRAME_BYTES
        ) {
          if (this.txAbortRequested) {
            transmissionInterrupted = true;
            break;
          }
          if (abortOnFloorLoss && watch.lost) {
            floorLost = watch.lost;
            transmissionInterrupted = true;
            break;
          }
          const slice = pcmBuffer.subarray(
            offset,
            offset + OUTPUT_FRAME_BYTES
          );
          const ok = await sendFrame(slice);
          if (!ok) break;
        }
      } else if (
        !transmissionInterrupted &&
        (!Buffer.isBuffer(pcmBuffer) || !pcmBuffer.length)
      ) {
        // Nothing to say — release after brief silence already sent
      }

      if (
        this.audioPipelineService &&
        typeof this.audioPipelineService
          .setOutputLevel === 'function'
      ) {
        this.audioPipelineService.setOutputLevel(0);
      }

      streamStopped = true;
      const stopping = this.requestCommand({
        command: 'stop_stream',
        stream_id: streamId,
        channel: channelName
      }).catch(() => {
        // Zello documents stop failures as safe to ignore.
      });
      // Re-grabbing callers queue their next start_stream right behind this stop
      if (!floorLost && options.fastStop !== true) {
        await stopping;
      }
    } finally {
      if (this.outgoing === watch) {
        this.outgoing = null;
      }
      if (!streamStopped) {
        // Errored mid-hold — still let go of the button on Zello's side
        this.requestCommand({
          command: 'stop_stream',
          stream_id: streamId,
          channel: channelName
        }).catch(() => {});
      }
      try {
        encoder.delete();
      } catch {
        // Ignore Opus cleanup failure.
      }

      this.txAbortRequested = false;

      this.setState({
        transmitting: false
      });
    }

    return {
      success: true,
      streamId,
      interrupted: transmissionInterrupted === true,
      released,
      held: holdSilence === true,
      floorLost,
      lostSignal: watch.lost
    };
  }

  /**
   * Push-to-talk stream fed while it runs. feed.take() returns the next
   * 20 ms PCM frame or null (silence is sent to keep timing); feed.isFinished()
   * ends the stream. options.maxMs caps the transmission.
   *
   * DJ mode extras: options.streamId (a stream already won), sampleRate
   * (Opus rate, frames are 20 ms at that rate), music (Opus AUDIO mode),
   * bitrate, abortOnFloorLoss, shouldRelease(), fastStop.
   */
  async sendPcmLive(feed, options = {}) {
    if (this.anonymousListen || this.state.anonymousListen) {
      throw new Error(
        'Anonymous listen mode cannot transmit. Turn it off on Live and reconnect.'
      );
    }
    if (this.state.status !== 'connected') {
      throw new Error('Zello is not connected.');
    }
    const maxMs = Math.min(120000, Math.max(1000, Number(options.maxMs) || 60000));
    const channelName =
      this.state.channelName ||
      this.settingsStore.read().zello.channelName;
    const sampleRate = OPUS_RATES.includes(Number(options.sampleRate))
      ? Number(options.sampleRate)
      : OUTPUT_SAMPLE_RATE;
    const customRate = sampleRate !== OUTPUT_SAMPLE_RATE;
    const frameSamples = (sampleRate * OUTPUT_FRAME_DURATION_MS) / 1000;
    const frameBytes = frameSamples * 2;

    const startResponse = Number.isInteger(options.streamId)
      ? { stream_id: options.streamId }
      : await this.requestCommand({
        command: 'start_stream',
        channel: channelName,
        type: 'audio',
        codec: 'opus',
        codec_header: customRate
          ? this.createOutputCodecHeader(sampleRate, OUTPUT_FRAME_DURATION_MS)
          : this.createOutputCodecHeader(),
        packet_duration: OUTPUT_FRAME_DURATION_MS
      });
    if (!Number.isInteger(startResponse.stream_id)) {
      throw new Error('Zello did not return an outgoing stream ID.');
    }
    const streamId = startResponse.stream_id;

    const abortOnFloorLoss = options.abortOnFloorLoss === true;
    const watch = { streamId, lost: null };
    if (abortOnFloorLoss) this.outgoing = watch;
    const shouldRelease =
      typeof options.shouldRelease === 'function' ? options.shouldRelease : null;

    if (typeof options.onStarted === 'function') {
      try {
        options.onStarted(streamId);
      } catch {
        /* ignore */
      }
    }

    const encoder = new OpusScript(
      sampleRate,
      1,
      options.music === true ? OpusScript.Application.AUDIO : OpusScript.Application.VOIP
    );
    if (Number(options.bitrate) > 0) {
      try {
        encoder.setBitrate(Math.round(Number(options.bitrate)));
      } catch {
        // Keep the encoder default.
      }
    }
    const socket = this.socket;
    const silence = Buffer.alloc(frameBytes);
    const startedAt = Date.now();
    let frames = 0;
    let voiced = 0;
    let interrupted = false;
    let capped = false;
    let released = false;
    let floorLost = null;

    this.txAbortRequested = false;
    this.setState({ transmitting: true });

    try {
      while (!feed.isFinished()) {
        if (this.txAbortRequested) {
          interrupted = true;
          break;
        }
        if (abortOnFloorLoss && watch.lost) {
          floorLost = watch.lost;
          interrupted = true;
          break;
        }
        if (shouldRelease && shouldRelease()) {
          released = true;
          break;
        }
        if (Date.now() - startedAt >= maxMs) {
          capped = true;
          break;
        }
        if (!this.socket || this.socket !== socket || socket.readyState !== WebSocket.OPEN) {
          interrupted = true;
          if (abortOnFloorLoss) {
            this.markFloorLost({ reason: 'disconnected', error: 'connection dropped' });
            floorLost = watch.lost;
          }
          break;
        }

        let frame = feed.take();
        if (frame && frame.length) {
          voiced += 1;
          if (frame.length < frameBytes) {
            const padded = Buffer.alloc(frameBytes);
            frame.copy(padded, 0);
            frame = padded;
          }
        } else {
          frame = silence;
        }
        this.audioPipelineService?.setOutputPcmLevel?.(frame);

        const encoded = Buffer.from(encoder.encode(frame, frameSamples));
        const packet = Buffer.alloc(9 + encoded.length);
        packet.writeUInt8(0x01, 0);
        packet.writeUInt32BE(streamId, 1);
        packet.writeUInt32BE(0, 5);
        encoded.copy(packet, 9);
        socket.send(packet, { binary: true });
        frames += 1;

        const waitMs = startedAt + frames * OUTPUT_FRAME_DURATION_MS - Date.now();
        if (waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }
    } finally {
      if (this.outgoing === watch) this.outgoing = null;
      this.audioPipelineService?.setOutputLevel?.(0);
      const stopping = this.requestCommand({
        command: 'stop_stream',
        stream_id: streamId,
        channel: channelName
      }).catch(() => {
        // Zello documents stop failures as safe to ignore.
      });
      // A re-grab queues its start_stream right behind this stop
      if (options.fastStop !== true && !floorLost) await stopping;
      try {
        encoder.delete();
      } catch {
        // Ignore Opus cleanup failure.
      }
      this.txAbortRequested = false;
      this.setState({ transmitting: false });
    }

    return {
      success: true,
      streamId,
      interrupted,
      capped,
      released,
      floorLost,
      framesSent: frames,
      voicedFrames: voiced,
      durationMs: frames * OUTPUT_FRAME_DURATION_MS
    };
  }

  async disconnect() {
    this.clearConnectTimer();

    const socket =
      this.socket;

    this.socket = null;

    this.rejectAllPending(
      new Error(
        'Connection cancelled.'
      )
    );

    this.rejectPendingConnection(
      new Error(
        'Connection cancelled.'
      )
    );

    if (
      this.audioPipelineService
    ) {
      this.audioPipelineService
        .clearActiveStreams();
    }

    if (socket) {
      try {
        socket.close(
          1000,
          'User disconnected'
        );
      } catch {
        try {
          socket.terminate();
        } catch {
          // Ignore cleanup failure.
        }
      }
    }

    return this.setState({
      status: 'disconnected',
      channelStatus:
        'offline',
      usersOnline: 0,
      transmitting: false,
      lastError: ''
    });
  }

  rejectAllPending(error) {
    for (
      const [
        seq,
        pending
      ] of
      this.pendingRequests
    ) {
      clearTimeout(
        pending.timer
      );

      pending.reject(
        error
      );

      this.pendingRequests
        .delete(seq);
    }
  }

  failConnection(message) {
    this.clearConnectTimer();

    const socket =
      this.socket;

    this.socket = null;

    const error =
      new Error(
        message ||
        'Unable to connect to Zello.'
      );

    this.setState({
      status: 'error',
      transmitting: false,
      lastError:
        error.message
    });

    this.rejectAllPending(
      error
    );

    this.rejectPendingConnection(
      error
    );

    if (socket) {
      try {
        socket.terminate();
      } catch {
        // Ignore cleanup failure.
      }
    }
  }

  resolvePendingConnection(status) {
    const resolve =
      this.connectResolve;

    this.connectResolve = null;
    this.connectReject = null;
    this.connectPromise = null;

    if (resolve) {
      resolve(status);
    }
  }

  rejectPendingConnection(error) {
    const reject =
      this.connectReject;

    this.connectResolve = null;
    this.connectReject = null;
    this.connectPromise = null;

    if (reject) {
      reject(error);
    }
  }

  clearConnectTimer() {
    if (!this.connectTimer) {
      return;
    }

    clearTimeout(
      this.connectTimer
    );

    this.connectTimer = null;
  }

  cleanupSocket() {
    this.clearConnectTimer();

    const socket =
      this.socket;

    this.socket = null;

    this.rejectAllPending(
      new Error(
        'Connection reset.'
      )
    );

    if (socket) {
      try {
        socket.terminate();
      } catch {
        // Ignore stale socket cleanup.
      }
    }

    if (
      this.audioPipelineService
    ) {
      this.audioPipelineService
        .clearActiveStreams();
    }

    this.connectResolve = null;
    this.connectReject = null;
    this.connectPromise = null;
  }
}

module.exports = {
  ZelloRuntimeService,
  ZELLO_SERVER_URL
};
