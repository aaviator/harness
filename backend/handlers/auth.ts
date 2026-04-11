import { Context } from "hono";
import bcrypt from "bcryptjs";
import { makeToken, validateToken } from "../middleware/auth.ts";
import type { LoginRequest, AuthStatusResponse } from "../../shared/types.ts";

function setSessionCookie(token: string): string {
  // 7-day session, httpOnly, SameSite=Lax (works with HTTPS proxies)
  const expires = new Date(Date.now() + 7 * 86400 * 1000).toUTCString();
  return `session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`;
}

export async function handleAuthStatus(c: Context) {
  const config = c.var.config;
  if (!config.authEnabled) {
    return c.json({ authenticated: true } as AuthStatusResponse);
  }
  const cookieHeader = c.req.header("cookie") || "";
  const sessionMatch = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
  const token = sessionMatch ? decodeURIComponent(sessionMatch[1]) : null;
  const authenticated = !!token && validateToken(token, config.authSecret);
  return c.json({ authenticated } as AuthStatusResponse);
}

export async function handleLogin(c: Context) {
  const config = c.var.config;
  if (!config.authEnabled || !config.authPasswordHash) {
    return c.json({ error: "Auth not configured" }, 400);
  }
  const body = await c.req.json<{ username?: string; password?: string }>();
  // Check username if configured
  if (config.authUsername && body.username !== config.authUsername) {
    return c.json({ error: "Invalid credentials" }, 401);
  }
  const valid = await bcrypt.compare(body.password ?? "", config.authPasswordHash);
  if (!valid) {
    return c.json({ error: "Invalid credentials" }, 401);
  }
  const token = makeToken(config.authSecret);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": setSessionCookie(token),
    },
  });
}

export function handleLogout(c: Context) {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": "session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
    },
  });
}
