const navigationItems = document.querySelectorAll('.nav-item');
const dashboardSection = document.getElementById('dashboard-section');
const conversationsSection = document.getElementById('conversations-section');
const leadsSection = document.getElementById('leads-section');
const placeholderSection = document.getElementById('placeholder-section');
const pageTitle = document.getElementById('page-title');
const placeholderTitle = document.getElementById('placeholder-title');
const placeholderCopy = document.getElementById('placeholder-copy');
const runtimeLabel = document.getElementById('runtime-label');
const appStatus = document.getElementById('app-status');

const settingsSection =
  document.getElementById('settings-section');

const zelloChannelForm =
  document.getElementById('zello-channel-form');

const zelloCredentialsForm =
  document.getElementById('zello-credentials-form');

const zelloChannelName =
  document.getElementById('zello-channel-name');

const zelloChannelPick =
  document.getElementById('zello-channel-pick');

const zelloBotPick =
  document.getElementById('zello-bot-pick');

const zelloBotUsername =
  document.getElementById('zello-bot-username');

const zelloPassword =
  document.getElementById('zello-password');

const zelloToken =
  document.getElementById('zello-token');

const zelloPasswordToggle =
  document.getElementById('zello-password-toggle');

const zelloTokenToggle =
  document.getElementById('zello-token-toggle');

const zelloChannelSaveButton =
  document.getElementById('zello-channel-save-button');

const zelloCredentialsSaveButton =
  document.getElementById('zello-credentials-save-button');

const zelloChannelState =
  document.getElementById('zello-channel-state');

const zelloCredentialsState =
  document.getElementById('zello-credentials-state');

const zelloSummaryChannel =
  document.getElementById('zello-summary-channel');

const zelloSummaryBot =
  document.getElementById('zello-summary-bot');

const zelloSummaryPassword =
  document.getElementById('zello-summary-password');

const zelloSummaryToken =
  document.getElementById('zello-summary-token');

const zelloReadyTitle =
  document.getElementById('zello-ready-title');

const zelloReadyCopy =
  document.getElementById('zello-ready-copy');

const zelloConnectButton =
  document.getElementById('zello-connect-button');

const zelloDisconnectButton =
  document.getElementById('zello-disconnect-button');

const zelloRuntimeStatus =
  document.getElementById('zello-runtime-status');

const zelloRuntimeError =
  document.getElementById('zello-runtime-error');

const audioPipelineState =
  document.getElementById('audio-pipeline-state');

const voiceVuNeedle =
  document.getElementById('voice-vu-needle');

const botVuNeedle =
  document.getElementById('bot-vu-needle');

const audioLedInput =
  document.getElementById('audio-led-input');

const audioLedOutput =
  document.getElementById('audio-led-output');

const audioCurrentSpeaker =
  document.getElementById('audio-current-speaker');

const audioPacketCount =
  document.getElementById('audio-packet-count');

const audioByteCount =
  document.getElementById('audio-byte-count');

const audioStreamCount =
  document.getElementById('audio-stream-count');

const audioLastSpeaker =
  document.getElementById('audio-last-speaker');

const audioLastDetails =
  document.getElementById('audio-last-details');

const voiceEngineForm =
  document.getElementById('voice-engine-form');

const rpIdentityName =
  document.getElementById('rp-identity-name');

const ollamaUrl =
  document.getElementById('ollama-url');

const ollamaModel =
  document.getElementById('ollama-model');

const llmHostMode =
  document.getElementById('llm-host-mode');

const ollamaUrlThisPc =
  document.getElementById('ollama-url-this-pc');

const ollamaUrlOtherPc =
  document.getElementById('ollama-url-other-pc');

const llmHostStatus =
  document.getElementById('llm-host-status');

const fordMood =
  document.getElementById('ford-mood');

const sttUrl =
  document.getElementById('stt-url');

const omnivoiceUrl =
  document.getElementById('omnivoice-url');

const omnivoiceVoice =
  document.getElementById('omnivoice-voice');

const customVoiceSelect =
  document.getElementById(
    'custom-voice-select'
  );

const customVoiceSelectButton =
  document.getElementById(
    'custom-voice-select-button'
  );

const customVoiceSelectValue =
  document.getElementById(
    'custom-voice-select-value'
  );

const customVoiceSelectMenu =
  document.getElementById(
    'custom-voice-select-menu'
  );

function closeCustomVoiceSelect() {
  if (
    !customVoiceSelectButton ||
    !customVoiceSelectMenu
  ) {
    return;
  }

  customVoiceSelectMenu.hidden = true;

  customVoiceSelectButton.setAttribute(
    'aria-expanded',
    'false'
  );

  customVoiceSelect?.classList.remove(
    'is-open'
  );
}

function renderCustomVoiceSelect() {
  if (
    !omnivoiceVoice ||
    !customVoiceSelectValue ||
    !customVoiceSelectMenu
  ) {
    return;
  }

  const options =
    Array.from(
      omnivoiceVoice.options
    );

  const selectedOption =
    options.find(
      (option) =>
        option.value ===
        omnivoiceVoice.value
    ) ||
    options[0];

  customVoiceSelectValue.textContent =
    selectedOption
      ? selectedOption.textContent
      : 'Default voice';

  const fragment =
    document.createDocumentFragment();

  options.forEach((option) => {
    const item =
      document.createElement('button');

    item.type = 'button';

    item.className =
      'custom-voice-select-option';

    item.setAttribute(
      'role',
      'option'
    );

    item.setAttribute(
      'aria-selected',
      option.value ===
        omnivoiceVoice.value
        ? 'true'
        : 'false'
    );

    item.dataset.value =
      option.value;

    item.textContent =
      option.textContent;

    if (
      option.value ===
      omnivoiceVoice.value
    ) {
      item.classList.add(
        'is-selected'
      );
    }

    item.addEventListener(
      'click',
      () => {
        omnivoiceVoice.value =
          option.value;

        omnivoiceVoice.dispatchEvent(
          new Event(
            'change',
            {
              bubbles: true
            }
          )
        );

        renderCustomVoiceSelect();
        closeCustomVoiceSelect();

        customVoiceSelectButton?.focus();
      }
    );

    fragment.appendChild(item);
  });

  customVoiceSelectMenu.replaceChildren(
    fragment
  );
}

function openCustomVoiceSelect() {
  if (
    !customVoiceSelectButton ||
    !customVoiceSelectMenu
  ) {
    return;
  }

  renderCustomVoiceSelect();

  customVoiceSelectMenu.hidden =
    false;

  customVoiceSelectButton.setAttribute(
    'aria-expanded',
    'true'
  );

  customVoiceSelect?.classList.add(
    'is-open'
  );

  const selected =
    customVoiceSelectMenu.querySelector(
      '.custom-voice-select-option.is-selected'
    );

  selected?.scrollIntoView({
    block: 'nearest'
  });
}

if (
  customVoiceSelectButton &&
  customVoiceSelectMenu
) {
  customVoiceSelectButton.addEventListener(
    'click',
    () => {
      if (
        customVoiceSelectMenu.hidden
      ) {
        openCustomVoiceSelect();
      } else {
        closeCustomVoiceSelect();
      }
    }
  );

  customVoiceSelectButton.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key === 'ArrowDown' ||
        event.key === 'Enter' ||
        event.key === ' '
      ) {
        event.preventDefault();

        openCustomVoiceSelect();

        const target =
          customVoiceSelectMenu.querySelector(
            '.custom-voice-select-option.is-selected'
          ) ||
          customVoiceSelectMenu.querySelector(
            '.custom-voice-select-option'
          );

        target?.focus();
      }
    }
  );

  customVoiceSelectMenu.addEventListener(
    'keydown',
    (event) => {
      const items =
        Array.from(
          customVoiceSelectMenu.querySelectorAll(
            '.custom-voice-select-option'
          )
        );

      const currentIndex =
        items.indexOf(
          document.activeElement
        );

      if (
        event.key === 'ArrowDown'
      ) {
        event.preventDefault();

        const nextIndex =
          currentIndex < 0
            ? 0
            : Math.min(
                currentIndex + 1,
                items.length - 1
              );

        items[nextIndex]?.focus();
      }

      if (
        event.key === 'ArrowUp'
      ) {
        event.preventDefault();

        const previousIndex =
          currentIndex < 0
            ? 0
            : Math.max(
                currentIndex - 1,
                0
              );

        items[previousIndex]?.focus();
      }

      if (
        event.key === 'Escape'
      ) {
        event.preventDefault();

        closeCustomVoiceSelect();
        customVoiceSelectButton.focus();
      }
    }
  );

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (
        customVoiceSelect &&
        !customVoiceSelect.contains(
          event.target
        )
      ) {
        closeCustomVoiceSelect();
      }
    }
  );
}

if (omnivoiceVoice) {
  omnivoiceVoice.addEventListener(
    'change',
    renderCustomVoiceSelect
  );

  const voiceOptionsObserver =
    new MutationObserver(
      renderCustomVoiceSelect
    );

  voiceOptionsObserver.observe(
    omnivoiceVoice,
    {
      childList: true,
      subtree: true
    }
  );
}

const omnivoiceRefreshButton =
  document.getElementById('omnivoice-refresh-button');

const omnivoiceHealth =
  document.getElementById('omnivoice-health');

const omnivoiceSpeed =
  document.getElementById('omnivoice-speed');

const omnivoiceSteps =
  document.getElementById('omnivoice-steps');

const voiceAutoReply =
  document.getElementById('voice-auto-reply');

const voiceEngineSaveButton =
  document.getElementById('voice-engine-save-button');

const voiceEngineSaveStatus =
  document.getElementById('voice-engine-save-status');

const voiceBotState =
  document.getElementById('voice-bot-state');

const voiceBotSpeaker =
  document.getElementById('voice-bot-speaker');

const voiceBotBehavior =
  document.getElementById('voice-bot-behavior');

const voiceBotTranscript =
  document.getElementById('voice-bot-transcript');

const voiceBotResponse =
  document.getElementById('voice-bot-response');

const voiceBotError =
  document.getElementById('voice-bot-error');

const voiceActivityLog =
  document.getElementById('voice-activity-log');

const voiceActivityCount =
  document.getElementById('voice-activity-count');

let lastVoiceActivityId = 0;
const conversationCount = document.getElementById('conversation-count');
const qualifiedLeadCount = document.getElementById('qualified-lead-count');

const conversationList = document.getElementById('conversation-list');
const threadChannel = document.getElementById('thread-channel');
const threadCustomer = document.getElementById('thread-customer');
const threadStatus = document.getElementById('thread-status');
const threadLeadButton = document.getElementById('thread-lead-button');
const messageList = document.getElementById('message-list');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const sendMessageButton = document.getElementById('send-message-button');

const leadsTableBody = document.getElementById('leads-table-body');
const leadEditor = document.getElementById('lead-editor');
const leadEditorName = document.getElementById('lead-editor-name');
const leadEditorSource = document.getElementById('lead-editor-source');
const leadBehaviorMode = document.getElementById('lead-behavior-mode');
const leadNotes = document.getElementById('lead-notes');
const leadOpenConversationButton = document.getElementById(
  'lead-open-conversation-button'
);
const leadSaveButton = document.getElementById('lead-save-button');

let conversations = [];
let selectedConversationId = null;
let profiles = [];
let selectedProfileId = null;

const sectionContent = {
  dashboard: {
    title: 'Command Center'
  },
  conversations: {
    title: 'Conversations'
  },
  leads: {
    title: 'Behavior Profiles'
  },
  automations: {
    title: 'Automations',
    copy: 'Workflow triggers, actions, and automation controls will appear here.'
  },
  settings: {
    title: 'Settings',
    copy: 'Application configuration, integrations, and account controls are backed by the local settings service.'
  }
};

const behaviorLabels = {
  chat: 'Chat',
  banter: 'Banter',
  roasting: 'Roasting',
  aggressive: 'Aggressive',
  'extreme-aggressive': 'Extreme Aggressive'
};

function hideAllSections() {
  dashboardSection.classList.add('is-hidden');
  conversationsSection.classList.add('is-hidden');
  leadsSection.classList.add('is-hidden');
  settingsSection.classList.add('is-hidden');
  placeholderSection.classList.add('is-hidden');
}

function showSection(sectionName) {
  const section = sectionContent[sectionName];

  if (!section) {
    return;
  }


navigationItems.forEach((item) => {
    item.classList.toggle(
      'is-active',
      item.dataset.section === sectionName
    );
  });

  pageTitle.textContent = section.title;
  hideAllSections();

  if (sectionName === 'dashboard') {
    dashboardSection.classList.remove('is-hidden');
    return;
  }

  if (sectionName === 'conversations') {
    conversationsSection.classList.remove('is-hidden');
    return;
  }

  if (sectionName === 'leads') {
    leadsSection.classList.remove('is-hidden');
    return;
  }

  if (sectionName === 'settings') {
    settingsSection.classList.remove('is-hidden');
    return;
  }

  placeholderSection.classList.remove('is-hidden');
  placeholderTitle.textContent = section.title;
  placeholderCopy.textContent = section.copy;
}

function formatTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function formatListTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const today = new Date();

  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();

  if (sameDay) {
    return formatTime(value);
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  }).format(date);
}

function getLastMessage(conversation) {
  if (!conversation.messages.length) {
    return 'No messages yet';
  }

  return conversation.messages[
    conversation.messages.length - 1
  ].text;
}

function getProfileForConversation(conversationId) {
  if (!conversationId) {
    return null;
  }

  return (
    profiles.find(
      (profile) =>
        profile.conversationId === conversationId
    ) || null
  );
}

function getBehaviorLabel(mode) {
  return behaviorLabels[mode] || 'Chat';
}

