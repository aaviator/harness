import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { Conversation, ConversationSettings, CreateConversationRequest, UpdateConversationRequest } from "../../shared/types.ts";

const STORE_DIR = join(homedir(), ".config", "claude-webui");
const STORE_FILE = join(STORE_DIR, "conversations.json");

let _cache: Conversation[] | null = null;

export const DEFAULT_SETTINGS: ConversationSettings = {
  sudo: false,
  permissionMode: "default",
  enterBehavior: "send",
  model: "claude-sonnet-4-6",
  maxThinkingTokens: 0,
  customSystemPrompt: "",
  appendSystemPrompt: "",
  maxTurns: 0,
};

function load(): Conversation[] {
  if (_cache !== null) return _cache;
  try {
    if (!existsSync(STORE_FILE)) return (_cache = []);
    return (_cache = JSON.parse(readFileSync(STORE_FILE, "utf8")) as Conversation[]);
  } catch {
    return (_cache = []);
  }
}

function save(conversations: Conversation[]): void {
  _cache = conversations;
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(STORE_FILE, JSON.stringify(conversations, null, 2), "utf8");
}

export function listConversations(): Conversation[] {
  return load().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getConversation(id: string): Conversation | null {
  return load().find((c) => c.id === id) ?? null;
}

export function createConversation(req: CreateConversationRequest): Conversation {
  const conversations = load();
  const id = randomUUID();
  const now = Date.now();
  const conv: Conversation = {
    id,
    title: req.title || "New Conversation",
    wd: req.wd,
    sessionIds: [],
    tmuxSession: "cw-" + id.slice(0, 8),
    settings: { ...DEFAULT_SETTINGS, ...(req.settings ?? {}) },
    createdAt: now,
    updatedAt: now,
    lastMessage: "",
  };
  conversations.push(conv);
  save(conversations);
  return conv;
}

export function updateConversation(id: string, patch: UpdateConversationRequest): Conversation | null {
  const conversations = load();
  const idx = conversations.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const conv = conversations[idx];
  if (patch.title !== undefined) conv.title = patch.title;
  if (patch.sessionIds !== undefined) conv.sessionIds = patch.sessionIds;
  if (patch.settings !== undefined) conv.settings = { ...conv.settings, ...patch.settings };
  if (patch.lastMessage !== undefined) conv.lastMessage = patch.lastMessage;
  if (patch.compactSummary !== undefined) conv.compactSummary = patch.compactSummary || undefined;
  conv.updatedAt = patch.updatedAt ?? Date.now();
  conversations[idx] = conv;
  save(conversations);
  return conv;
}

export function deleteConversation(id: string): boolean {
  const conversations = load();
  const idx = conversations.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  conversations.splice(idx, 1);
  save(conversations);
  return true;
}
