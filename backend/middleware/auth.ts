import { createMiddleware } from "hono/factory";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../types.ts";

function makeToken(secret: string): string {
  const payload = `authenticated:${Math.floor(Date.now() / 86400000)}`; // changes daily
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function validateToken(token: string, secret: string): boolean {
  try {
    const expected = makeToken(secret);
    const a = Buffer.from(token, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export { makeToken };

export function createAuthMiddleware() {
  return createMiddleware<{
    Variables: { config: AppConfig };
  }>(async (c, next) => {
    const config = c.var.config;

    // Skip if auth disabled
    if (!config.authEnabled) {
      await next();
      return;
    }

    // Skip auth endpoints, login page, and static assets
    if (c.req.path.startsWith("/api/auth/") || c.req.path === "/login.html" ||
        c.req.path.startsWith("/css/") || c.req.path.startsWith("/vendor/") || c.req.path.startsWith("/js/")) {
      await next();
      return;
    }

    // Check cookie
    const cookieHeader = c.req.header("cookie") || "";
    const sessionMatch = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
    const token = sessionMatch ? decodeURIComponent(sessionMatch[1]) : null;

    if (token && validateToken(token, config.authSecret)) {
      await next();
      return;
    }

    // API routes → 401 JSON; everything else → 302 to /login.html
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return c.redirect("/login.html");
  });
}
