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
    this.textMessageHandler = null;
    this.imageMessageHandler = null;
    /** @type {Map<number, { messageId: number, channel: string, from: string, thumbnail: Buffer|null, full: Buffer|null, startedAt: number }>} */
    this.activeImages = new Map();
    this._imageFinalizeTimers = new Map();

    this.state = {
      status: 'disconnected',
      channelName: '',
      botUsername: '',
      channelStatus: 'offline',
      usersOnline: 0,
      transmitting: false,
      lastError: '',
      lastEventAt:
        new Date().toISOString()
    };
  }

  setForeignStreamStartHandler(handler) {
    this.foreignStreamStartHandler =
      typeof handler === 'function' ? handler : null;
  }

  setTextMessageHandler(handler) {
    this.textMessageHandler =
      typeof handler === 'function' ? handler : null;
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
    if (
      override &&
      typeof override === 'object' &&
      override.channelName &&
      override.botUsername &&
      override.password &&
      override.token
    ) {
      return {
        channelName: String(override.channelName).trim(),
        botUsername: String(override.botUsername).trim(),
        password: String(override.password),
        token: String(override.token).trim()
      };
    }

    const settings =
      this.settingsStore.read();

    const zello =
      settings &&
      settings.zello &&
      typeof settings.zello ===
        'object'
        ? settings.zello
        : {};

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

    if (!token) {
      throw new Error(
        'No Zello authentication token is configured.'
      );
    }

    return {
      channelName,
      botUsername,
      password,
      token
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

              socket.send(
                JSON.stringify({
                  command: 'logon',
                  seq:
                    this.nextSequence(),

                  auth_token:
                    credentials.token,

                  username:
                    credentials
                      .botUsername,

                  password:
                    credentials.password,

                  channels: [
                    credentials
                      .channelName
                  ],

                  features: {
                    transcriptions:
                      true
                  },

                  version: '2.0',
                  platform_type:
                    'desktop',

                  platform_name:
                    'Zello Bot Desktop 2.0'
                })
              );
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

      if (
        typeof this.foreignStreamStartHandler ===
        'function'
      ) {
        try {
          this.foreignStreamStartHandler(
            message.from
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

  createOutputCodecHeader() {
    const header =
      Buffer.alloc(4);

    header.writeUInt16LE(
      OUTPUT_SAMPLE_RATE,
      0
    );

    header.writeUInt8(
      1,
      2
    );

    header.writeUInt8(
      60,
      3
    );

    return header.toString(
      'base64'
    );
  }

  async sendPcmAudio(
    pcmBuffer
  ) {
    if (
      !Buffer.isBuffer(pcmBuffer) ||
      !pcmBuffer.length
    ) {
      throw new Error('No PCM audio was provided.');
    }

    return this.sendPcmHoldingWhile(
      async () => pcmBuffer,
      { holdSilence: false }
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

    if (
      this.state.channelStatus !==
        'online'
    ) {
      throw new Error(
        'Zello channel is not ready.'
      );
    }

    const settings =
      this.settingsStore.read();

    const channelName =
      settings.zello.channelName;

    const startResponse =
      await this.requestCommand({
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
          if (!ok) break;
        }
      }

      await producePromise;

      if (this.txAbortRequested) {
        transmissionInterrupted = true;
      }

      if (produceError) {
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

      try {
        await this.requestCommand({
          command: 'stop_stream',
          stream_id: streamId,
          channel: channelName
        });
      } catch {
        // Zello documents stop failures as safe to ignore.
      }
    } finally {
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
      held: holdSilence === true
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