function renderConversationList() {
  conversationList.replaceChildren();

  if (!conversations.length) {
    const empty = document.createElement('div');
    empty.className = 'conversation-list-empty';
    empty.textContent = 'No conversations yet.';
    conversationList.appendChild(empty);
    return;
  }

  conversations.forEach((conversation) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'conversation-item';

    button.classList.toggle(
      'is-selected',
      conversation.id === selectedConversationId
    );

    const topRow = document.createElement('span');
    topRow.className = 'conversation-item-top';

    const name = document.createElement('strong');
    name.textContent = conversation.customerName;

    const time = document.createElement('span');
    time.textContent = formatListTime(
      conversation.updatedAt
    );

    topRow.append(name, time);

    const preview = document.createElement('span');
    preview.className = 'conversation-preview';
    preview.textContent = getLastMessage(conversation);

    const profile =
      getProfileForConversation(conversation.id);

    const metadata = document.createElement('span');
    metadata.className = 'conversation-meta';

    metadata.textContent =
      conversation.channel +
      ' \u00b7 ' +
      conversation.status +
      (profile
        ? ' \u00b7 ' +
          getBehaviorLabel(profile.behaviorMode)
        : '');

    button.append(topRow, preview, metadata);

    button.addEventListener('click', () => {
      selectConversation(conversation.id);
    });

    conversationList.appendChild(button);
  });
}

function updateThreadProfileButton(conversation) {
  if (!threadLeadButton) {
    return;
  }

  if (!conversation) {
    threadLeadButton.disabled = true;
    threadLeadButton.textContent = 'Create profile';
    return;
  }

  const profile =
    getProfileForConversation(conversation.id);

  threadLeadButton.disabled = false;

  threadLeadButton.textContent = profile
    ? 'Behavior: ' +
      getBehaviorLabel(profile.behaviorMode)
    : 'Create profile';
}

function renderThread(conversation) {
  messageList.replaceChildren();
  updateThreadProfileButton(conversation);

  if (!conversation) {
    threadChannel.textContent = 'SELECT A THREAD';
    threadCustomer.textContent =
      'No conversation selected';
    threadStatus.textContent = '\u2014';

    messageInput.value = '';
    messageInput.disabled = true;
    sendMessageButton.disabled = true;

    const empty = document.createElement('div');
    empty.className = 'thread-empty';
    empty.textContent =
      'Select a conversation from the inbox.';

    messageList.appendChild(empty);
    return;
  }

  threadChannel.textContent =
    conversation.channel.toUpperCase();

  threadCustomer.textContent =
    conversation.customerName;

  threadStatus.textContent =
    conversation.status;

  messageInput.disabled = false;
  sendMessageButton.disabled = false;

  if (!conversation.messages.length) {
    const empty = document.createElement('div');
    empty.className = 'thread-empty';

    empty.textContent =
      'This conversation has no messages yet.';

    messageList.appendChild(empty);
    return;
  }

  conversation.messages.forEach((message) => {
    const wrapper = document.createElement('div');

    wrapper.className =
      'message-row message-row-' +
      message.direction;

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    const text = document.createElement('p');
    text.textContent = message.text;

    const timestamp = document.createElement('span');
    timestamp.textContent =
      formatTime(message.createdAt);

    bubble.append(text, timestamp);
    wrapper.appendChild(bubble);
    messageList.appendChild(wrapper);
  });

  messageList.scrollTop =
    messageList.scrollHeight;
}

function selectConversation(conversationId) {
  selectedConversationId = conversationId;

  const conversation = conversations.find(
    (item) => item.id === conversationId
  );

  renderConversationList();
  renderThread(conversation || null);
}

async function loadConversations() {
  if (!window.zelloBot?.conversations) {
    return;
  }

  try {
    conversations =
      await window.zelloBot.conversations.list();

    conversationCount.textContent =
      String(conversations.length);

    if (
      selectedConversationId &&
      !conversations.some(
        (item) =>
          item.id === selectedConversationId
      )
    ) {
      selectedConversationId = null;
    }

    if (
      !selectedConversationId &&
      conversations.length
    ) {
      selectedConversationId =
        conversations[0].id;
    }

    renderConversationList();

    const selected = conversations.find(
      (item) =>
        item.id === selectedConversationId
    );

    renderThread(selected || null);
  } catch {
    appStatus.textContent =
      'Conversation Error';
  }
}

function renderProfiles() {
  leadsTableBody.replaceChildren();

  qualifiedLeadCount.textContent =
    String(profiles.length);

  if (!profiles.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');

    cell.colSpan = 4;
    cell.className = 'leads-empty';
    cell.textContent =
      'No behavior profiles yet.';

    row.appendChild(cell);
    leadsTableBody.appendChild(row);
    return;
  }

  profiles.forEach((profile) => {
    const row = document.createElement('tr');

    row.classList.toggle(
      'is-selected',
      profile.id === selectedProfileId
    );

    const person = document.createElement('td');
    person.textContent = profile.customerName;

    const source = document.createElement('td');
    source.textContent = profile.source;

    const behavior = document.createElement('td');

    const badge = document.createElement('span');
    badge.className =
      'behavior-mode behavior-mode-' +
      profile.behaviorMode;

    badge.textContent =
      getBehaviorLabel(profile.behaviorMode);

    behavior.appendChild(badge);

    const updated = document.createElement('td');
    updated.textContent =
      formatListTime(profile.updatedAt);

    row.append(
      person,
      source,
      behavior,
      updated
    );

    row.addEventListener('click', () => {
      selectProfile(profile.id);
    });

    leadsTableBody.appendChild(row);
  });
}

function selectProfile(profileId) {
  selectedProfileId = profileId;

  const profile = profiles.find(
    (item) => item.id === profileId
  );

  renderProfiles();

  if (!profile) {
    leadEditor.classList.add('is-empty');

    leadEditorName.textContent =
      'Select a profile';

    leadEditorSource.textContent =
      'No profile selected';

    if (leadOpenConversationButton) {
      leadOpenConversationButton.disabled = true;
    }

    return;
  }

  leadEditor.classList.remove('is-empty');

  leadEditorName.textContent =
    profile.customerName;

  leadEditorSource.textContent =
    profile.source;

  leadBehaviorMode.value =
    profile.behaviorMode;

  leadNotes.value =
    profile.notes || '';

  if (leadOpenConversationButton) {
    const hasConversation =
      Boolean(profile.conversationId) &&
      conversations.some(
        (conversation) =>
          conversation.id ===
          profile.conversationId
      );

    leadOpenConversationButton.disabled =
      !hasConversation;
  }
}

async function loadProfiles() {
  if (!window.zelloBot?.leads) {
    return;
  }

  try {
    profiles =
      await window.zelloBot.leads.list();

    if (
      selectedProfileId &&
      !profiles.some(
        (profile) =>
          profile.id === selectedProfileId
      )
    ) {
      selectedProfileId = null;
    }

    if (
      !selectedProfileId &&
      profiles.length
    ) {
      selectedProfileId =
        profiles[0].id;
    }

    renderProfiles();
    selectProfile(selectedProfileId);

    const selectedConversation =
      conversations.find(
        (conversation) =>
          conversation.id ===
          selectedConversationId
      );

    if (selectedConversation) {
      updateThreadProfileButton(
        selectedConversation
      );
    }

    renderConversationList();
  } catch {
    appStatus.textContent =
      'Profile Error';
  }
}

async function openOrCreateProfileForConversation() {
  if (
    !selectedConversationId ||
    !window.zelloBot?.leads
  ) {
    return;
  }

  const existing =
    getProfileForConversation(
      selectedConversationId
    );

  if (existing) {
    selectProfile(existing.id);
    showSection('leads');
    return;
  }

  threadLeadButton.disabled = true;
  threadLeadButton.textContent =
    'Creating...';

  try {
    const profile =
      await window.zelloBot.leads
        .createFromConversation(
          selectedConversationId
        );

    await loadProfiles();

    selectProfile(profile.id);
    showSection('leads');

    appStatus.textContent =
      'Desktop Ready';
  } catch {
    appStatus.textContent =
      'Profile Create Failed';

    const conversation =
      conversations.find(
        (item) =>
          item.id === selectedConversationId
      );

    updateThreadProfileButton(
      conversation || null
    );
  }
}

function openConversationForSelectedProfile() {
  const profile = profiles.find(
    (item) =>
      item.id === selectedProfileId
  );

  if (!profile || !profile.conversationId) {
    return;
  }

  const conversation = conversations.find(
    (item) =>
      item.id === profile.conversationId
  );

  if (!conversation) {
    appStatus.textContent =
      'Linked Conversation Missing';
    return;
  }

  selectConversation(conversation.id);
  showSection('conversations');
}

function normalizeZelloSettings(settings) {
  const zello =
    settings &&
    settings.zello &&
    typeof settings.zello === 'object'
      ? settings.zello
      : {};

  const channelName =
    typeof zello.channelName === 'string'
      ? zello.channelName.trim()
      : '';

  const channelNames = [];
  const seen = new Set();
  const push = (value) => {
    const name = String(value || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    channelNames.push(name);
  };

  if (Array.isArray(zello.channelNames)) {
    for (const item of zello.channelNames) {
      if (typeof item === 'string') {
        push(item);
      } else if (item && typeof item === 'object') {
        push(item.name || item.key || '');
      }
    }
  }
  push(channelName);

  return {
    channelName: channelNames[0] || channelName,
    channelNames,
    botUsername:
      typeof zello.botUsername === 'string'
        ? zello.botUsername
        : '',
    password:
      typeof zello.password === 'string'
        ? zello.password
        : '',
    token:
      typeof zello.token === 'string'
        ? zello.token
        : ''
  };
}

function getActiveChannelChoices(settings) {
  const zello = normalizeZelloSettings(settings || {});
  const catalog = Array.isArray(settings?.catalog?.channels)
    ? settings.catalog.channels
    : [];
  const names = [...(zello.channelNames || [])];
  const seen = new Set(names.map((n) => n.toLowerCase()));
  for (const ch of catalog) {
    const name = String(ch?.name || ch?.key || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // Catalog-only names appear in assign lists once ticked; keep pool for dropdowns from active set primarily
  }
  return names;
}

function readChannelMultiSelection() {
  const list = document.getElementById('channel-multi-list');
  if (!list) return [];
  const names = [];
  for (const input of list.querySelectorAll(
    'input.channel-multi-check:checked'
  )) {
    const name = String(input.value || '').trim();
    if (name) names.push(name);
  }
  return names;
}

function populateChannelMultiList(settings) {
  const list = document.getElementById('channel-multi-list');
  if (!list) return;

  const zello = normalizeZelloSettings(settings || {});
  const active = new Set(
    (zello.channelNames || []).map((n) => n.toLowerCase())
  );
  const catalog = Array.isArray(settings?.catalog?.channels)
    ? settings.catalog.channels
    : [];

  const rows = [];
  const seen = new Set();
  const add = (name, checked) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ name: trimmed, checked: checked || active.has(key) });
  };

  for (const n of zello.channelNames || []) add(n, true);
  for (const ch of catalog) add(ch?.name || ch?.key || '', false);

  list.innerHTML = '';
  if (!rows.length) {
    list.innerHTML =
      '<div class="multi-bot-hint">No channels yet — type a name below and Add.</div>';
    return;
  }

  for (const row of rows) {
    const label = document.createElement('label');
    label.className = 'channel-multi-item';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'channel-multi-check';
    input.value = row.name;
    input.checked = row.checked;
    const span = document.createElement('span');
    span.textContent = row.name;
    label.appendChild(input);
    label.appendChild(span);
    list.appendChild(label);
  }
}

function populateChannelAssignTarget(settings) {
  const select = document.getElementById('channel-assign-target');
  if (!select) return;
  const names = getActiveChannelChoices(settings);
  const current = select.value;
  select.innerHTML = '';
  const primary = document.createElement('option');
  primary.value = '';
  primary.textContent = '(primary / first active)';
  select.appendChild(primary);
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }
  if ([...select.options].some((o) => o.value === current)) {
    select.value = current;
  }
}

async function saveActiveChannelsFromUi(extraName) {
  if (!window.zelloBot?.settings) return null;
  const current = await window.zelloBot.settings.get();
  let names = readChannelMultiSelection();
  const typed = String(
    extraName || zelloChannelName?.value || ''
  ).trim();
  if (typed && !names.some((n) => n.toLowerCase() === typed.toLowerCase())) {
    names = [typed, ...names];
  }
  if (!names.length && typed) {
    names = [typed];
  }

  const saved = await window.zelloBot.settings.save({
    ...current,
    zello: {
      ...normalizeZelloSettings(current),
      channelName: names[0] || '',
      channelNames: names
    }
  });

  if (zelloChannelName) {
    zelloChannelName.value = names[0] || '';
  }
  populateCatalogPickers(saved);
  populateMultiBotRoster(saved);
  populateZelloSettings(normalizeZelloSettings(saved));
  if (appStatus) {
    appStatus.textContent =
      names.length
        ? 'Channels saved (' + names.length + ')'
        : 'No channels selected';
  }
  return saved;
}

async function assignAllBotsToChannel(channelName) {
  if (!window.zelloBot?.settings) return;
  const current = await window.zelloBot.settings.get();
  const bots = Array.isArray(current.bots) ? current.bots : [];
  const target = String(channelName || '').trim();
  const next = bots.map((b) => ({
    ...b,
    channelName: target
  }));
  const saved = await window.zelloBot.settings.save({
    ...current,
    bots: next
  });
  populateMultiBotRoster(saved);
  if (appStatus) {
    appStatus.textContent = target
      ? 'Assigned all bots → ' + target
      : 'All bots use primary channel';
  }
}

function updateActiveModelBadges(text) {
  for (const id of [
    'channel-model-badge',
    'roster-model-badge'
  ]) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
}

