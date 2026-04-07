const PREFIX = "cc-";

export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw !== null ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch {}
  },
  del(key) {
    try { localStorage.removeItem(PREFIX + key); } catch {}
  },
};

// Per-project session ID
export function getSessionId(dir) { return storage.get(`session:${dir}`, null); }
export function setSessionId(dir, id) { storage.set(`session:${dir}`, id); }
export function clearSessionId(dir) { storage.del(`session:${dir}`); }

// App settings
export function getSettings() {
  return storage.get("settings", { theme: "dark", enterBehavior: "send" });
}
export function saveSettings(s) { storage.set("settings", s); }
