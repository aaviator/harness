// API URL helpers
export const api = {
  projects: () => "/api/projects",
  serverConfig: () => "/api/server-config",
  fsList: (path) => `/api/fs/list?path=${encodeURIComponent(path)}`,
  fsMkdir: () => "/api/fs/mkdir",
  fsRead: (path) => `/api/fs/read?path=${encodeURIComponent(path)}`,
  fsWrite: () => "/api/fs/write",
  fsRename: () => "/api/fs/rename",
  fsDelete: () => "/api/fs/delete",
  fsDownload: (path) => `/api/fs/download?path=${encodeURIComponent(path)}`,
  fsUpload: () => "/api/fs/upload",
  histories: (encoded) => `/api/projects/${encoded}/histories`,
  conversation: (encoded, sessionId) => `/api/projects/${encoded}/histories/${sessionId}`,
  chat: () => "/api/chat",
  toolResult: () => "/api/chat/tool-result",
  abort: (requestId) => `/api/abort/${requestId}`,
  authStatus: () => "/api/auth/status",
  authLogin: () => "/api/auth/login",
  authLogout: () => "/api/auth/logout",
  convs: () => "/api/convs",
  conv: (id) => `/api/convs/${id}`,
  convActive: (id) => `/api/convs/${id}/active`,
  convAbort: (id) => `/api/convs/${id}/abort`,
  title: () => "/api/title",
  compact: () => "/api/compact",
  tmux: () => "/api/tmux",
  tmuxSession: (name) => `/api/tmux/${name}`,
  tmuxCleanup: () => "/api/tmux/cleanup",
};

export async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

// Encode project path the same way the backend does
export function encodePath(path) {
  return path.replace(/\/$/, "").replace(/[/\\:._]/g, "-");
}