function setStateBadge(
  element,
  ready,
  readyText,
  idleText
) {
  element.classList.remove(
    'connection-state-idle',
    'connection-state-ready'
  );

  element.classList.add(
    ready
      ? 'connection-state-ready'
      : 'connection-state-idle'
  );

  element.textContent =
    ready
      ? readyText
      : idleText;
}

function updateZelloSummary(zello) {
  const channelReady =
    Boolean(zello.channelName.trim());

  const credentialsReady =
    Boolean(zello.botUsername.trim()) &&
    Boolean(zello.password) &&
    Boolean(zello.token);

  zelloSummaryChannel.textContent =
    channelReady
      ? zello.channelName
      : 'Not set';

  zelloSummaryBot.textContent =
    zello.botUsername.trim()
      ? zello.botUsername
      : 'Not set';

  zelloSummaryPassword.textContent =
    zello.password
      ? 'Saved'
      : 'Not set';

  zelloSummaryToken.textContent =
    zello.token
      ? 'Saved'
      : 'Not set';

  setStateBadge(
    zelloChannelState,
    channelReady,
    'Channel saved',
    'No channel'
  );

  setStateBadge(
    zelloCredentialsState,
    credentialsReady,
    'Credentials saved',
    'Not configured'
  );

  if (channelReady && credentialsReady) {
    zelloReadyTitle.textContent =
      'Ready for connection';

    zelloReadyCopy.textContent =
      'Bot credentials are saved and an active channel is selected.';
  } else if (credentialsReady) {
    zelloReadyTitle.textContent =
      'Choose a channel';

    zelloReadyCopy.textContent =
      'Your bot credentials are saved. Select any channel to continue.';
  } else {
    zelloReadyTitle.textContent =
      'Save bot credentials';

    zelloReadyCopy.textContent =
      'The bot account needs to be configured once.';
  }
}

function populateZelloSettings(zello) {
  zelloChannelName.value =
    zello.channelName;

  zelloBotUsername.value =
    zello.botUsername;

  zelloPassword.value =
    zello.password;

  zelloToken.value =
    zello.token;

  updateZelloSummary(zello);
}

function populateCatalogPickers(settings) {
  const catalog =
    settings &&
    settings.catalog &&
    typeof settings.catalog === 'object'
      ? settings.catalog
      : {};

  const channels =
    Array.isArray(catalog.channels)
      ? catalog.channels
      : [];

  const accounts =
    Array.isArray(catalog.accounts)
      ? catalog.accounts
      : [];

  if (zelloChannelPick) {
    const current =
      settings?.zello?.channelName || '';

    zelloChannelPick.innerHTML =
      '<option value="">Select channel…</option>';

    for (const channel of channels) {
      const option =
        document.createElement('option');
      option.value =
        channel.key || channel.name || '';
      option.textContent =
        channel.name || channel.key || '';
      option.dataset.name =
        channel.name || '';
      option.dataset.accountId =
        channel.accountId || '';
      if (
        channel.name === current ||
        channel.key === current
      ) {
        option.selected = true;
      }
      zelloChannelPick.appendChild(option);
    }
  }

  if (zelloBotPick) {
    const currentUser =
      settings?.zello?.botUsername || '';

    zelloBotPick.innerHTML =
      '<option value="">Select bot…</option>';

    for (const account of accounts) {
      const option =
        document.createElement('option');
      option.value =
        account.id || '';
      option.textContent =
        (account.label || account.username || account.id) +
        (account.username
          ? ` (${account.username})`
          : '');
      option.dataset.username =
        account.username || '';
      option.dataset.password =
        account.password || '';
      option.dataset.token =
        account.token || '';
      if (
        account.username === currentUser
      ) {
        option.selected = true;
      }
      zelloBotPick.appendChild(option);
    }
  }

  populateChannelMultiList(settings);
  populateChannelAssignTarget(settings);
}

async function applyCatalogChannelPick() {
  if (!zelloChannelPick || !window.zelloBot?.settings) {
    return;
  }

  const option =
    zelloChannelPick.selectedOptions[0];

  if (!option || !option.value) {
    return;
  }

  const name =
    option.dataset.name ||
    option.textContent ||
    '';

  zelloChannelName.value = name;

  const accountId =
    option.dataset.accountId || '';

  if (accountId && zelloBotPick) {
    zelloBotPick.value = accountId;
    await applyCatalogBotPick(false);
  }

  const current =
    await window.zelloBot.settings.get();

  await window.zelloBot.settings.save({
    ...current,
    zello: {
      ...normalizeZelloSettings(current),
      channelName: name,
      channelNames: (() => {
        const prev =
          normalizeZelloSettings(current).channelNames ||
          [];
        const rest = prev.filter(
          (n) => n.toLowerCase() !== name.toLowerCase()
        );
        return [name, ...rest];
      })(),
      botUsername:
        zelloBotUsername.value,
      password:
        zelloPassword.value,
      token:
        zelloToken.value
    }
  });

  populateZelloSettings(
    normalizeZelloSettings(
      await window.zelloBot.settings.get()
    )
  );

  appStatus.textContent =
    'Channel Selected';
}

async function applyCatalogBotPick(save = true) {
  if (!zelloBotPick) {
    return;
  }

  const option =
    zelloBotPick.selectedOptions[0];

  if (!option || !option.value) {
    return;
  }

  zelloBotUsername.value =
    option.dataset.username || '';
  zelloPassword.value =
    option.dataset.password || '';
  zelloToken.value =
    option.dataset.token || '';

  if (!save || !window.zelloBot?.settings) {
    updateZelloSummary(
      normalizeZelloSettings({
        zello: {
          channelName:
            zelloChannelName.value,
          botUsername:
            zelloBotUsername.value,
          password:
            zelloPassword.value,
          token:
            zelloToken.value
        }
      })
    );
    return;
  }

  const current =
    await window.zelloBot.settings.get();

  await window.zelloBot.settings.save({
    ...current,
    zello: {
      ...normalizeZelloSettings(current),
      channelName:
        zelloChannelName.value,
      botUsername:
        zelloBotUsername.value,
      password:
        zelloPassword.value,
      token:
        zelloToken.value
    },
    ai: {
      ...(current.ai || {}),
      identityName:
        option.textContent.split(' (')[0] ||
        zelloBotUsername.value
    }
  });

  populateZelloSettings(
    normalizeZelloSettings(
      await window.zelloBot.settings.get()
    )
  );

  appStatus.textContent =
    'Bot Selected';
}

async function loadZelloSettings() {
  if (!window.zelloBot?.settings) {
    return;
  }

  try {
    const settings =
      await window.zelloBot.settings.get();

    populateCatalogPickers(settings);
    populateMultiBotRoster(settings);
    populateZelloSettings(
      normalizeZelloSettings(settings)
    );
  } catch {
    appStatus.textContent =
      'Settings Load Failed';
  }
}

function populateMultiBotRoster(settings) {
  const list =
    document.getElementById('multi-bot-list');
  const replyMode =
    document.getElementById('multi-bot-reply-mode');
  const peerChat =
    document.getElementById('multi-bot-peer-chat');
  const maxFighters =
    document.getElementById('multi-bot-max-fighters');
  const cooldown =
    document.getElementById('multi-bot-cooldown');
  const sayAsBot =
    document.getElementById('say-as-bot');

  if (!list) {
    return;
  }

  const bots =
    Array.isArray(settings?.bots) && settings.bots.length
      ? settings.bots
      : (settings?.catalog?.accounts || []).map((a, i) => ({
          id: a.id,
          enabled: i === 0,
          canSpeak: true,
          calledByName: false,
          username: a.username,
          password: a.password,
          token: a.token,
          identityName: a.label || a.username,
          omnivoiceVoice: '',
          behaviorMode: 'nice'
        }));

  const voices =
    Array.isArray(settings?.catalog?.voices)
      ? settings.catalog.voices
      : [];

  list.innerHTML = '';

  if (!bots.length) {
    list.innerHTML =
      '<div class="multi-bot-hint">No bots loaded. Check settings.</div>';
  }

  for (const bot of bots) {
    const row =
      document.createElement('div');
    row.className = 'multi-bot-row';
    row.dataset.botId = bot.id;
    row.dataset.username = bot.username || '';
    row.dataset.password = bot.password || '';
    row.dataset.token = bot.token || '';
    row.dataset.identity =
      bot.identityName || bot.username || '';

    const join =
      document.createElement('input');
    join.type = 'checkbox';
    join.className = 'multi-bot-enabled';
    join.title = 'Join channel';
    join.checked = bot.enabled !== false;

    const speak =
      document.createElement('input');
    speak.type = 'checkbox';
    speak.className = 'multi-bot-canspeak';
    speak.title =
      'Speak freely / bang-bang (overrides Name)';
    speak.checked = bot.canSpeak !== false;

    const nameCall =
      document.createElement('input');
    nameCall.type = 'checkbox';
    nameCall.className = 'multi-bot-calledbyname';
    nameCall.title =
      'Called by name — reply when mentioned; Speak overrides this';
    nameCall.checked = bot.calledByName === true;

    const channelPick =
      document.createElement('select');
    channelPick.className = 'multi-bot-channel';
    channelPick.title =
      'Channel for this bot (blank = primary)';
    const primaryOpt =
      document.createElement('option');
    primaryOpt.value = '';
    primaryOpt.textContent = '(primary)';
    channelPick.appendChild(primaryOpt);
    const channelChoices = getActiveChannelChoices(
      settings
    );
    for (const ch of channelChoices) {
      const opt = document.createElement('option');
      opt.value = ch;
      opt.textContent = ch;
      if (
        String(bot.channelName || '').trim() === ch
      ) {
        opt.selected = true;
      }
      channelPick.appendChild(opt);
    }
    if (
      bot.channelName &&
      !channelChoices.includes(
        String(bot.channelName).trim()
      )
    ) {
      const opt = document.createElement('option');
      opt.value = String(bot.channelName).trim();
      opt.textContent = opt.value;
      opt.selected = true;
      channelPick.appendChild(opt);
    }

    const nameWrap =
      document.createElement('div');
    nameWrap.className = 'bot-name-wrap';

    const name =
      document.createElement('span');
    name.className = 'bot-name';
    name.textContent =
      (bot.identityName || bot.username) +
      (bot.username ? ' @' + bot.username : '');
    name.title =
      (bot.username || '') +
      ' — Join / Speak / Name';

    const errLine =
      document.createElement('div');
    errLine.className = 'bot-row-error';
    errLine.dataset.botErrorId = String(bot.id);
    errLine.hidden = true;

    nameWrap.appendChild(name);
    nameWrap.appendChild(errLine);

    const voice =
      document.createElement('select');
    voice.className = 'multi-bot-voice';
    const empty =
      document.createElement('option');
    empty.value = '';
    empty.textContent = '(voice)';
    voice.appendChild(empty);
    for (const file of voices) {
      const opt =
        document.createElement('option');
      opt.value = file;
      opt.textContent =
        file.replace(/\.wav$/i, '');
      const currentVoice =
        String(bot.omnivoiceVoice || '');
      if (
        file === currentVoice ||
        file.replace(/\.wav$/i, '') ===
          currentVoice.replace(/\.wav$/i, '')
      ) {
        opt.selected = true;
      }
      voice.appendChild(opt);
    }

    const status =
      document.createElement('span');
    status.className = 'bot-live-status';
    status.dataset.botStatusId = String(bot.id);
    status.textContent = '—';

    row.appendChild(join);
    row.appendChild(speak);
    row.appendChild(nameCall);
    row.appendChild(channelPick);
    row.appendChild(nameWrap);
    row.appendChild(voice);
    row.appendChild(status);
    list.appendChild(row);
  }

  if (replyMode) {
    replyMode.value =
      settings?.multiBot?.replyMode ||
      'random';
  }

  if (peerChat) {
    peerChat.checked =
      settings?.multiBot?.allowPeerChat !== false;
  }

  if (maxFighters) {
    maxFighters.value = String(
      settings?.multiBot?.maxFighters || 3
    );
  }

  if (cooldown) {
    cooldown.value = String(
      Number.isFinite(Number(settings?.multiBot?.cooldownMs))
        ? Number(settings.multiBot.cooldownMs)
        : 200
    );
  }

  const chatModeEl =
    document.getElementById('chat-flow-mode');
  const maxUserTalk =
    document.getElementById('chat-max-user-talk');
  const cutIn =
    document.getElementById('chat-cut-in');
  const botSpeakSec =
    document.getElementById('chat-bot-speak-sec');
  const memoryDepth =
    document.getElementById('chat-memory-depth');
  const interruptReset =
    document.getElementById('chat-interrupt-reset');

  const chatMode = normalizeUiChatMode(
    settings?.multiBot?.chatMode ||
      settings?.ai?.behaviorMode
  );

  if (chatModeEl) {
    chatModeEl.value = chatMode;
  }
  if (fordMood) {
    fordMood.value = chatMode;
  }
  if (maxUserTalk) {
    maxUserTalk.value = String(
      Math.round(
        (Number(settings?.multiBot?.maxUserTalkMs) ||
          20000) / 1000
      )
    );
  }
  if (cutIn) {
    cutIn.checked =
      settings?.multiBot?.cutInWhenCapped !== false;
  }
  if (botSpeakSec) {
    botSpeakSec.value = String(
      Number(settings?.multiBot?.botSpeakTargetSec) || 18
    );
  }
  if (memoryDepth) {
    memoryDepth.value = String(
      Number(settings?.multiBot?.memoryDepth) || 48
    );
  }
  if (interruptReset) {
    interruptReset.checked =
      settings?.multiBot?.interruptReset !== false;
  }

  const botsSteps =
    document.getElementById('bots-omnivoice-steps');
  const botsSpeed =
    document.getElementById('bots-omnivoice-speed');
  const botsPreset =
    document.getElementById('bots-voice-preset');
  const stepsVal = Math.min(
    16,
    Math.max(
      4,
      Math.round(Number(settings?.speech?.omnivoiceSteps) || 6)
    )
  );
  const speedVal = Number(settings?.speech?.omnivoiceSpeed);
  if (botsSteps) {
    botsSteps.value = String(stepsVal);
  }
  if (botsSpeed) {
    botsSpeed.value = String(
      Number.isFinite(speedVal) ? speedVal : 1
    );
  }
  if (botsPreset) {
    if (stepsVal <= 7) botsPreset.value = 'fast';
    else if (stepsVal >= 13) botsPreset.value = 'quality';
    else botsPreset.value = 'balanced';
  }
  if (omnivoiceSteps) {
    omnivoiceSteps.value = String(stepsVal);
  }
  if (omnivoiceSpeed) {
    omnivoiceSpeed.value = String(
      Number.isFinite(speedVal) ? speedVal : 1
    );
  }

  if (sayAsBot) {
    const speakable = bots.filter(
      (b) => b.enabled !== false && b.canSpeak !== false
    );
    const source =
      speakable.length
        ? speakable
        : bots.filter((b) => b.enabled !== false);
    sayAsBot.innerHTML = '';
    for (const bot of source.length ? source : bots) {
      const opt =
        document.createElement('option');
      opt.value = bot.id;
      opt.textContent =
        (bot.identityName || bot.username) +
        (bot.omnivoiceVoice
          ? ' · ' +
            String(bot.omnivoiceVoice).replace(
              /\.wav$/i,
              ''
            )
          : '');
      sayAsBot.appendChild(opt);
    }
  }
}

