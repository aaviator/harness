import { Context } from "hono";
import { listTmuxSessions, killTmuxSession, runCleanup, type TmuxSessionInfo } from "../utils/tmux.ts";
import { listConversations } from "../utils/conversationStore.ts";

export function handleListTmux(c: Context) {
  const sessions = listTmuxSessions();
  const convs = listConversations();
  const convMap = new Map(convs.map((cv) => [cv.tmuxSession, cv]));

  const result: (TmuxSessionInfo & { convId?: string; convTitle?: string })[] = sessions.map((s) => {
    const conv = convMap.get(s.name);
    return {
      ...s,
      convId: conv?.id,
      convTitle: conv?.title,
    };
  });

  return c.json(result);
}

export async function handleKillTmux(c: Context) {
  const name = c.req.param("name");
  if (!name?.startsWith("cw-")) return c.json({ error: "Invalid session name" }, 400);
  const ok = killTmuxSession(name);
  return c.json({ ok });
}

export function handleCleanupTmux(c: Context) {
  const convs = listConversations();
  const validNames = new Set(convs.map((cv) => cv.tmuxSession));
  const maxIdleMs = 4 * 60 * 60 * 1000; // 4 hours default
  const result = runCleanup(validNames, maxIdleMs);
  return c.json(result);
}
