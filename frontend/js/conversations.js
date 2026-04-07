import { fetchJson } from './api.js';

const BASE = '/api/convs';

export const Conversations = {
  async list() { return fetchJson(BASE); },
  async get(id) { return fetchJson(`${BASE}/${id}`); },
  async create(data) {
    return fetchJson(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },
  async update(id, patch) {
    return fetchJson(`${BASE}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  },
  async del(id) {
    return fetchJson(`${BASE}/${id}`, { method: 'DELETE' });
  },
};

export const DEFAULT_SETTINGS = {
  sudo: false,
  permissionMode: 'default',
  enterBehavior: 'send',
  model: 'claude-sonnet-4-6',
  maxThinkingTokens: 0,
  customSystemPrompt: '',
  appendSystemPrompt: '',
  maxTurns: 0,
  markdownEnabled: true,
};