async function saveMultiBotRoster(options = {}) {
  if (!window.zelloBot?.settings) {
    return;
  }

  const softUi = options.softUi === true;

  const list =
    document.getElementById('multi-bot-list');
  const replyMode =
    document.getElementById('multi-bot-reply-mode');
  const peerChat =
    document.getElementById('multi-bot-peer-chat');
  const maxFighters =
    document.getElementById('multi-bot-max-fighters');
  const cooldown =
    document.getElementById('multi-bot-cooldown');
  const chatModeEl =
    document.getElementById('chat-flow-mode');
  const maxUserTalk =
    document.getElementById('chat-max-user-talk');
  const cutIn =
    document.getElementById('chat-cut-in');
  const botSpeakSec =
    document.getElementById('chat-bot-speak-sec');
  const memoryDepth =
    document.getElementById('chat-memory-depth');
  const interruptReset =
    document.getElementById('chat-interrupt-reset');
  const botsSteps =
    document.getElementById('bots-omnivoice-steps');
  const botsSpeed =
    document.getElementById('bots-omnivoice-speed');

  const bots = [];
  for (const row of list?.querySelectorAll('.multi-bot-row') || []) {
    const enabled =
      row.querySelector('.multi-bot-enabled')?.checked !==
      false;
    const canSpeak =
      row.querySelector('.multi-bot-canspeak')?.checked !==
      false;
    const calledByName =
      row.querySelector('.multi-bot-calledbyname')
        ?.checked === true;
    const voice =
      row.querySelector('.multi-bot-voice')?.value || '';
    const channelName =
      row.querySelector('.multi-bot-channel')?.value || '';
    bots.push({
      id: row.dataset.botId,
      enabled,
      canSpeak,
      calledByName,
      username: row.dataset.username || '',
      password: row.dataset.password || '',
      token: row.dataset.token || '',
      identityName: row.dataset.identity || '',
      omnivoiceVoice: voice,
      channelName,
      behaviorMode: normalizeUiChatMode(
        chatModeEl?.value || 'banter'
      )
    });
  }

  const current =
    await window.zelloBot.settings.get();

  const primary =
    bots.find((b) => b.enabled && b.canSpeak) ||
    bots.find((b) => b.enabled) ||
    bots[0];

  const chatMode = normalizeUiChatMode(
    chatModeEl?.value ||
      current.multiBot?.chatMode ||
      current.ai?.behaviorMode ||
      'banter'
  );

  const aggressive =
    chatMode === 'banter' ||
    chatMode === 'argument' ||
    chatMode === 'extreme';

  await window.zelloBot.settings.save({
    ...current,
    bots,
    multiBot: {
      ...(current.multiBot || {}),
      replyMode:
        replyMode?.value || 'random',
      preferredBotId: primary?.id || '',
      allowPeerChat:
        peerChat ? peerChat.checked : true,
      cooldownMs: Number.isFinite(Number(cooldown?.value))
        ? Number(cooldown.value)
        : aggressive
          ? 200
          : 400,
      peerChatChance: 0.9,
      maxFighters: Number(maxFighters?.value) || 3,
      chatMode,
      maxUserTalkMs: Math.round(
        (Number(maxUserTalk?.value) || 20) * 1000
      ),
      cutInWhenCapped: cutIn ? cutIn.checked : true,
      botSpeakTargetSec:
        Number(botSpeakSec?.value) || 18,
      memoryDepth: Number(memoryDepth?.value) || 48,
      interruptReset: interruptReset
        ? interruptReset.checked
        : true
    },
    zello: {
      ...normalizeZelloSettings(current),
      botUsername: primary?.username || '',
      password: primary?.password || '',
      token: primary?.token || ''
    },
    speech: {
      ...(current.speech || {}),
      omnivoiceVoice:
        primary?.omnivoiceVoice ||
        current.speech?.omnivoiceVoice ||
        '',
      omnivoiceSteps: Math.min(
        16,
        Math.max(
          4,
          Math.round(
            Number(botsSteps?.value) ||
              Number(omnivoiceSteps?.value) ||
              6
          )
        )
      ),
      omnivoiceSpeed: Math.min(
        4,
        Math.max(
          0.25,
          Number(botsSpeed?.value) ||
            Number(omnivoiceSpeed?.value) ||
            1
        )
      )
    },
    ai: {
      ...(current.ai || {}),
      identityName:
        primary?.identityName ||
        current.ai?.identityName,
      behaviorMode: chatMode
    }
  });

  if (fordMood) {
    fordMood.value = chatMode;
  }

  const savedSteps = Math.min(
    16,
    Math.max(
      4,
      Math.round(
        Number(botsSteps?.value) ||
          Number(omnivoiceSteps?.value) ||
          6
      )
    )
  );
  const savedSpeed = Math.min(
    4,
    Math.max(
      0.25,
      Number(botsSpeed?.value) ||
        Number(omnivoiceSpeed?.value) ||
        1
    )
  );
  if (omnivoiceSteps) {
    omnivoiceSteps.value = String(savedSteps);
  }
  if (omnivoiceSpeed) {
    omnivoiceSpeed.value = String(savedSpeed);
  }
  if (botsSteps) {
    botsSteps.value = String(savedSteps);
  }
  if (botsSpeed) {
    botsSpeed.value = String(savedSpeed);
  }

  const joined = bots.filter((b) => b.enabled).length;
  const speaking = bots.filter(
    (b) => b.enabled && b.canSpeak
  ).length;

  appStatus.textContent =
    'Bot roster saved (' +
    joined +
    ' joined, ' +
    speaking +
    ' speak)';

  // Flag-only saves must not rebuild the roster DOM (fights rapid ticks)
  if (!softUi) {
    await loadZelloSettings();
  }
}

function setAllMultiBots(enabled) {
  for (const check of document.querySelectorAll(
    '#multi-bot-list .multi-bot-enabled'
  )) {
    check.checked = enabled;
  }
}

function setAllMultiBotSpeak(canSpeak) {
  for (const check of document.querySelectorAll(
    '#multi-bot-list .multi-bot-canspeak'
  )) {
    check.checked = canSpeak;
  }
}

let rosterSaveTimer = null;

function scheduleRosterAutosave() {
  if (rosterSaveTimer) {
    clearTimeout(rosterSaveTimer);
  }
  rosterSaveTimer = setTimeout(() => {
    saveMultiBotRoster().catch(() => {
      appStatus.textContent = 'Roster Save Failed';
    });
  }, 250);
}

/** Join / Speak / Name must apply on click — no debounce, no roster rebuild. */
function saveRosterFlagsNow() {
  if (rosterSaveTimer) {
    clearTimeout(rosterSaveTimer);
    rosterSaveTimer = null;
  }
  return saveMultiBotRoster({ softUi: true }).catch(() => {
    appStatus.textContent = 'Roster Save Failed';
  });
}

document
  .getElementById('multi-bot-save')
  ?.addEventListener('click', () => {
    saveMultiBotRoster().catch(() => {
      appStatus.textContent =
        'Roster Save Failed';
    });
  });

document
  .getElementById('multi-bot-enable-all')
  ?.addEventListener('click', () => {
    setAllMultiBots(true);
    saveRosterFlagsNow();
  });

document
  .getElementById('multi-bot-disable-all')
  ?.addEventListener('click', () => {
    setAllMultiBots(false);
    saveRosterFlagsNow();
  });

document
  .getElementById('multi-bot-speak-all')
  ?.addEventListener('click', () => {
    setAllMultiBotSpeak(true);
    saveRosterFlagsNow();
  });

document
  .getElementById('multi-bot-mute-all')
  ?.addEventListener('click', async () => {
    setAllMultiBotSpeak(false);
    try {
      await saveMultiBotRoster({ softUi: true });
      appStatus.textContent =
        'All bots muted (Speak off) — still joined';
    } catch {
      appStatus.textContent = 'Mute Save Failed';
    }
  });

document
  .getElementById('multi-bot-list')
  ?.addEventListener('change', (event) => {
    const target = event.target;
    if (
      !(target instanceof HTMLInputElement) &&
      !(target instanceof HTMLSelectElement)
    ) {
      return;
    }
    if (
      target.classList.contains('multi-bot-enabled') ||
      target.classList.contains('multi-bot-canspeak') ||
      target.classList.contains('multi-bot-calledbyname')
    ) {
      saveRosterFlagsNow();
      return;
    }
    if (
      target.classList.contains('multi-bot-channel') ||
      target.classList.contains('multi-bot-voice')
    ) {
      scheduleRosterAutosave();
    }
  });

async function sendSayAsMessage() {
  const status =
    document.getElementById('say-as-status');
  const botId =
    document.getElementById('say-as-bot')?.value;
  const text =
    document.getElementById('say-as-text')?.value;

  if (!window.zelloBot?.voiceBot?.speakText) {
    if (status) {
      status.textContent =
        'Speak API missing — restart the app.';
    }
    return;
  }

  if (status) {
    status.textContent = 'Synthesizing / waiting for button…';
  }

  try {
    const result =
      await window.zelloBot.voiceBot.speakText({
        botId,
        text
      });

    if (status) {
      status.textContent =
        'Sent as ' +
        (result.identityName || botId);
    }

    const box =
      document.getElementById('say-as-text');
    if (box) {
      box.value = '';
    }
  } catch (err) {
    if (status) {
      status.textContent =
        err?.message || String(err);
    }
  }
}

document
  .getElementById('say-as-send')
  ?.addEventListener('click', () => {
    sendSayAsMessage();
  });

document
  .getElementById('say-as-text')
  ?.addEventListener('keydown', (event) => {
    if (
      event.key === 'Enter' &&
      (event.ctrlKey || event.metaKey)
    ) {
      event.preventDefault();
      sendSayAsMessage();
    }
  });

if (zelloChannelPick) {
  zelloChannelPick.addEventListener(
    'change',
    () => {
      applyCatalogChannelPick().catch(
        () => {
          appStatus.textContent =
            'Channel Pick Failed';
        }
      );
    }
  );
}

if (zelloBotPick) {
  zelloBotPick.addEventListener(
    'change',
    () => {
      applyCatalogBotPick(true).catch(
        () => {
          appStatus.textContent =
            'Bot Pick Failed';
        }
      );
    }
  );
}

function toggleSecret(input, button) {
  const show =
    input.type === 'password';

  input.type =
    show
      ? 'text'
      : 'password';

  button.textContent =
    show
      ? 'Hide'
      : 'Show';
}

zelloPasswordToggle.addEventListener(
  'click',
  () => {
    toggleSecret(
      zelloPassword,
      zelloPasswordToggle
    );
  }
);

zelloTokenToggle.addEventListener(
  'click',
  () => {
    toggleSecret(
      zelloToken,
      zelloTokenToggle
    );
  }
);

if (zelloChannelForm) {
  zelloChannelForm.addEventListener(
    'submit',
    async (event) => {
      event.preventDefault();
      if (zelloChannelSaveButton) {
        zelloChannelSaveButton.disabled = true;
        zelloChannelSaveButton.textContent = 'Saving...';
      }
      try {
        await saveActiveChannelsFromUi();
      } catch {
        appStatus.textContent = 'Channel Save Failed';
      } finally {
        if (zelloChannelSaveButton) {
          zelloChannelSaveButton.disabled = false;
          zelloChannelSaveButton.textContent =
            'Save channels';
        }
      }
    }
  );
}

document
  .getElementById('zello-channel-save-button')
  ?.addEventListener('click', async () => {
    try {
      await saveActiveChannelsFromUi();
    } catch {
      appStatus.textContent = 'Channel Save Failed';
    }
  });

document
  .getElementById('channel-add-button')
  ?.addEventListener('click', async () => {
    try {
      await saveActiveChannelsFromUi(
        zelloChannelName?.value
      );
    } catch {
      appStatus.textContent = 'Channel Add Failed';
    }
  });

document
  .getElementById('channel-select-all')
  ?.addEventListener('click', () => {
    for (const input of document.querySelectorAll(
      '#channel-multi-list .channel-multi-check'
    )) {
      input.checked = true;
    }
  });

document
  .getElementById('channel-select-none')
  ?.addEventListener('click', () => {
    for (const input of document.querySelectorAll(
      '#channel-multi-list .channel-multi-check'
    )) {
      input.checked = false;
    }
  });

