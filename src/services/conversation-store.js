const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEMO_CONVERSATIONS = [
  {
    id: 'demo-maya',
    customerName: 'Maya Chen',
    channel: 'Marketplace',
    status: 'open',
    updatedAt: '2026-09-03T15:42:00.000Z',
    messages: [
      {
        id: 'demo-maya-1',
        direction: 'inbound',
        text: 'Hi, is the desk still available?',
        createdAt: '2026-09-03T15:31:00.000Z'
      },
      {
        id: 'demo-maya-2',
        direction: 'outbound',
        text: 'Yes, it is still available. Would you like pickup details?',
        createdAt: '2026-09-03T15:35:00.000Z'
      },
      {
        id: 'demo-maya-3',
        direction: 'inbound',
        text: 'Yes please. I could pick it up tomorrow afternoon.',
        createdAt: '2026-09-03T15:42:00.000Z'
      }
    ]
  },
  {
    id: 'demo-lucas',
    customerName: 'Lucas Martins',
    channel: 'Direct',
    status: 'open',
    updatedAt: '2026-09-03T13:18:00.000Z',
    messages: [
      {
        id: 'demo-lucas-1',
        direction: 'inbound',
        text: 'Can you do 85 for the chair?',
        createdAt: '2026-09-03T13:18:00.000Z'
      }
    ]
  },
  {
    id: 'demo-sophie',
    customerName: 'Sophie de Vries',
    channel: 'Marketplace',
    status: 'closed',
    updatedAt: '2026-09-02T18:06:00.000Z',
    messages: [
      {
        id: 'demo-sophie-1',
        direction: 'inbound',
        text: 'Thanks, everything worked out perfectly.',
        createdAt: '2026-09-02T18:06:00.000Z'
      }
    ]
  }
];

class ConversationStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'conversations.json');
  }

  ensureFile() {
    if (fs.existsSync(this.filePath)) {
      return;
    }

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(
      this.filePath,
      JSON.stringify(DEMO_CONVERSATIONS, null, 2),
      'utf8'
    );
  }

  readAll() {
    try {
      this.ensureFile();
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((conversation) => this.sanitizeConversation(conversation))
        .filter(Boolean)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch {
      return [];
    }
  }

  getById(id) {
    return this.readAll().find((conversation) => conversation.id === id) || null;
  }

  sendMessage(conversationId, text) {
    const cleanText = typeof text === 'string'
      ? text.trim().slice(0, 4000)
      : '';

    if (!cleanText) {
      throw new Error('Message text is required.');
    }

    const conversations = this.readAll();
    const conversation = conversations.find(
      (item) => item.id === conversationId
    );

    if (!conversation) {
      throw new Error('Conversation not found.');
    }

    const createdAt = new Date().toISOString();
    const message = {
      id: crypto.randomUUID(),
      direction: 'outbound',
      text: cleanText,
      createdAt
    };

    conversation.messages.push(message);
    conversation.updatedAt = createdAt;
    conversation.status = 'open';

    this.writeAll(conversations);

    return {
      conversation,
      message
    };
  }

  writeAll(conversations) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(
      this.filePath,
      JSON.stringify(conversations, null, 2),
      'utf8'
    );
  }

  sanitizeConversation(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    if (typeof value.id !== 'string' || !value.id.trim()) {
      return null;
    }

    const messages = Array.isArray(value.messages)
      ? value.messages
          .map((message) => this.sanitizeMessage(message))
          .filter(Boolean)
      : [];

    const fallbackUpdatedAt =
      messages.length > 0
        ? messages[messages.length - 1].createdAt
        : new Date(0).toISOString();

    return {
      id: value.id.trim().slice(0, 120),
      customerName:
        typeof value.customerName === 'string' && value.customerName.trim()
          ? value.customerName.trim().slice(0, 120)
          : 'Unknown customer',
      channel:
        typeof value.channel === 'string' && value.channel.trim()
          ? value.channel.trim().slice(0, 80)
          : 'Local',
      status: value.status === 'closed' ? 'closed' : 'open',
      updatedAt:
        typeof value.updatedAt === 'string' && value.updatedAt
          ? value.updatedAt
          : fallbackUpdatedAt,
      messages
    };
  }

  sanitizeMessage(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    if (typeof value.text !== 'string' || !value.text.trim()) {
      return null;
    }

    return {
      id:
        typeof value.id === 'string' && value.id.trim()
          ? value.id.trim().slice(0, 120)
          : crypto.randomUUID(),
      direction: value.direction === 'outbound' ? 'outbound' : 'inbound',
      text: value.text.trim().slice(0, 4000),
      createdAt:
        typeof value.createdAt === 'string' && value.createdAt
          ? value.createdAt
          : new Date().toISOString()
    };
  }
}

module.exports = {
  ConversationStore
};