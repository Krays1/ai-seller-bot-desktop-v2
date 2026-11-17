const {
  contextBridge,
  ipcRenderer
} = require('electron');

contextBridge.exposeInMainWorld('zelloBot', {
  appName: 'AI Seller Bot Desktop v2',
  platform: process.platform,

  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },

  settings: {
    get: () =>
      ipcRenderer.invoke('settings:get'),

    save: (settings) =>
      ipcRenderer.invoke(
        'settings:save',
        settings
      )
  },

  conversations: {
    list: () =>
      ipcRenderer.invoke(
        'conversations:list'
      ),

    get: (conversationId) =>
      ipcRenderer.invoke(
        'conversations:get',
        conversationId
      ),

    sendMessage: (
      conversationId,
      text
    ) =>
      ipcRenderer.invoke(
        'conversations:send-message',
        conversationId,
        text
      )
  },

  leads: {
    list: () =>
      ipcRenderer.invoke('leads:list'),

    get: (profileId) =>
      ipcRenderer.invoke(
        'leads:get',
        profileId
      ),

    getByConversation: (
      conversationId
    ) =>
      ipcRenderer.invoke(
        'leads:get-by-conversation',
        conversationId
      ),

    update: (
      profileId,
      changes
    ) =>
      ipcRenderer.invoke(
        'leads:update',
        profileId,
        changes
      ),

    createFromConversation: (
      conversationId
    ) =>
      ipcRenderer.invoke(
        'leads:create-from-conversation',
        conversationId
      )

  },

  zelloRuntime: {
    status: () =>
      ipcRenderer.invoke(
        'zello:status'
      ),

    connect: () =>
      ipcRenderer.invoke(
        'zello:connect'
      ),

    disconnect: () =>
      ipcRenderer.invoke(
        'zello:disconnect'
      ),

    setConstantRequests: (payload) =>
      ipcRenderer.invoke(
        'zello:constant-requests',
        payload || {}
      )
  },

  audio: {
    status: () =>
      ipcRenderer.invoke(
        'audio:status'
      ),

    onLevels: (callback) => {
      if (
        typeof callback !== 'function'
      ) {
        return () => {};
      }

      const listener =
        (_event, levels) => {
          callback(levels);
        };

      ipcRenderer.on(
        'audio:levels',
        listener
      );

      return () => {
        ipcRenderer.removeListener(
          'audio:levels',
          listener
        );
      };
    }
  },

  system: {
    status: () =>
      ipcRenderer.invoke(
        'system:status'
      )
  },

  voiceChanger: {
    info: () => ipcRenderer.invoke('voice-changer:info'),
    health: () => ipcRenderer.invoke('voice-changer:health'),
    start: (opts) => ipcRenderer.invoke('voice-changer:start', opts || {}),
    pushPcm: (sessionId, bytes) =>
      ipcRenderer.send('voice-changer:pcm', sessionId, bytes),
    stop: (sessionId) => ipcRenderer.invoke('voice-changer:stop', sessionId),
    savePrefs: (prefs) => ipcRenderer.invoke('voice-changer:save-prefs', prefs || {}),
    openFolder: () => ipcRenderer.invoke('voice-changer:open-folder'),
    onStatus: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, status) => callback(status);
      ipcRenderer.on('voice-changer:status', listener);
      return () => ipcRenderer.removeListener('voice-changer:status', listener);
    },
    onOutput: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, pcm) => callback(pcm);
      ipcRenderer.on('voice-changer:output', listener);
      return () => ipcRenderer.removeListener('voice-changer:output', listener);
    }
  },

  dj: {
    info: (opts) => ipcRenderer.invoke('dj:info', opts || {}),
    status: () => ipcRenderer.invoke('dj:status'),
    start: (opts) => ipcRenderer.invoke('dj:start', opts || {}),
    stop: () => ipcRenderer.invoke('dj:stop'),
    pushPcm: (sessionId, bytes) => ipcRenderer.send('dj:pcm', sessionId, bytes),
    setSource: (source) => ipcRenderer.invoke('dj:set-source', source),
    say: (payload) => ipcRenderer.invoke('dj:say', payload || {}),
    cancelLine: (id) => ipcRenderer.invoke('dj:cancel-line', id),
    savePrefs: (prefs) => ipcRenderer.invoke('dj:save-prefs', prefs || {}),
    addSong: (query) => ipcRenderer.invoke('dj:add-song', query),
    addFile: () => ipcRenderer.invoke('dj:add-file'),
    skip: () => ipcRenderer.invoke('dj:skip'),
    onStatus: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, status) => callback(status);
      ipcRenderer.on('dj:status', listener);
      return () => ipcRenderer.removeListener('dj:status', listener);
    }
  },

  llm: {
    resolve: () =>
      ipcRenderer.invoke('llm:resolve'),
    snapshot: (options) =>
      ipcRenderer.invoke('llm:snapshot', options || {}),
    models: (options) =>
      ipcRenderer.invoke('llm:models', options || {}),
    clearCache: () =>
      ipcRenderer.invoke('llm:clear-cache')
  },

  voiceBot: {
    status: () =>
      ipcRenderer.invoke(
        'voice-bot:status'
      ),

    omnivoiceHealth: () =>
      ipcRenderer.invoke(
        'voice-bot:omnivoice-health'
      ),

    sttHealth: () =>
      ipcRenderer.invoke(
        'voice-bot:stt-health'
      ),

    omnivoiceVoices: () =>
      ipcRenderer.invoke(
        'voice-bot:omnivoice-voices'
      ),

    speakText: (payload) =>
      ipcRenderer.invoke(
        'voice-bot:speak-text',
        payload
      ),

    onStatusChanged: (callback) => {
      if (typeof callback !== 'function') {
        return () => {};
      }
      const listener = (_event, status) => {
        callback(status);
      };
      ipcRenderer.on(
        'voice-bot:status-changed',
        listener
      );
      return () => {
        ipcRenderer.removeListener(
          'voice-bot:status-changed',
          listener
        );
      };
    }
  }
});