document
  .getElementById('channel-assign-all')
  ?.addEventListener('click', () => {
    const target =
      document.getElementById('channel-assign-target')
        ?.value || '';
    assignAllBotsToChannel(target).catch(() => {
      appStatus.textContent = 'Assign Failed';
    });
  });

document
  .getElementById('channel-assign-primary')
  ?.addEventListener('click', () => {
    assignAllBotsToChannel('').catch(() => {
      appStatus.textContent = 'Assign Failed';
    });
  });

document
  .getElementById('control-save-settings')
  ?.addEventListener('click', () => {
    saveMultiBotRoster().catch(() => {
      appStatus.textContent = 'Control Save Failed';
    });
  });

document
  .getElementById('channel-multi-list')
  ?.addEventListener('change', (event) => {
    if (
      event.target instanceof HTMLInputElement &&
      event.target.classList.contains('channel-multi-check')
    ) {
      // Autosave selection lightly
      saveActiveChannelsFromUi().catch(() => {});
    }
  });

zelloCredentialsForm.addEventListener(
  'submit',
  async (event) => {
    event.preventDefault();

    zelloCredentialsSaveButton.disabled = true;
    zelloCredentialsSaveButton.textContent =
      'Saving...';

    try {
      const current =
        await window.zelloBot.settings.get();

      const currentZello =
        normalizeZelloSettings(current);

      const saved =
        await window.zelloBot.settings.save({
          ...current,

          zello: {
            ...currentZello,

            botUsername:
              zelloBotUsername.value.trim(),

            password:
              zelloPassword.value,

            token:
              zelloToken.value
          }
        });

      populateZelloSettings(
        normalizeZelloSettings(saved)
      );

      appStatus.textContent =
        'Credentials Saved';
    } catch {
      appStatus.textContent =
        'Credential Save Failed';
    } finally {
      zelloCredentialsSaveButton.disabled = false;
      zelloCredentialsSaveButton.textContent =
        'Save credentials';
    }
  }
);

function getRuntimeStatusLabel(status) {
  switch (status) {
    case 'connecting':
      return 'Connecting';

    case 'connected':
      return 'Connected';

    case 'error':
      return 'Connection error';

    default:
      return 'Disconnected';
  }
}

function renderZelloRuntimeStatus(runtime) {
  if (
    !runtime ||
    typeof runtime !== 'object'
  ) {
    return;
  }

  const status =
    typeof runtime.status === 'string'
      ? runtime.status
      : 'disconnected';

  const channelName =
    typeof runtime.channelName === 'string'
      ? runtime.channelName.trim()
      : '';

  const channelStatus =
    typeof runtime.channelStatus === 'string'
      ? runtime.channelStatus.trim()
      : '';

  const usersOnline =
    Number.isInteger(runtime.usersOnline)
      ? runtime.usersOnline
      : 0;

  if (status === 'connected') {
    const channelPart =
      channelName
        ? ' to ' + channelName
        : '';

    const channelStatePart =
      channelStatus
        ? ' - Channel ' + channelStatus
        : '';

    const usersPart =
      usersOnline > 0
        ? ' - ' + usersOnline + ' users'
        : '';

    zelloRuntimeStatus.textContent =
      'Connected' +
      channelPart +
      channelStatePart +
      usersPart;
  } else {
    zelloRuntimeStatus.textContent =
      getRuntimeStatusLabel(status);
  }

  zelloRuntimeStatus.classList.remove(
    'runtime-status-connected',
    'runtime-status-connecting',
    'runtime-status-error'
  );

  if (status === 'connected') {
    zelloRuntimeStatus.classList.add(
      'runtime-status-connected'
    );
  }

  if (status === 'connecting') {
    zelloRuntimeStatus.classList.add(
      'runtime-status-connecting'
    );
  }

  if (status === 'error') {
    zelloRuntimeStatus.classList.add(
      'runtime-status-error'
    );
  }

  const connecting =
    status === 'connecting';

  const connected =
    status === 'connected' ||
    status === 'partial';

  zelloConnectButton.disabled =
    connecting || status === 'connected';

  zelloDisconnectButton.disabled =
    !connecting && !connected;

  zelloConnectButton.textContent =
    connecting
      ? 'Connecting...'
      : 'Connect bots';

  if (
    zelloRuntimeStatus &&
    runtime &&
    Number.isFinite(runtime.connectedCount)
  ) {
    zelloRuntimeStatus.textContent =
      (
        zelloRuntimeStatus.textContent ||
        getRuntimeStatusLabel(status)
      ) +
      ' · ' +
      runtime.connectedCount +
      '/' +
      (runtime.totalCount || 0) +
      ' bots';
  }

  const rosterState =
    document.getElementById('bots-roster-state');
  if (rosterState && runtime) {
    rosterState.textContent =
      (runtime.connectedCount || 0) +
      '/' +
      (runtime.totalCount || 0) +
      ' joined';
  }

  const statusById = new Map();
  for (const bot of runtime?.bots || []) {
    statusById.set(String(bot.id), bot);
  }
  for (const el of document.querySelectorAll(
    '[data-bot-status-id]'
  )) {
    const st = statusById.get(
      String(el.getAttribute('data-bot-status-id'))
    );
    if (!st) {
      el.textContent = '—';
      el.className = 'bot-live-status';
      continue;
    }
    if (st.transmitting) {
      el.textContent = 'TX';
      el.className = 'bot-live-status is-tx';
    } else if (st.status === 'connected') {
      el.textContent = 'ON';
      el.className = 'bot-live-status is-on';
    } else if (st.status === 'connecting') {
      el.textContent = '…';
      el.className = 'bot-live-status';
    } else if (st.lastError) {
      el.textContent = 'ERR';
      el.className = 'bot-live-status is-err';
      el.title = st.lastError;
    } else {
      el.textContent = 'OFF';
      el.className = 'bot-live-status';
    }

    const errEl = document.querySelector(
      '[data-bot-error-id="' +
        el.getAttribute('data-bot-status-id') +
        '"]'
    );
    if (errEl) {
      if (st.lastError && st.status !== 'connected') {
        errEl.hidden = false;
        errEl.textContent = String(st.lastError).slice(0, 160);
        errEl.title = st.lastError;
      } else {
        errEl.hidden = true;
        errEl.textContent = '';
      }
    }
  }

  if (zelloReadyTitle && zelloReadyCopy && runtime) {
    if (connected) {
      zelloReadyTitle.textContent =
        runtime.connectedCount +
        ' joined';
      zelloReadyCopy.textContent =
        'Use Roster tab for Join / Speak / Name / Channel.';
    }
  }

  const errorText =
    typeof runtime.lastError === 'string'
      ? runtime.lastError.trim()
      : '';

  zelloRuntimeError.textContent =
    errorText;

  zelloRuntimeError.classList.toggle(
    'is-hidden',
    !errorText
  );

  if (connected) {
    appStatus.textContent =
      'Zello Connected';
  }
}

async function loadZelloRuntimeStatus() {
  if (!window.zelloBot?.zelloRuntime) {
    return;
  }

  try {
    const runtime =
      await window.zelloBot.zelloRuntime.status();

    renderZelloRuntimeStatus(runtime);
  } catch {
    appStatus.textContent =
      'Runtime Status Failed';
  }
}

async function connectZelloRuntime() {
  if (!window.zelloBot?.zelloRuntime) {
    return;
  }

  renderZelloRuntimeStatus({
    status: 'connecting',
    lastError: ''
  });

  try {
    const runtime =
      await window.zelloBot.zelloRuntime.connect();

    renderZelloRuntimeStatus(runtime);

    appStatus.textContent =
      'Zello Connected';
  } catch (error) {
    const message =
      error &&
      error.message
        ? error.message
        : 'Unable to connect to Zello.';

    renderZelloRuntimeStatus({
      status: 'error',
      lastError: message
    });

    appStatus.textContent =
      'Zello Connection Failed';

    await loadZelloRuntimeStatus();
  }
}

async function disconnectZelloRuntime() {
  if (!window.zelloBot?.zelloRuntime) {
    return;
  }

  try {
    const runtime =
      await window.zelloBot.zelloRuntime.disconnect();

    renderZelloRuntimeStatus(runtime);

    appStatus.textContent =
      'Zello Disconnected';
  } catch {
    appStatus.textContent =
      'Disconnect Failed';
  }
}

if (zelloConnectButton) {
  zelloConnectButton.addEventListener(
    'click',
    connectZelloRuntime
  );
}

if (zelloDisconnectButton) {
  zelloDisconnectButton.addEventListener(
    'click',
    disconnectZelloRuntime
  );
}

function formatAudioBytes(value) {
  const bytes =
    Number.isFinite(value)
      ? value
      : 0;

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return (
      `${(bytes / 1024).toFixed(1)} KB`
    );
  }

  return (
    `${(
      bytes /
      (1024 * 1024)
    ).toFixed(1)} MB`
  );
}

function formatAudioDuration(value) {
  const milliseconds =
    Number.isFinite(value)
      ? value
      : 0;

  if (!milliseconds) {
    return '0.0s';
  }

  return (
    `${(
      milliseconds / 1000
    ).toFixed(1)}s`
  );
}

let targetInputLevel = 0;
let targetOutputLevel = 0;
let displayedInputLevel = 0;
let displayedOutputLevel = 0;

function clampAudioMeterLevel(value) {
  return Number.isFinite(value)
    ? Math.max(
        0,
        Math.min(1, value)
      )
    : 0;
}

function setLedMeterLevel(element, level) {
  if (!element) {
    return;
  }

  const segments =
    element.querySelectorAll('span');

  const litCount =
    Math.round(
      clampAudioMeterLevel(level) *
      segments.length
    );

  segments.forEach(
    (segment, index) => {
      segment.classList.toggle(
        'is-lit',
        index < litCount
      );
    }
  );
}

function levelToVuAngle(level) {
  const shaped =
    Math.pow(
      clampAudioMeterLevel(level),
      0.72
    );

  return -46 + shaped * 88;
}

let lastMeterAnimationTime = 0;

function approachMeterLevel(
  current,
  target,
  deltaMs
) {
  const timeConstantMs =
    target > current
      ? 140
      : 950;

  const amount =
    1 - Math.exp(
      -deltaMs /
      timeConstantMs
    );

  return current +
    (target - current) *
    amount;
}

function animateAudioMeters(timestamp) {
  const deltaMs =
    lastMeterAnimationTime > 0
      ? Math.min(
          50,
          Math.max(
            1,
            timestamp -
              lastMeterAnimationTime
          )
        )
      : 16.67;

  lastMeterAnimationTime =
    timestamp;

  displayedInputLevel =
    approachMeterLevel(
      displayedInputLevel,
      targetInputLevel,
      deltaMs
    );

  displayedOutputLevel =
    approachMeterLevel(
      displayedOutputLevel,
      targetOutputLevel,
      deltaMs
    );

  if (
    targetInputLevel <= 0.001 &&
    displayedInputLevel < 0.002
  ) {
    displayedInputLevel = 0;
  }

  if (
    targetOutputLevel <= 0.001 &&
    displayedOutputLevel < 0.002
  ) {
    displayedOutputLevel = 0;
  }

  if (voiceVuNeedle) {
    voiceVuNeedle.style.transform =
      `rotate(${
        levelToVuAngle(
          displayedInputLevel
        ).toFixed(2)
      }deg)`;
  }

  if (botVuNeedle) {
    botVuNeedle.style.transform =
      `rotate(${
        levelToVuAngle(
          displayedOutputLevel
        ).toFixed(2)
      }deg)`;
  }

  setLedMeterLevel(
    audioLedInput,
    displayedInputLevel
  );

  setLedMeterLevel(
    audioLedOutput,
    displayedOutputLevel
  );

  window.requestAnimationFrame(
    animateAudioMeters
  );
}

window.requestAnimationFrame(
  animateAudioMeters
);

if (
  window.zelloBot?.audio?.onLevels
) {
  window.zelloBot.audio.onLevels(
    (levels) => {
      if (
        !levels ||
        typeof levels !== 'object'
      ) {
        return;
      }

      targetInputLevel =
        clampAudioMeterLevel(
          levels.inputLevel
        );

      targetOutputLevel =
        clampAudioMeterLevel(
          levels.outputLevel
        );
    }
  );
}

function renderAudioPipelineStatus(audio) {
  if (
    !audio ||
    typeof audio !== 'object'
  ) {
    return;
  }

  const status =
    typeof audio.status === 'string'
      ? audio.status
      : 'idle';

  audioPipelineState.classList.remove(
    'audio-state-idle',
    'audio-state-receiving',
    'audio-state-error'
  );

  if (status === 'receiving') {
    audioPipelineState.classList.add(
      'audio-state-receiving'
    );

    audioPipelineState.textContent =
      'Receiving';
  } else if (status === 'error') {
    audioPipelineState.classList.add(
      'audio-state-error'
    );

    audioPipelineState.textContent =
      'Audio error';
  } else {
    audioPipelineState.classList.add(
      'audio-state-idle'
    );

    audioPipelineState.textContent =
      'Idle';
  }

  const currentSpeaker =
    typeof audio.activeSpeaker === 'string'
      ? audio.activeSpeaker.trim()
      : '';

  audioCurrentSpeaker.textContent =
    currentSpeaker ||
    'Waiting for voice';

  audioPacketCount.textContent =
    String(
      Number.isFinite(
        audio.packetsReceived
      )
        ? audio.packetsReceived
        : 0
    );

  audioByteCount.textContent =
    formatAudioBytes(
      audio.bytesReceived
    );

  audioStreamCount.textContent =
    String(
      Number.isFinite(
        audio.streamsCompleted
      )
        ? audio.streamsCompleted
        : 0
    );

  const lastSpeaker =
    typeof audio.lastSpeaker === 'string'
      ? audio.lastSpeaker.trim()
      : '';

  audioLastSpeaker.textContent =
    lastSpeaker ||
    'None yet';

  if (lastSpeaker) {
    audioLastDetails.textContent =
      [
        `${audio.lastStreamPackets || 0} packets`,
        formatAudioBytes(
          audio.lastStreamBytes
        ),
        formatAudioDuration(
          audio.lastStreamDurationMs
        )
      ].join(' \u00b7 ');
  } else {
    audioLastDetails.textContent =
      'Waiting for incoming Zello audio.';
  }
}

