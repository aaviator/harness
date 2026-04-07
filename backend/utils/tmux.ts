import { execSync } from "node:child_process";
import { logger } from "./logger.ts";

export interface TmuxSessionInfo {
  name: string;
  created: number; // unix timestamp
  lastActivity: number; // unix timestamp
  windows: number;
  attached: boolean;
  convId?: string;
  convTitle?: string;
}

/** Check if tmux is available */
export function tmuxAvailable(): boolean {
  try {
    execSync("which tmux", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** List all cw-* tmux sessions with metadata */
export function listTmuxSessions(): TmuxSessionInfo[] {
  try {
    const out = execSync(
      'tmux list-sessions -F "#{session_name}|||#{session_created}|||#{session_activity}|||#{session_windows}|||#{session_attached}"',
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    if (!out) return [];
    return out.split("\n").filter(Boolean).map((line) => {
      const [name, created, activity, windows, attached] = line.split("|||");
      return {
        name,
        created: parseInt(created, 10),
        lastActivity: parseInt(activity, 10),
        windows: parseInt(windows, 10),
        attached: attached === "1",
      };
    }).filter((s) => s.name.startsWith("cw-"));
  } catch {
    return [];
  }
}

/** Check if a specific tmux session exists */
export function tmuxSessionExists(name: string): boolean {
  try {
    execSync(`tmux has-session -t ${name}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Create a tmux session if it doesn't exist */
export function ensureTmuxSession(name: string, cwd: string): boolean {
  if (tmuxSessionExists(name)) return true;
  try {
    execSync(`tmux new-session -d -s ${name} -c ${JSON.stringify(cwd)}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Kill a tmux session */
export function killTmuxSession(name: string): boolean {
  try {
    execSync(`tmux kill-session -t ${name}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Kill orphaned cw-* sessions not linked to any conversation */
export function cleanupOrphanedSessions(validSessionNames: Set<string>): number {
  const sessions = listTmuxSessions();
  let killed = 0;
  for (const s of sessions) {
    if (!validSessionNames.has(s.name)) {
      killTmuxSession(s.name);
      killed++;
    }
  }
  return killed;
}

/** Kill cw-* sessions idle longer than maxIdleMs */
export function cleanupIdleSessions(maxIdleMs: number, protectedNames?: Set<string>): number {
  const sessions = listTmuxSessions();
  const now = Math.floor(Date.now() / 1000);
  const maxIdleSec = Math.floor(maxIdleMs / 1000);
  let killed = 0;
  for (const s of sessions) {
    if (protectedNames?.has(s.name)) continue;
    if (s.attached) continue; // don't kill attached sessions
    if (now - s.lastActivity > maxIdleSec) {
      killTmuxSession(s.name);
      killed++;
    }
  }
  return killed;
}

/** Run all cleanup: orphans + idle TTL */
export function runCleanup(validSessionNames: Set<string>, maxIdleMs: number): { orphans: number; idle: number } {
  const orphans = cleanupOrphanedSessions(validSessionNames);
  const idle = cleanupIdleSessions(maxIdleMs, validSessionNames);
  return { orphans, idle };
}
