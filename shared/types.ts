export interface StreamResponse {
  type: "claude_json" | "error" | "done" | "aborted" | "ask_user";
  data?: unknown;
  error?: string;
  toolUseId?: string;
  question?: string;
  suggestions?: string[];
}

export interface ChatRequest {
  message: string;
  sessionId?: string;
  requestId: string;
  allowedTools?: string[];
  workingDirectory?: string;
  permissionMode?: "default" | "plan" | "acceptEdits" | "bypassPermissions";
  useSudo?: boolean;
  model?: string;
  maxThinkingTokens?: number;
  customSystemPrompt?: string;
  appendSystemPrompt?: string;
  maxTurns?: number;
  tmuxSession?: string;
  convId?: string;
}

export interface ToolResultRequest {
  requestId: string;
  toolUseId: string;
  answer: string;
}

export interface AbortRequest {
  requestId: string;
}

// ── Conversations ─────────────────────────────────────────────────────────────

export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

export interface ConversationSettings {
  sudo: boolean;
  permissionMode: PermissionMode;
  enterBehavior: "send" | "newline";
  model: string;
  maxThinkingTokens: number;
  customSystemPrompt: string;
  appendSystemPrompt: string;
  maxTurns: number;
}

export interface Conversation {
  id: string;
  title: string;
  wd: string;
  sessionIds: string[];          // Claude session IDs in order; new one added on "clear context"
  tmuxSession: string;           // "cw-" + id.slice(0,8)
  settings: ConversationSettings;
  createdAt: number;
  updatedAt: number;
  lastMessage: string;
  compactSummary?: string;
}

export interface CreateConversationRequest {
  wd: string;
  settings?: Partial<ConversationSettings>;
  title?: string;
}

export interface UpdateConversationRequest {
  title?: string;
  sessionIds?: string[];
  settings?: Partial<ConversationSettings>;
  lastMessage?: string;
  updatedAt?: number;
  compactSummary?: string;
}

// ── Filesystem ────────────────────────────────────────────────────────────────

export interface ProjectInfo {
  path: string;
  encodedName: string;
}

export interface ProjectsResponse {
  projects: ProjectInfo[];
}

export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
}

export interface FsListResponse {
  entries: FsEntry[];
}

// ── Server config ─────────────────────────────────────────────────────────────

export interface ServerConfig {
  defaultDir: string;
  allowSudo: boolean;
  terminalEnabled: boolean;
  authEnabled: boolean;
  tmuxAvailable: boolean;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface LoginRequest {
  password: string;
}

export interface AuthStatusResponse {
  authenticated: boolean;
}

export interface CompactRequest {
  sessionId: string;
  workingDirectory?: string;
  customInstructions?: string;
  model?: string;
}

export interface CompactResponse {
  summary: string;
}

// ── Claude history (JSONL-based) ──────────────────────────────────────────────

export interface ConversationSummary {
  sessionId: string;
  startTime: string;
  lastTime: string;
  messageCount: number;
  lastMessagePreview: string;
}

export interface HistoryListResponse {
  conversations: ConversationSummary[];
}

export interface ConversationHistory {
  sessionId: string;
  messages: unknown[];
  metadata: {
    startTime: string;
    endTime: string;
    messageCount: number;
  };
}