async function loadAudioPipelineStatus() {
  if (!window.zelloBot?.audio) {
    return;
  }

  try {
    const audio =
      await window.zelloBot.audio.status();

    renderAudioPipelineStatus(
      audio
    );
  } catch {
    appStatus.textContent =
      'Audio Status Failed';
  }
}

function normalizeEngineSettings(settings) {
  const ai =
    settings &&
    settings.ai &&
    typeof settings.ai === 'object'
      ? settings.ai
      : {};

  const speech =
    settings &&
    settings.speech &&
    typeof settings.speech === 'object'
      ? settings.speech
      : {};

  return {
    ollamaUrl:
      typeof ai.ollamaUrl === 'string'
        ? ai.ollamaUrl
        : 'http://127.0.0.1:11434',

    ollamaUrlThisPc:
      typeof ai.ollamaUrlThisPc === 'string'
        ? ai.ollamaUrlThisPc
        : 'http://127.0.0.1:11434',

    ollamaUrlOtherPc:
      typeof ai.ollamaUrlOtherPc === 'string'
        ? ai.ollamaUrlOtherPc
        : 'http://192.168.1.92:11434',

    llmHostMode:
      ['this-pc', 'other-pc', 'auto'].includes(
        ai.llmHostMode
      )
        ? ai.llmHostMode
        : 'other-pc',

    model:
      typeof ai.model === 'string' &&
      ai.model &&
      ai.model !== 'gpt-5.6-luna'
        ? ai.model
        : 'qwen2.5vl:3b',

    identityName:
      typeof ai.identityName === 'string' &&
      ai.identityName.trim()
        ? ai.identityName.trim()
        : 'Bot',

    autoReply:
      ai.autoReply !== false,

    behaviorMode: normalizeUiChatMode(
      ai.behaviorMode
    ),

    sttUrl:
      typeof speech.sttUrl === 'string'
        ? speech.sttUrl
        : 'http://127.0.0.1:9000/v1/audio/transcriptions',

    omnivoiceUrl:
      typeof speech.omnivoiceUrl === 'string'
        ? speech.omnivoiceUrl
        : 'http://127.0.0.1:8002',

    omnivoiceVoice:
      typeof speech.omnivoiceVoice === 'string'
        ? speech.omnivoiceVoice
        : '',

    omnivoiceSpeed:
      Number.isFinite(
        Number(
          speech.omnivoiceSpeed
        )
      )
        ? Number(
            speech.omnivoiceSpeed
          )
        : 1,

    omnivoiceSteps:
      Number.isFinite(
        Number(
          speech.omnivoiceSteps
        )
      )
        ? Number(
            speech.omnivoiceSteps
          )
        : 32
  };
}

function ensureOmniVoiceSelection(
  voiceName
) {
  if (!omnivoiceVoice) {
    return;
  }

  const selected =
    typeof voiceName === 'string'
      ? voiceName
      : '';

  if (
    selected &&
    !Array.from(
      omnivoiceVoice.options
    ).some(
      (option) =>
        option.value === selected
    )
  ) {
    const option =
      document.createElement(
        'option'
      );

    option.value =
      selected;

    option.textContent =
      selected;

    omnivoiceVoice.appendChild(
      option
    );
  }

  omnivoiceVoice.value =
    selected;

  renderCustomVoiceSelect();
}

function getActiveIdentityName() {
  if (
    rpIdentityName &&
    typeof rpIdentityName.value === 'string' &&
    rpIdentityName.value.trim()
  ) {
    return rpIdentityName.value.trim();
  }

  return 'Bot';
}

function applyIdentityLabels(name) {
  const identity =
    typeof name === 'string' &&
    name.trim()
      ? name.trim()
      : 'Bot';

  const upperIdentity =
    identity.toUpperCase();

  const setText = (id, value) => {
    const element =
      document.getElementById(id);

    if (element) {
      element.textContent = value;
    }
  };

  setText(
    'page-title',
    identity + ' Command Center'
  );

  setText(
    'identity-behavior-kicker',
    upperIdentity + ' BEHAVIOR & VOICE'
  );

  setText(
    'identity-behavior-title',
    identity
  );

  setText(
    'identity-voice-label',
    identity + ' voice'
  );

  setText(
    'identity-runtime-kicker',
    upperIdentity + ' RUNTIME'
  );

  setText(
    'identity-online-label',
    upperIdentity + ' ONLINE'
  );

  setText(
    'identity-response-label',
    upperIdentity
  );

  if (
    voiceEngineSaveButton &&
    !voiceEngineSaveButton.disabled
  ) {
    voiceEngineSaveButton.textContent =
      'Save ' + identity;
  }
}

if (rpIdentityName) {
  rpIdentityName.addEventListener(
    'input',
    () => {
      applyIdentityLabels(
        getActiveIdentityName()
      );

      if (
        zelloConnectButton &&
        !zelloConnectButton.disabled
      ) {
        zelloConnectButton.textContent =
          'Connect ' +
          getActiveIdentityName();
      }
    }
  );
}

function populateEngineSettings(engine) {
  if (ollamaUrlThisPc) {
    ollamaUrlThisPc.value =
      engine.ollamaUrlThisPc ||
      'http://127.0.0.1:11434';
  }

  if (ollamaUrlOtherPc) {
    ollamaUrlOtherPc.value =
      engine.ollamaUrlOtherPc ||
      'http://192.168.1.92:11434';
  }

  ollamaUrl.value =
    engine.ollamaUrl;

  if (ollamaModel) {
    ensureModelOption(ollamaModel, engine.model);
    ollamaModel.value = engine.model || '';
  }

  if (llmHostMode) {
    llmHostMode.value =
      engine.llmHostMode || 'other-pc';
  }

  const botsHost =
    document.getElementById('bots-llm-host-mode');
  if (botsHost) {
    botsHost.value =
      engine.llmHostMode || 'other-pc';
  }

  const botsModel =
    document.getElementById('bots-ollama-model');
  if (botsModel) {
    ensureModelOption(botsModel, engine.model);
    botsModel.value = engine.model || '';
  }

  if (rpIdentityName) {
    rpIdentityName.value =
      engine.identityName || 'Bot';
  }

  applyIdentityLabels(
    engine.identityName || 'Bot'
  );

  if (fordMood) {
    fordMood.value =
      normalizeUiChatMode(engine.behaviorMode);
  }

  const chatFlowMode =
    document.getElementById('chat-flow-mode');
  if (chatFlowMode) {
    chatFlowMode.value =
      normalizeUiChatMode(engine.behaviorMode);
  }

  sttUrl.value =
    engine.sttUrl;

  omnivoiceUrl.value =
    engine.omnivoiceUrl;

  omnivoiceSpeed.value =
    String(
      engine.omnivoiceSpeed
    );

  omnivoiceSteps.value =
    String(
      engine.omnivoiceSteps
    );

  ensureOmniVoiceSelection(
    engine.omnivoiceVoice
  );

  voiceAutoReply.checked =
    engine.autoReply;
}

async function refreshOmniVoiceVoices(
  selectedVoice = null
) {
  if (
    !window.zelloBot?.voiceBot ||
    !omnivoiceVoice
  ) {
    return;
  }

  const keepVoice =
    selectedVoice === null
      ? omnivoiceVoice.value
      : selectedVoice;

  if (omnivoiceRefreshButton) {
    omnivoiceRefreshButton.disabled =
      true;

    omnivoiceRefreshButton.textContent =
      'Checking...';
  }

  if (omnivoiceHealth) {
    omnivoiceHealth.textContent =
      'Checking OmniVoice...';
  }

  try {
    const health =
      await window.zelloBot
        .voiceBot
        .omnivoiceHealth();

    const voices =
      await window.zelloBot
        .voiceBot
        .omnivoiceVoices();

    omnivoiceVoice.innerHTML =
      '';

    const defaultOption =
      document.createElement(
        'option'
      );

    defaultOption.value = '';
    defaultOption.textContent =
      'Default voice';

    omnivoiceVoice.appendChild(
      defaultOption
    );

    voices.forEach(
      (voice) => {
        const option =
          document.createElement(
            'option'
          );

        option.value =
          voice;

        option.textContent =
          voice;

        omnivoiceVoice.appendChild(
          option
        );
      }
    );

    ensureOmniVoiceSelection(
      keepVoice
    );

    if (omnivoiceHealth) {
      const device =
        health &&
        typeof health.device === 'string' &&
        health.device
          ? ' - ' + health.device
          : '';

      omnivoiceHealth.textContent =
        health &&
        health.ready === false
          ? 'OmniVoice loading'
          : 'OmniVoice ready' +
            device;
    }
  } catch (error) {
    ensureOmniVoiceSelection(
      keepVoice
    );

    if (omnivoiceHealth) {
      omnivoiceHealth.textContent =
        'OmniVoice offline';
    }
  } finally {
    if (omnivoiceRefreshButton) {
      omnivoiceRefreshButton.disabled =
        false;

      omnivoiceRefreshButton.textContent =
        'Refresh';
    }
  }
}

async function loadEngineSettings() {
  if (!window.zelloBot?.settings) {
    return;
  }

  try {
    const settings =
      await window.zelloBot.settings.get();

    const engine =
      normalizeEngineSettings(
        settings
      );

    populateEngineSettings(
      engine
    );

    await refreshOmniVoiceVoices(
      engine.omnivoiceVoice
    );
  } catch {
    appStatus.textContent =
      'AI Settings Load Failed';
  }
}

if (omnivoiceRefreshButton) {
  omnivoiceRefreshButton.addEventListener(
    'click',
    async () => {
      await refreshOmniVoiceVoices();
    }
  );
}

if (voiceEngineForm) {
  voiceEngineForm.addEventListener(
    'submit',
    async (event) => {
      event.preventDefault();

      if (!window.zelloBot?.settings) {
        return;
      }

      voiceEngineSaveButton.disabled =
        true;

      voiceEngineSaveButton.textContent =
        'Saving...';

      if (voiceEngineSaveStatus) {
        voiceEngineSaveStatus.textContent =
          'Saving...';
      }

      try {
        const current =
          await window.zelloBot.settings.get();

        const saved =
          await window.zelloBot.settings.save({
            ...current,

            ai: {
              ...(current.ai || {}),

              ollamaUrlThisPc:
                (ollamaUrlThisPc &&
                  ollamaUrlThisPc.value.trim()) ||
                current.ai?.ollamaUrlThisPc ||
                'http://127.0.0.1:11434',

              ollamaUrlOtherPc:
                (ollamaUrlOtherPc &&
                  ollamaUrlOtherPc.value.trim()) ||
                current.ai?.ollamaUrlOtherPc ||
                'http://192.168.1.92:11434',

              llmHostMode:
                llmHostMode
                  ? llmHostMode.value
                  : 'auto',

              ollamaUrl:
                (
                  llmHostMode &&
                  llmHostMode.value === 'this-pc'
                    ? (
                        ollamaUrlThisPc &&
                        ollamaUrlThisPc.value.trim()
                      )
                    : (
                        ollamaUrlOtherPc &&
                        ollamaUrlOtherPc.value.trim()
                      )
                ) ||
                ollamaUrl.value.trim() ||
                'http://192.168.1.92:11434',

              model:
                ollamaModel.value.trim() ||
                'qwen2.5vl:3b',

              identityName:
                getActiveIdentityName(),

              autoReply:
                voiceAutoReply.checked,

              behaviorMode: normalizeUiChatMode(
                fordMood
                  ? fordMood.value
                  : 'banter'
              )
            },

            multiBot: {
              ...(current.multiBot || {}),
              chatMode: normalizeUiChatMode(
                fordMood
                  ? fordMood.value
                  : current.multiBot?.chatMode ||
                    'banter'
              )
            },

            speech: {
              sttMode:
                'http',

              sttUrl:
                sttUrl.value.trim() ||
                'http://127.0.0.1:9000/v1/audio/transcriptions',

              ttsProvider:
                'omnivoice',

              omnivoiceUrl:
                omnivoiceUrl.value.trim() ||
                'http://127.0.0.1:8002',

              omnivoiceVoice:
                omnivoiceVoice.value,

              omnivoiceSpeed:
                Number(
                  omnivoiceSpeed.value
                ) || 1,

              omnivoiceSteps:
                Number(
                  omnivoiceSteps.value
                ) || 32
            }
          });

        const engine =
          normalizeEngineSettings(
            saved
          );

        populateEngineSettings(
          engine
        );

        await refreshBrainHostStatus();

        appStatus.textContent =
          'Local AI + Voice Saved';

        if (voiceEngineSaveStatus) {
          voiceEngineSaveStatus.textContent =
            'Saved';
        }

        await refreshOmniVoiceVoices(
          engine.omnivoiceVoice
        );
      } catch {
        appStatus.textContent =
          'AI + Voice Save Failed';

        if (voiceEngineSaveStatus) {
          voiceEngineSaveStatus.textContent =
            'Save failed';
        }
      } finally {
        voiceEngineSaveButton.disabled =
          false;

        voiceEngineSaveButton.textContent =
          'Save ' +
          getActiveIdentityName();
      }
    }
  );
}
function getVoiceBotStatusLabel(
  status
) {
  switch (status) {
    case 'transcribing':
      return 'Listening';

    case 'thinking':
      return 'Thinking';

    case 'speaking':
      return 'Speaking';

    case 'error':
      return 'Error';

    case 'configuration-error':
      return 'Needs setup';

    default:
      return 'Idle';
  }
}

