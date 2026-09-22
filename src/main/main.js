const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

// Product display name; keep userData path so existing settings stay put
app.setName('Bot Desktop V2');
app.setPath(
  'userData',
  path.join(app.getPath('appData'), 'ai-seller-bot-desktop-v2')
);

const { SettingsStore } = require('../services/settings-store');
const { ConversationStore } = require('../services/conversation-store');
const { LeadStore } = require('../services/lead-store');
const { MultiBotRuntime } = require('../services/multi-bot-runtime');
const { AudioPipelineService } = require('../services/audio-pipeline-service');
const { VoiceBotService } = require('../services/voice-bot-service');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync =
  promisify(execFile);

function captureCpuTimes() {
  let idle = 0;
  let total = 0;

  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;

    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }

  return {
    idle,
    total
  };
}

let previousCpuTimes =
  captureCpuTimes();

function readCpuUsagePercent() {
  const current =
    captureCpuTimes();

  const totalDelta =
    current.total -
    previousCpuTimes.total;

  const idleDelta =
    current.idle -
    previousCpuTimes.idle;

  previousCpuTimes =
    current;

  if (totalDelta <= 0) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (
          1 -
          idleDelta /
          totalDelta
        ) *
        100
      )
    )
  );
}

function numberOrNull(value) {
  const parsed =
    Number.parseFloat(
      String(
        value ?? ''
      ).trim()
    );

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

let cachedGpuStatus = {
  at: 0,
  value: {
    available: false
  }
};

async function readGpuStatus() {
  const now =
    Date.now();

  if (
    now -
    cachedGpuStatus.at <
    1800
  ) {
    return cachedGpuStatus.value;
  }

  const fields = [
    'name',
    'utilization.gpu',
    'temperature.gpu',
    'memory.used',
    'memory.total',
    'driver_version',
    'power.draw',
    'fan.speed',
    'clocks.current.graphics',
    'clocks.current.memory'
  ];

  try {
    const {
      stdout
    } =
      await execFileAsync(
        'nvidia-smi',
        [
          '--query-gpu=' +
            fields.join(','),
          '--format=csv,noheader,nounits'
        ],
        {
          windowsHide: true,
          timeout: 1800,
          maxBuffer:
            1024 * 1024
        }
      );

    const line =
      String(stdout || '')
        .trim()
        .split(/\r?\n/)[0];

    if (!line) {
      throw new Error(
        'No NVIDIA GPU data.'
      );
    }

    const values =
      line
        .split(',')
        .map(
          (value) =>
            value.trim()
        );

    const value = {
      available: true,
      name:
        values[0] || 'NVIDIA GPU',

      utilizationPercent:
        numberOrNull(
          values[1]
        ),

      temperatureC:
        numberOrNull(
          values[2]
        ),

      memoryUsedMb:
        numberOrNull(
          values[3]
        ),

      memoryTotalMb:
        numberOrNull(
          values[4]
        ),

      driver:
        values[5] || '',

      powerWatts:
        numberOrNull(
          values[6]
        ),

      fanPercent:
        numberOrNull(
          values[7]
        ),

      graphicsClockMhz:
        numberOrNull(
          values[8]
        ),

      memoryClockMhz:
        numberOrNull(
          values[9]
        )
    };

    cachedGpuStatus = {
      at: now,
      value
    };

    return value;
  } catch {
    const value = {
      available: false
    };

    cachedGpuStatus = {
      at: now,
      value
    };

    return value;
  }
}

async function getSystemStatus() {
  const cpus =
    os.cpus();

  const totalMemory =
    os.totalmem();

  const freeMemory =
    os.freemem();

  const usedMemory =
    Math.max(
      0,
      totalMemory -
      freeMemory
    );

  const memoryUsagePercent =
    totalMemory > 0
      ? Math.round(
          usedMemory /
          totalMemory *
          100
        )
      : 0;

  return {
    timestamp:
      Date.now(),

    cpu: {
      model:
        cpus[0]
          ? cpus[0].model
          : 'Unknown processor',

      logicalCores:
        cpus.length,

      usagePercent:
        readCpuUsagePercent()
    },

    memory: {
      totalBytes:
        totalMemory,

      usedBytes:
        usedMemory,

      freeBytes:
        freeMemory,

      usagePercent:
        memoryUsagePercent
    },

    gpu:
      await readGpuStatus()
  };
}

let mainWindow = null;
let settingsStore = null;
let conversationStore = null;
let leadStore = null;
let zelloRuntimeService = null;
let audioPipelineService = null;
let voiceBotService = null;
/** Serialize settings saves so rapid Join toggles don't race connect/disconnect. */
let settingsSaveQueue = Promise.resolve();

function botsConnectionFingerprint(settings) {
  const bots = Array.isArray(settings?.bots) ? settings.bots : [];
  const joined = bots
    .filter((b) => b && b.enabled !== false)
    .map((b) =>
      [
        String(b.id || ''),
        String(b.username || ''),
        String(b.password || ''),
        String(b.token || ''),
        String(b.channelName || '')
      ].join('|')
    )
    .sort()
    .join(';');
  const primary =
    typeof settings?.zello?.channelName === 'string'
      ? settings.zello.channelName.trim()
      : '';
  const names = Array.isArray(settings?.zello?.channelNames)
    ? settings.zello.channelNames.map((c) => String(c || '').trim()).filter(Boolean).join(',')
    : '';
  return joined + '#' + primary + '#' + names;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Bot Desktop V2',
    backgroundColor: '#0c1219',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(
    path.join(__dirname, '..', 'renderer', 'index.html')
  );

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.handle('settings:get', () => {
    return settingsStore.read();
  });

  ipcMain.handle('settings:save', async (_event, settings) => {
    const run = async () => {
      const before = settingsStore.read();
      const beforeFp = botsConnectionFingerprint(before);
      const result = settingsStore.write(settings);
      const afterFp = botsConnectionFingerprint(result);

      if (
        voiceBotService &&
        typeof voiceBotService.syncNameCallEngagementWithSettings ===
          'function'
      ) {
        voiceBotService.syncNameCallEngagementWithSettings();
      }

      // Speak / Name alone must not churn Zello connections
      if (
        afterFp !== beforeFp &&
        zelloRuntimeService &&
        typeof zelloRuntimeService.syncRosterConnections ===
          'function'
      ) {
        try {
          await zelloRuntimeService.syncRosterConnections({
            forceReconnectMismatch: true
          });
        } catch {
          /* ignore hot-sync errors while idle/disconnected */
        }
      }

      return result;
    };

    const queued = settingsSaveQueue.then(run, run);
    settingsSaveQueue = queued.catch(() => {});
    return queued;
  });

  ipcMain.handle('conversations:list', () => {
    return conversationStore.readAll();
  });

  ipcMain.handle('conversations:get', (_event, conversationId) => {
    return conversationStore.getById(conversationId);
  });

  ipcMain.handle(
    'conversations:send-message',
    (_event, conversationId, text) => {
      return conversationStore.sendMessage(
        conversationId,
        text
      );
    }
  );

  ipcMain.handle('leads:list', () => {
    return leadStore.readAll();
  });

  ipcMain.handle('leads:get', (_event, profileId) => {
    return leadStore.getById(profileId);
  });

  ipcMain.handle(
    'leads:get-by-conversation',
    (_event, conversationId) => {
      return leadStore.getByConversationId(
        conversationId
      );
    }
  );

  ipcMain.handle(
    'leads:update',
    (_event, profileId, changes) => {
      return leadStore.update(profileId, changes);
    }
  );

  ipcMain.handle(
    'leads:create-from-conversation',
    (_event, conversationId) => {
      const conversation =
        conversationStore.getById(conversationId);

      if (!conversation) {
        throw new Error('Conversation not found.');
      }

      return leadStore.createFromConversation(
        conversation
      );
    }
  );


  ipcMain.handle('zello:status', () => {
    return zelloRuntimeService.getStatus();
  });

  ipcMain.handle('zello:connect', async () => {
    return zelloRuntimeService.connect();
  });

  ipcMain.handle('zello:disconnect', async () => {
    return zelloRuntimeService.disconnect();
  });

  ipcMain.handle('audio:status', () => {
    return audioPipelineService.getStatus();
  });

  ipcMain.handle('voice-bot:status', () => {
    return voiceBotService.getStatus();
  });

  ipcMain.handle('voice-bot:omnivoice-health', async () => {
    return voiceBotService.getOmniVoiceHealth();
  });

  ipcMain.handle('voice-bot:stt-health', async () => {
    return voiceBotService.getSttHealth();
  });

  ipcMain.handle('voice-bot:omnivoice-voices', async () => {
    return voiceBotService.listOmniVoiceVoices();
  });

  ipcMain.handle(
    'voice-bot:speak-text',
    async (_event, payload) => {
      return voiceBotService.speakTextAsBot(
        payload || {}
      );
    }
  );

  ipcMain.handle('llm:resolve', async () => {
    const {
      getBrainSnapshot
    } = require('../services/llm-host');

    const settings = settingsStore.read();
    return getBrainSnapshot(settings.ai || {});
  });

  ipcMain.handle('llm:snapshot', async (_event, options) => {
    const {
      getBrainSnapshot
    } = require('../services/llm-host');

    const settings = settingsStore.read();
    return getBrainSnapshot(settings.ai || {}, options || {});
  });

  ipcMain.handle('llm:clear-cache', async () => {
    const {
      clearLlmHostCache
    } = require('../services/llm-host');
    clearLlmHostCache();
    return { ok: true };
  });

  ipcMain.handle('system:status', async () => {
    return getSystemStatus();
  });
}

app.whenReady().then(() => {
  settingsStore =
    new SettingsStore(app.getPath('userData'));

  conversationStore =
    new ConversationStore(app.getPath('userData'));

  leadStore =
    new LeadStore(app.getPath('userData'));

  audioPipelineService =
    new AudioPipelineService();

  audioPipelineService
    .setLevelHandler(
      (levels) => {
        if (
          !mainWindow ||
          mainWindow.isDestroyed() ||
          !mainWindow.webContents ||
          mainWindow.webContents.isDestroyed()
        ) {
          return;
        }

        mainWindow.webContents.send(
          'audio:levels',
          levels
        );
      }
    );

  zelloRuntimeService =
    new MultiBotRuntime(
      settingsStore,
      audioPipelineService
    );

  voiceBotService =
    new VoiceBotService({
      settingsStore,
      leadStore,
      zelloRuntimeService,
      audioPipelineService
    });

  if (
    typeof voiceBotService.setStatusListener ===
    'function'
  ) {
    voiceBotService.setStatusListener((status) => {
      if (
        !mainWindow ||
        mainWindow.isDestroyed() ||
        !mainWindow.webContents ||
        mainWindow.webContents.isDestroyed()
      ) {
        return;
      }
      mainWindow.webContents.send(
        'voice-bot:status-changed',
        status
      );
    });
  }

  audioPipelineService
    .setCompletedHandler(
      (stream) =>
        voiceBotService
          .handleCompletedStream(
            stream
          )
    );

  if (
    typeof audioPipelineService.setStreamStartHandler ===
    'function'
  ) {
    audioPipelineService.setStreamStartHandler((info) => {
      const who = info?.from || 'someone';
      const ch = info?.channel ? ' on ' + info.channel : '';
      voiceBotService.logActivity(
        'Audio',
        'Hearing ' + who + ch + '…'
      );
    });
  }

  if (
    typeof zelloRuntimeService.setTextMessageHandler ===
    'function'
  ) {
    zelloRuntimeService.setTextMessageHandler((msg) =>
      voiceBotService.handleChannelTextMessage(msg)
    );
  }

  if (
    typeof zelloRuntimeService.setImageMessageHandler ===
    'function'
  ) {
    zelloRuntimeService.setImageMessageHandler((msg) =>
      voiceBotService.handleIncomingImage(msg)
    );
  }

  registerIpcHandlers();
  createMainWindow();

  // Warm STT / OmniVoice / Other PC brain in background
  voiceBotService.warmServices().catch(() => {});

  app.on('activate', () => {
    if (
      BrowserWindow.getAllWindows().length === 0
    ) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
