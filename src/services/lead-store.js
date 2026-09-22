const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VALID_STAGES = new Set([
  'new',
  'contacted',
  'qualified',
  'negotiating',
  'won',
  'lost'
]);

const VALID_PRIORITIES = new Set([
  'cold',
  'warm',
  'hot'
]);

const VALID_BEHAVIOR_MODES = new Set([
  'chat',
  'banter',
  'roasting',
  'aggressive',
  'extreme-aggressive'
]);

class LeadStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'leads.json');
  }

  ensureFile() {
    if (fs.existsSync(this.filePath)) {
      return;
    }

    const now = new Date().toISOString();

    const demoProfiles = [
      {
        id: 'lead-maya',
        conversationId: 'demo-maya',
        customerName: 'Maya Chen',
        source: 'Marketplace',
        behaviorMode: 'chat',
        notes: '',
        stage: 'qualified',
        priority: 'warm',
        value: 120,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'lead-lucas',
        conversationId: 'demo-lucas',
        customerName: 'Lucas Martins',
        source: 'Direct',
        behaviorMode: 'banter',
        notes: '',
        stage: 'negotiating',
        priority: 'hot',
        value: 85,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'lead-sophie',
        conversationId: 'demo-sophie',
        customerName: 'Sophie de Vries',
        source: 'Marketplace',
        behaviorMode: 'roasting',
        notes: '',
        stage: 'won',
        priority: 'warm',
        value: 65,
        createdAt: now,
        updatedAt: now
      }
    ];

    this.writeAll(demoProfiles);
  }

  readAll() {
    this.ensureFile();

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((profile) => this.sanitizeLead(profile))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  getById(profileId) {
    if (
      typeof profileId !== 'string' ||
      !profileId.trim()
    ) {
      return null;
    }

    return (
      this.readAll().find(
        (profile) => profile.id === profileId.trim()
      ) || null
    );
  }

  getByConversationId(conversationId) {
    if (
      typeof conversationId !== 'string' ||
      !conversationId.trim()
    ) {
      return null;
    }

    return (
      this.readAll().find(
        (profile) =>
          profile.conversationId === conversationId.trim()
      ) || null
    );
  }

  createFromConversation(conversation) {
    if (
      !conversation ||
      typeof conversation !== 'object' ||
      typeof conversation.id !== 'string' ||
      !conversation.id.trim()
    ) {
      throw new Error('A valid conversation is required.');
    }

    const conversationId = conversation.id.trim();
    const profiles = this.readAll();

    const existing = profiles.find(
      (profile) =>
        profile.conversationId === conversationId
    );

    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();

    const profile = this.sanitizeLead({
      id: crypto.randomUUID(),
      conversationId,
      customerName: conversation.customerName,
      source: conversation.channel,
      behaviorMode: 'chat',
      notes: '',
      stage: 'new',
      priority: 'warm',
      value: 0,
      createdAt: now,
      updatedAt: now
    });

    if (!profile) {
      throw new Error(
        'Unable to create behavior profile.'
      );
    }

    profiles.unshift(profile);
    this.writeAll(profiles);

    return profile;
  }

  update(profileId, changes) {
    if (
      typeof profileId !== 'string' ||
      !profileId.trim() ||
      !changes ||
      typeof changes !== 'object'
    ) {
      throw new Error('Invalid profile update.');
    }

    const profiles = this.readAll();

    const index = profiles.findIndex(
      (profile) => profile.id === profileId.trim()
    );

    if (index === -1) {
      throw new Error('Behavior profile not found.');
    }

    const current = profiles[index];

    const next = this.sanitizeLead({
      ...current,
      ...changes,
      id: current.id,
      conversationId: current.conversationId,
      customerName: current.customerName,
      source: current.source,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString()
    });

    if (!next) {
      throw new Error('Invalid behavior profile data.');
    }

    profiles[index] = next;
    this.writeAll(profiles);

    return next;
  }

  writeAll(profiles) {
    const safeProfiles = Array.isArray(profiles)
      ? profiles
          .map((profile) => this.sanitizeLead(profile))
          .filter(Boolean)
      : [];

    fs.mkdirSync(
      path.dirname(this.filePath),
      { recursive: true }
    );

    fs.writeFileSync(
      this.filePath,
      JSON.stringify(safeProfiles, null, 2),
      'utf8'
    );

    return safeProfiles;
  }

  sanitizeLead(profile) {
    if (!profile || typeof profile !== 'object') {
      return null;
    }

    const id =
      typeof profile.id === 'string'
        ? profile.id.trim()
        : '';

    const customerName =
      typeof profile.customerName === 'string'
        ? profile.customerName.trim()
        : '';

    if (!id || !customerName) {
      return null;
    }

    const conversationId =
      typeof profile.conversationId === 'string'
        ? profile.conversationId.trim()
        : '';

    const source =
      typeof profile.source === 'string' &&
      profile.source.trim()
        ? profile.source.trim()
        : 'Unknown';

    const behaviorMode =
      VALID_BEHAVIOR_MODES.has(profile.behaviorMode)
        ? profile.behaviorMode
        : 'chat';

    const notes =
      typeof profile.notes === 'string'
        ? profile.notes.slice(0, 2000)
        : '';

    const stage =
      VALID_STAGES.has(profile.stage)
        ? profile.stage
        : 'new';

    const priority =
      VALID_PRIORITIES.has(profile.priority)
        ? profile.priority
        : 'warm';

    const rawValue =
      profile.value !== undefined
        ? Number(profile.value)
        : Number(profile.estimatedValue);

    const value =
      Number.isFinite(rawValue) && rawValue >= 0
        ? rawValue
        : 0;

    const createdAt =
      typeof profile.createdAt === 'string' &&
      profile.createdAt
        ? profile.createdAt
        : new Date().toISOString();

    const updatedAt =
      typeof profile.updatedAt === 'string' &&
      profile.updatedAt
        ? profile.updatedAt
        : createdAt;

    return {
      id,
      conversationId,
      customerName,
      source,
      behaviorMode,
      notes,
      stage,
      priority,
      value,
      createdAt,
      updatedAt
    };
  }
}

module.exports = {
  LeadStore
};