function getBehaviorDisplayName(
  mode
) {
  const labels = {
    chat: 'Chat',
    banter: 'Banter',
    argument: 'Argument',
    extreme: 'Extreme',
    nice: 'Chat',
    annoyed: 'Banter',
    angry: 'Argument'
  };

  return (
    labels[mode] ||
    'Banter'
  );
}

function normalizeUiChatMode(mode) {
  const raw = String(mode || '').trim().toLowerCase();
  const legacy = {
    nice: 'chat',
    annoyed: 'banter',
    angry: 'argument'
  };
  const mapped = legacy[raw] || raw;
  if (
    mapped === 'chat' ||
    mapped === 'banter' ||
    mapped === 'argument' ||
    mapped === 'extreme'
  ) {
    return mapped;
  }
  return 'banter';
}
function formatVoiceActivityTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '--:--:--';
  }

  return date.toLocaleTimeString(
    [],
    {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }
  );
}

function renderVoiceActivityLog(entries) {
  if (
    !voiceActivityLog ||
    !voiceActivityCount
  ) {
    return;
  }

  const list =
    Array.isArray(entries)
      ? entries
      : [];

  voiceActivityCount.textContent =
    list.length +
    (
      list.length === 1
        ? ' event'
        : ' events'
    );

  if (!list.length) {
    voiceActivityLog.innerHTML =
      '<div class="voice-activity-empty">' +
      'Waiting for voice activity...' +
      '</div>';

    lastVoiceActivityId = 0;
    return;
  }

  const newest =
    Number(
      list[list.length - 1]?.id || 0
    );

  if (
    newest &&
    newest === lastVoiceActivityId
  ) {
    return;
  }

  const fragment =
    document.createDocumentFragment();

  list.forEach((entry) => {
    const row =
      document.createElement('div');

    row.className =
      'voice-activity-row';

    if (entry.level === 'error') {
      row.classList.add('is-error');
    }

    const time =
      document.createElement('span');

    time.className =
      'voice-activity-time';

    time.textContent =
      formatVoiceActivityTime(entry.at);

    const source =
      document.createElement('span');

    source.className =
      'voice-activity-source';

    source.textContent =
      entry.source || 'System';

    const message =
      document.createElement('span');

    message.className =
      'voice-activity-message';

    message.textContent =
      entry.message || '';

    row.append(
      time,
      source,
      message
    );

    fragment.appendChild(row);
  });

  voiceActivityLog.replaceChildren(
    fragment
  );

  voiceActivityLog.scrollTop =
    voiceActivityLog.scrollHeight;

  lastVoiceActivityId = newest;
}
function renderVoiceBotStatus(
  status
) {
  if (
    !status ||
    typeof status !== 'object'
  ) {
    return;
  }

  voiceBotState.textContent =
    getVoiceBotStatusLabel(
      status.status
    );

  voiceBotSpeaker.textContent =
    status.speaker ||
    'None';

  voiceBotBehavior.textContent =
    getBehaviorDisplayName(
      status.behaviorMode
    );

  voiceBotTranscript.textContent =
    status.transcript ||
    'Waiting for speech';

  voiceBotResponse.textContent =
    status.responseText ||
    'No response yet';

  const error =
    typeof status.lastError === 'string'
      ? status.lastError.trim()
      : '';

  voiceBotError.textContent =
    error;

  voiceBotError.classList.toggle(
    'is-hidden',
    !error
  );

  renderVoiceActivityLog(
    status.activityLog
  );
}

async function loadVoiceBotStatus() {
  if (!window.zelloBot?.voiceBot) {
    return;
  }

  try {
    const status =
      await window.zelloBot.voiceBot.status();

    renderVoiceBotStatus(
      status
    );
  } catch {
    appStatus.textContent =
      'Voice Bot Status Failed';
  }
}

navigationItems.forEach((item) => {
  item.addEventListener('click', () => {
    showSection(item.dataset.section);
  });
});

if (threadLeadButton) {
  threadLeadButton.addEventListener(
    'click',
    openOrCreateProfileForConversation
  );
}

if (leadOpenConversationButton) {
  leadOpenConversationButton.addEventListener(
    'click',
    openConversationForSelectedProfile
  );
}

messageForm.addEventListener(
  'submit',
  async (event) => {
    event.preventDefault();

    if (
      !selectedConversationId ||
      !window.zelloBot?.conversations
    ) {
      return;
    }

    const text = messageInput.value.trim();

    if (!text) {
      return;
    }

    messageInput.disabled = true;
    sendMessageButton.disabled = true;
    sendMessageButton.textContent =
      'Sending...';

    try {
      await window.zelloBot.conversations
        .sendMessage(
          selectedConversationId,
          text
        );

      messageInput.value = '';

      await loadConversations();

      appStatus.textContent =
        'Desktop Ready';
    } catch {
      appStatus.textContent =
        'Send Failed';
    } finally {
      messageInput.disabled = false;
      sendMessageButton.disabled = false;
      sendMessageButton.textContent = 'Send';
      messageInput.focus();
    }
  }
);

leadEditor.addEventListener(
  'submit',
  async (event) => {
    event.preventDefault();

    if (
      !selectedProfileId ||
      !window.zelloBot?.leads
    ) {
      return;
    }

    leadSaveButton.disabled = true;
    leadSaveButton.textContent =
      'Saving...';

    try {
      await window.zelloBot.leads.update(
        selectedProfileId,
        {
          behaviorMode:
            leadBehaviorMode.value,
          notes: leadNotes.value
        }
      );

      await loadProfiles();

      appStatus.textContent =
        'Desktop Ready';
    } catch {
      appStatus.textContent =
        'Profile Save Failed';
    } finally {
      leadSaveButton.disabled = false;
      leadSaveButton.textContent =
        'Save profile';
    }
  }
);

async function initializeLocalData() {
  await loadConversations();
  await loadProfiles();
  await loadZelloSettings();
  await loadZelloRuntimeStatus();

  await loadAudioPipelineStatus();
  await loadEngineSettings();
  await loadVoiceBotStatus();

  setInterval(
    loadZelloRuntimeStatus,
    2000
  );

  setInterval(
    loadAudioPipelineStatus,
    500
  );

  setInterval(
    loadVoiceBotStatus,
    500
  );
}

if (window.zelloBot) {
  runtimeLabel.textContent =
    window.zelloBot.platform;

  appStatus.textContent =
    'Desktop Ready';

  document.getElementById(
    'platform-value'
  ).textContent =
    window.zelloBot.platform;

  document.getElementById(
    'electron-value'
  ).textContent =
    window.zelloBot.versions.electron;

  document.getElementById(
    'node-value'
  ).textContent =
    window.zelloBot.versions.node;

  document.getElementById(
    'chrome-value'
  ).textContent =
    window.zelloBot.versions.chrome;

  initializeLocalData();
} else {
  runtimeLabel.textContent =
    'Bridge unavailable';

  appStatus.textContent =
    'Runtime Error';
}
// Premium dashboard: read-only hardware monitor.
function clampSystemPercent(value) {
  const number =
    Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(number)
    )
  );
}

function formatSystemGiB(bytes) {
  const number =
    Number(bytes);

  if (!Number.isFinite(number)) {
    return '--';
  }

  return (
    number /
    1024 /
    1024 /
    1024
  ).toFixed(1) + ' GB';
}

function setSystemBar(
  elementId,
  percent
) {
  const element =
    document.getElementById(
      elementId
    );

  if (!element) {
    return;
  }

  element.style.width =
    clampSystemPercent(
      percent
    ) +
    '%';
}

function setSystemText(
  elementId,
  value
) {
  const element =
    document.getElementById(
      elementId
    );

  if (element) {
    element.textContent =
      value;
  }
}

async function loadSystemPerformance() {
  if (
    !window.zelloBot ||
    !window.zelloBot.system ||
    !window.zelloBot.system.status
  ) {
    return;
  }

  try {
    const status =
      await window.zelloBot
        .system
        .status();

    const cpu =
      status &&
      status.cpu
        ? status.cpu
        : {};

    const memory =
      status &&
      status.memory
        ? status.memory
        : {};

    const gpu =
      status &&
      status.gpu
        ? status.gpu
        : {};

    const cpuPercent =
      clampSystemPercent(
        cpu.usagePercent
      );

    setSystemText(
      'system-cpu-name',
      cpu.model ||
        'Unknown processor'
    );

    setSystemText(
      'system-cpu-util',
      cpuPercent + '%'
    );

    setSystemText(
      'system-cpu-detail',
      (
        Number.isFinite(
          Number(
            cpu.logicalCores
          )
        )
          ? cpu.logicalCores +
            ' logical cores'
          : '--'
      )
    );

    setSystemBar(
      'system-cpu-util-bar',
      cpuPercent
    );

    const ramPercent =
      clampSystemPercent(
        memory.usagePercent
      );

    setSystemText(
      'system-ram-util',
      ramPercent + '%'
    );

    setSystemText(
      'system-ram-used',
      formatSystemGiB(
        memory.usedBytes
      ) +
        ' used'
    );

    setSystemText(
      'system-ram-total',
      formatSystemGiB(
        memory.totalBytes
      ) +
        ' installed'
    );

    setSystemBar(
      'system-ram-util-bar',
      ramPercent
    );

    if (gpu.available) {
      const gpuPercent =
        clampSystemPercent(
          gpu.utilizationPercent
        );

      const usedMb =
        Number(
          gpu.memoryUsedMb
        );

      const totalMb =
        Number(
          gpu.memoryTotalMb
        );

      const vramPercent =
        Number.isFinite(
          usedMb
        ) &&
        Number.isFinite(
          totalMb
        ) &&
        totalMb > 0
          ? clampSystemPercent(
              usedMb /
              totalMb *
              100
            )
          : 0;

      setSystemText(
        'system-gpu-name',
        gpu.name ||
          'NVIDIA GPU'
      );

      setSystemText(
        'system-gpu-util',
        gpuPercent +
          '%'
      );

      setSystemBar(
        'system-gpu-util-bar',
        gpuPercent
      );

      setSystemText(
        'system-gpu-vram',
        (
          Number.isFinite(
            usedMb
          )
            ? (
                usedMb /
                1024
              ).toFixed(1)
            : '--'
        ) +
          ' / ' +
          (
            Number.isFinite(
              totalMb
            )
              ? (
                  totalMb /
                  1024
                ).toFixed(1)
              : '--'
          ) +
          ' GB'
      );

      setSystemBar(
        'system-gpu-vram-bar',
        vramPercent
      );

      setSystemText(
        'system-gpu-temp',
        Number.isFinite(
          Number(
            gpu.temperatureC
          )
        )
          ? gpu.temperatureC +
            ' C'
          : '--'
      );

      setSystemText(
        'system-gpu-driver',
        gpu.driver ||
          '--'
      );

      setSystemText(
        'system-gpu-power',
        Number.isFinite(
          Number(
            gpu.powerWatts
          )
        )
          ? Number(
              gpu.powerWatts
            ).toFixed(0) +
            ' W'
          : '--'
      );

      setSystemText(
        'system-gpu-fan',
        Number.isFinite(
          Number(
            gpu.fanPercent
          )
        )
          ? Number(
              gpu.fanPercent
            ).toFixed(0) +
            '%'
          : '--'
      );

      setSystemText(
        'system-gpu-clock',
        Number.isFinite(
          Number(
            gpu.graphicsClockMhz
          )
        )
          ? gpu.graphicsClockMhz +
            ' MHz'
          : '--'
      );

      setSystemText(
        'system-gpu-memory-clock',
        Number.isFinite(
          Number(
            gpu.memoryClockMhz
          )
        )
          ? gpu.memoryClockMhz +
            ' MHz'
          : '--'
      );
    } else {
      setSystemText(
        'system-gpu-name',
        'NVIDIA GPU data unavailable'
      );

      setSystemText(
        'system-gpu-util',
        '--'
      );

      setSystemText(
        'system-gpu-vram',
        '--'
      );

      setSystemBar(
        'system-gpu-util-bar',
        0
      );

      setSystemBar(
        'system-gpu-vram-bar',
        0
      );
    }

    setSystemText(
      'system-status-updated',
      'Updated ' +
        new Date(
          status.timestamp ||
          Date.now()
        ).toLocaleTimeString(
          [],
          {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          }
        )
    );
  } catch {
    setSystemText(
      'system-status-updated',
      'Monitor unavailable'
    );
  }
}

if (
  window.zelloBot &&
  window.zelloBot.system &&
  window.zelloBot.system.status
) {
  loadSystemPerformance();

  setInterval(
    loadSystemPerformance,
    2000
  );
}

function bindLeftRackTabs() {
  const tabs = Array.from(
    document.querySelectorAll('[data-left-tab]')
  );
  const pages = Array.from(
    document.querySelectorAll('[data-left-page]')
  );

  if (!tabs.length || !pages.length) {
    return;
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.getAttribute('data-left-tab');

      tabs.forEach((item) => {
        item.classList.toggle(
          'is-active',
          item === tab
        );
      });

      pages.forEach((page) => {
        page.classList.toggle(
          'is-active',
          page.getAttribute('data-left-page') === name
        );
      });
    });
  });
}

