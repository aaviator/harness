import { storage } from "./storage.js";

const KEY = (dir) => `config:${dir}`;

export const MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
];

export const PERMISSION_MODES = [
  { value: "default", label: "Default" },
  { value: "acceptEdits", label: "Accept Edits" },
  { value: "plan", label: "Plan" },
  { value: "bypassPermissions", label: "⚠ Bypass Permissions" },
];

export function getProjectConfig(dir) {
  return storage.get(KEY(dir), {
    model: "",
    maxThinkingTokens: 0,
    customSystemPrompt: "",
    appendSystemPrompt: "",
    maxTurns: 0,
    permissionMode: "default",
  });
}

export function saveProjectConfig(dir, cfg) {
  storage.set(KEY(dir), cfg);
}
