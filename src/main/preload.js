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

  llm: {
    resolve: () =>
      ipcRenderer.invoke('llm:resolve'),
    snapshot: (options) =>
      ipcRenderer.invoke('llm:snapshot', options || {}),
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