async function refreshBrainHostStatus() {
  const botsBrain =
    document.getElementById('bots-brain-status');
  const botsConfirm =
    document.getElementById('bots-brain-confirm');
  const modelStatus =
    document.getElementById('ollama-model-status');
  const botsHost =
    document.getElementById('bots-llm-host-mode');
  const botsModel =
    document.getElementById('bots-ollama-model');

  if (llmHostStatus) {
    llmHostStatus.textContent = 'Brain: checking…';
  }
  if (botsBrain) {
    botsBrain.textContent = 'Brain: …';
    botsBrain.classList.remove('is-ok', 'is-bad');
  }
  if (botsConfirm) {
    botsConfirm.textContent = 'Checking brain host + models…';
    botsConfirm.classList.remove('is-ok', 'is-bad', 'is-warn');
  }
  if (modelStatus) {
    modelStatus.textContent = 'Models: loading…';
  }

  try {
    if (
      !window.zelloBot ||
      !window.zelloBot.llm ||
      !(
        window.zelloBot.llm.snapshot ||
        window.zelloBot.llm.resolve
      )
    ) {
      const msg = 'Brain: resolver unavailable';
      if (llmHostStatus) {
        llmHostStatus.textContent = msg;
      }
      if (botsBrain) {
        botsBrain.textContent = msg;
        botsBrain.classList.add('is-bad');
      }
      if (botsConfirm) {
        botsConfirm.textContent = msg;
        botsConfirm.classList.add('is-bad');
      }
      return;
    }

    const snapFn =
      window.zelloBot.llm.snapshot ||
      window.zelloBot.llm.resolve;
    const result = await snapFn({ force: true });

    const hostLabel =
      result.hostLabel ||
      (result.llmHost === 'other-pc'
        ? 'Other PC'
        : 'This PC');

    if (ollamaUrl) {
      ollamaUrl.value = result.ollamaUrl || '';
    }

    if (llmHostMode && result.llmHostMode) {
      llmHostMode.value = result.llmHostMode;
    }
    if (botsHost && result.llmHostMode) {
      botsHost.value = result.llmHostMode;
    }

    fillModelSelect(
      ollamaModel,
      result.modelsActive || [],
      result.modelConfigured || result.modelActive || ''
    );
    fillModelSelect(
      botsModel,
      result.modelsActive || [],
      result.modelConfigured || result.modelActive || ''
    );

    const online = result.reachable !== false;
    const activeModel =
      result.modelActive ||
      result.modelConfigured ||
      '';
    const detail =
      result.confirmation ||
      (
        (online ? 'ACTIVE' : 'OFFLINE') +
        ' · ' +
        hostLabel +
        (activeModel ? ' · ' + activeModel : '') +
        ' @ ' +
        (result.ollamaUrl || '?')
      );

    if (llmHostStatus) {
      llmHostStatus.textContent = detail;
      llmHostStatus.classList.toggle('is-ok', online);
      llmHostStatus.classList.toggle('is-bad', !online);
      llmHostStatus.classList.toggle(
        'is-warn',
        online && result.modelFallback === true
      );
    }
    if (botsConfirm) {
      botsConfirm.textContent = detail;
      botsConfirm.classList.toggle('is-ok', online);
      botsConfirm.classList.toggle('is-bad', !online);
      botsConfirm.classList.toggle(
        'is-warn',
        online && result.modelFallback === true
      );
    }
    if (botsBrain) {
      botsBrain.textContent =
        (online ? 'Brain online' : 'Brain offline') +
        ' · ' +
        hostLabel +
        (activeModel ? ' · ' + activeModel : '');
      botsBrain.classList.toggle('is-ok', online);
      botsBrain.classList.toggle('is-bad', !online);
    }
    if (modelStatus) {
      const thisN = (result.modelsThisPc || []).length;
      const otherN = (result.modelsOtherPc || []).length;
      const activeN = (result.modelsActive || []).length;
      modelStatus.textContent =
        'Models on ' +
        hostLabel +
        ': ' +
        activeN +
        ' · This PC ' +
        (result.thisPcOnline
          ? thisN + ' models'
          : 'offline') +
        ' · Other PC ' +
        (result.otherPcOnline
          ? otherN + ' models'
          : 'offline') +
        (result.modelFallback
          ? ' · using fallback model (configured model missing)'
          : result.modelOnHost
            ? ' · selected model is on this host'
            : '');
      modelStatus.classList.toggle(
        'is-warn',
        result.modelFallback === true
      );
    }

    updateActiveModelBadges(
      (online ? 'ACTIVE' : 'OFFLINE') +
        ' · ' +
        hostLabel +
        ' · ' +
        (activeModel || '(no model)') +
        (result.modelFallback ? ' (fallback)' : '')
    );
  } catch (error) {
    const msg =
      'Brain check failed: ' +
      (error && error.message
        ? error.message
        : String(error));
    if (llmHostStatus) {
      llmHostStatus.textContent = msg;
      llmHostStatus.classList.add('is-bad');
    }
    if (botsBrain) {
      botsBrain.textContent = 'Brain offline';
      botsBrain.classList.add('is-bad');
    }
    if (botsConfirm) {
      botsConfirm.textContent = msg;
      botsConfirm.classList.add('is-bad');
    }
    if (modelStatus) {
      modelStatus.textContent = 'Models: failed to load';
    }
  }
}

function ensureModelOption(selectEl, modelName) {
  if (!selectEl || !(selectEl instanceof HTMLSelectElement)) {
    return;
  }
  const value = String(modelName || '').trim();
  if (!value) return;
  const exists = [...selectEl.options].some(
    (opt) => opt.value === value
  );
  if (!exists) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value + ' (saved)';
    selectEl.appendChild(opt);
  }
}

function fillModelSelect(selectEl, models, selected) {
  if (!selectEl || !(selectEl instanceof HTMLSelectElement)) {
    return;
  }
  const list = Array.isArray(models) ? models : [];
  const want = String(selected || '').trim();
  const previous = selectEl.value;
  selectEl.innerHTML = '';

  if (!list.length) {
    const empty = document.createElement('option');
    empty.value = want || '';
    empty.textContent = want
      ? want + ' (host offline / no models)'
      : '(no models on this host)';
    selectEl.appendChild(empty);
    selectEl.value = empty.value;
    return;
  }

  for (const name of list) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    selectEl.appendChild(opt);
  }

  if (want && !list.includes(want)) {
    const opt = document.createElement('option');
    opt.value = want;
    opt.textContent = want + ' (not on this host)';
    selectEl.appendChild(opt);
  }

  const pick =
    (want && (list.includes(want) || want)) ||
    previous ||
    list[0] ||
    '';
  selectEl.value = pick;
}

async function saveBrainHostAndModel({
  hostMode,
  model,
  quiet
} = {}) {
  if (!window.zelloBot?.settings?.save) {
    return null;
  }

  const current = await window.zelloBot.settings.get();
  const mode =
    hostMode ||
    llmHostMode?.value ||
    current.ai?.llmHostMode ||
    'other-pc';
  const modelName =
    (typeof model === 'string' ? model : '') ||
    ollamaModel?.value ||
    current.ai?.model ||
    '';

  const thisUrl =
    (ollamaUrlThisPc && ollamaUrlThisPc.value.trim()) ||
    current.ai?.ollamaUrlThisPc ||
    'http://127.0.0.1:11434';
  const otherUrl =
    (ollamaUrlOtherPc && ollamaUrlOtherPc.value.trim()) ||
    current.ai?.ollamaUrlOtherPc ||
    'http://192.168.1.92:11434';
  const activeUrl =
    mode === 'this-pc' ? thisUrl : otherUrl;

  if (window.zelloBot.llm?.clearCache) {
    await window.zelloBot.llm.clearCache();
  }

  const saved = await window.zelloBot.settings.save({
    ...current,
    ai: {
      ...(current.ai || {}),
      llmHostMode: mode,
      ollamaUrlThisPc: thisUrl,
      ollamaUrlOtherPc: otherUrl,
      ollamaUrl: activeUrl,
      model: modelName
    }
  });

  if (llmHostMode) {
    llmHostMode.value = mode;
  }
  const botsHost =
    document.getElementById('bots-llm-host-mode');
  if (botsHost) {
    botsHost.value = mode;
  }
  if (ollamaModel && modelName) {
    ensureModelOption(ollamaModel, modelName);
    ollamaModel.value = modelName;
  }
  const botsModel =
    document.getElementById('bots-ollama-model');
  if (botsModel && modelName) {
    ensureModelOption(botsModel, modelName);
    botsModel.value = modelName;
  }
  if (ollamaUrl) {
    ollamaUrl.value = activeUrl;
  }

  await refreshBrainHostStatus();

  if (!quiet && appStatus) {
    appStatus.textContent =
      'Brain → ' +
      (mode === 'this-pc'
        ? 'This PC'
        : mode === 'other-pc'
          ? 'Other PC'
          : 'Auto') +
      (modelName ? ' · ' + modelName : '');
  }

  return saved;
}

async function refreshBotsServiceStatus() {
  const ovEl =
    document.getElementById('bots-omnivoice-status');
  const sttEl =
    document.getElementById('bots-stt-status');

  await refreshBrainHostStatus();

  if (ovEl) {
    ovEl.textContent = 'OmniVoice: …';
    ovEl.classList.remove('is-ok', 'is-bad');
    try {
      const health =
        await window.zelloBot.voiceBot.omnivoiceHealth();
      const ok = health && health.ready !== false;
      ovEl.textContent =
        ok
          ? 'OmniVoice ready' +
            (health.device ? ' · ' + health.device : '')
          : 'OmniVoice loading';
      ovEl.classList.toggle('is-ok', ok);
      ovEl.classList.toggle('is-bad', !ok);
      if (omnivoiceHealth) {
        omnivoiceHealth.textContent = ovEl.textContent;
      }
    } catch {
      ovEl.textContent = 'OmniVoice offline';
      ovEl.classList.add('is-bad');
    }
  }

  if (sttEl) {
    sttEl.textContent = 'STT: …';
    sttEl.classList.remove('is-ok', 'is-bad');
    try {
      if (
        !window.zelloBot?.voiceBot?.sttHealth
      ) {
        sttEl.textContent = 'STT: n/a';
        return;
      }
      const health =
        await window.zelloBot.voiceBot.sttHealth();
      const ok = health && health.ok;
      sttEl.textContent = ok ? 'STT ready' : 'STT offline';
      sttEl.classList.toggle('is-ok', !!ok);
      sttEl.classList.toggle('is-bad', !ok);
    } catch {
      sttEl.textContent = 'STT offline';
      sttEl.classList.add('is-bad');
    }
  }
}

bindLeftRackTabs();

if (llmHostMode) {
  llmHostMode.addEventListener('change', () => {
    saveBrainHostAndModel({
      hostMode: llmHostMode.value
    }).catch(() => {});
  });
}

document
  .getElementById('bots-llm-host-mode')
  ?.addEventListener('change', (event) => {
    const mode = event.target.value;
    saveBrainHostAndModel({ hostMode: mode }).catch(
      () => {}
    );
  });

if (ollamaModel) {
  ollamaModel.addEventListener('change', () => {
    saveBrainHostAndModel({
      model: ollamaModel.value
    }).catch(() => {});
  });
}

document
  .getElementById('bots-ollama-model')
  ?.addEventListener('change', (event) => {
    saveBrainHostAndModel({
      model: event.target.value
    }).catch(() => {});
  });

document
  .getElementById('ollama-refresh-models')
  ?.addEventListener('click', () => {
    if (window.zelloBot?.llm?.clearCache) {
      window.zelloBot.llm.clearCache().finally(() => {
        refreshBrainHostStatus();
      });
    } else {
      refreshBrainHostStatus();
    }
  });

document
  .getElementById('bots-brain-refresh')
  ?.addEventListener('click', () => {
    if (window.zelloBot?.llm?.clearCache) {
      window.zelloBot.llm.clearCache().finally(() => {
        refreshBotsServiceStatus();
      });
    } else {
      refreshBotsServiceStatus();
    }
  });

const chatFlowModeEl =
  document.getElementById('chat-flow-mode');
if (chatFlowModeEl && fordMood) {
  chatFlowModeEl.addEventListener('change', () => {
    fordMood.value = normalizeUiChatMode(
      chatFlowModeEl.value
    );
  });
  fordMood.addEventListener('change', () => {
    chatFlowModeEl.value = normalizeUiChatMode(
      fordMood.value
    );
  });
}

function syncBotsVoicePresetFromSteps() {
  const botsPreset =
    document.getElementById('bots-voice-preset');
  const botsSteps =
    document.getElementById('bots-omnivoice-steps');
  // NOTE: function body continues below in file — do not duplicate
  if (!botsPreset || !botsSteps) return;
  const n = Number(botsSteps.value) || 6;
  if (n <= 7) botsPreset.value = 'fast';
  else if (n >= 13) botsPreset.value = 'quality';
  else botsPreset.value = 'balanced';
}

document
  .getElementById('bots-voice-preset')
  ?.addEventListener('change', (event) => {
    const preset = event.target?.value;
    const botsSteps =
      document.getElementById('bots-omnivoice-steps');
    const map = { fast: 6, balanced: 10, quality: 14 };
    const steps = map[preset] || 6;
    if (botsSteps) {
      botsSteps.value = String(steps);
    }
    if (omnivoiceSteps) {
      omnivoiceSteps.value = String(steps);
    }
    scheduleRosterAutosave();
  });

document
  .getElementById('bots-omnivoice-steps')
  ?.addEventListener('change', () => {
    syncBotsVoicePresetFromSteps();
    const botsSteps =
      document.getElementById('bots-omnivoice-steps');
    if (omnivoiceSteps && botsSteps) {
      omnivoiceSteps.value = botsSteps.value;
    }
    scheduleRosterAutosave();
  });

document
  .getElementById('bots-omnivoice-speed')
  ?.addEventListener('change', () => {
    const botsSpeed =
      document.getElementById('bots-omnivoice-speed');
    if (omnivoiceSpeed && botsSpeed) {
      omnivoiceSpeed.value = botsSpeed.value;
    }
    scheduleRosterAutosave();
  });

refreshBotsServiceStatus();
setInterval(refreshBotsServiceStatus, 12000);