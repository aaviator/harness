import { Context } from "hono";
import { killTmuxSession } from "../utils/tmux.ts";
import type { CreateConversationRequest, UpdateConversationRequest } from "../../shared/types.ts";
import {
  listConversations,
  getConversation,
  createConversation,
  updateConversation,
  deleteConversation,
} from "../utils/conversationStore.ts";

export function handleListConvs(c: Context) {
  return c.json(listConversations());
}

export function handleGetConv(c: Context) {
  const id = c.req.param("id");
  const conv = getConversation(id);
  if (!conv) return c.json({ error: "Not found" }, 404);
  return c.json(conv);
}

export async function handleCreateConv(c: Context) {
  const body: CreateConversationRequest = await c.req.json();
  if (!body.wd?.trim()) return c.json({ error: "wd is required" }, 400);
  return c.json(createConversation(body), 201);
}

export async function handleUpdateConv(c: Context) {
  const id = c.req.param("id");
  const body: UpdateConversationRequest = await c.req.json();
  const conv = updateConversation(id, body);
  if (!conv) return c.json({ error: "Not found" }, 404);
  return c.json(conv);
}

export function handleDeleteConv(c: Context) {
  const id = c.req.param("id");
  const conv = getConversation(id);
  if (!conv) return c.json({ error: "Not found" }, 404);
  killTmuxSession(conv.tmuxSession);
  return c.json({ ok: deleteConversation(id) });
}
