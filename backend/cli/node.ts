#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { createApp } from "../app.ts";
import { NodeRuntime } from "../runtime/node.ts";
import { parseCliArgs } from "./args.ts";
import { validateClaudeCli } from "./validation.ts";
import { setupLogger, logger } from "../utils/logger.ts";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { exit } from "../utils/os.ts";
import { handleTerminalUpgrade, isPtyAvailable, isTmuxAvailable } from "../handlers/terminal.ts";
import { runCleanup } from "../utils/tmux.ts";
import { listConversations } from "../utils/conversationStore.ts";
import bcrypt from "bcryptjs";

function loadConfig(): Record<string, any> {
  const __dir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
  const configPath = join(__dir, "../../config.json");
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

async function main(runtime: NodeRuntime) {
  const config = loadConfig();

  // Apply env vars from config before anything else
  if (config.env && typeof config.env === "object") {
    for (const [key, val] of Object.entries(config.env)) {
      if (process.env[key] === undefined) process.env[key] = String(val);
    }
  }

  const args = parseCliArgs(config);
  await setupLogger(args.debug);

  if (args.debug) logger.cli.info("🐛 Debug mode enabled");

  const cliPath = await validateClaudeCli(runtime, args.claudePath);

  const __dirname = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
  const staticPath = join(__dirname, "../static");

  // Auth: prefer pre-hashed password from config.json, fall back to hashing CLI arg at startup
  let authPasswordHash: string | null = config.authPasswordHash ?? null;
  const authUsername: string = config.authUsername ?? "";
  if (!authPasswordHash && args.auth && args.authPassword) {
    authPasswordHash = await bcrypt.hash(args.authPassword, 10);
  }
  const authEnabled = (config.auth || args.auth) && !!authPasswordHash;
  if (authEnabled) logger.cli.info("🔒 Auth enabled" + (authUsername ? ` (user: ${authUsername})` : ""));

  const terminalEnabled = !args.noTerminal && isPtyAvailable();
  const tmuxAvailable = terminalEnabled && isTmuxAvailable();

  const app = createApp(runtime, {
    debugMode: args.debug,
    staticPath,
    cliPath,
    defaultDir: args.defaultDir,
    allowSudo: args.allowSudo,
    terminalEnabled,
    tmuxAvailable,
    authEnabled,
    authPasswordHash,
    authUsername,
    authSecret: args.authSecret,
    convPageSize: config.convPageSize ?? 10,
    defaultModel: config.defaultModel ?? "claude-sonnet-4-6",
    models: config.models ?? ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"],
  });

  // Cleanup orphaned/idle tmux sessions on boot
  if (tmuxAvailable) {
    const tmuxTtlMs = (config.tmuxIdleHours ?? 4) * 60 * 60 * 1000;
    const validNames = new Set(listConversations().map((c) => c.tmuxSession));
    const cleaned = runCleanup(validNames, tmuxTtlMs);
    if (cleaned.orphans || cleaned.idle) {
      logger.cli.info(`🧹 Tmux cleanup: ${cleaned.orphans} orphaned, ${cleaned.idle} idle sessions killed`);
    }
    // Periodic cleanup every hour
    setInterval(() => {
      const names = new Set(listConversations().map((c) => c.tmuxSession));
      const r = runCleanup(names, tmuxTtlMs);
      if (r.orphans || r.idle) {
        logger.cli.info(`🧹 Tmux periodic cleanup: ${r.orphans} orphaned, ${r.idle} idle`);
      }
    }, 60 * 60 * 1000);
  }

  logger.cli.info(`🚀 Server starting on ${args.host}:${args.port}`);

  const server = serve({
    fetch: app.fetch,
    port: args.port,
    hostname: args.host,
  });

  // WebSocket upgrade for terminal
  if (terminalEnabled) {
    (server as any).on("upgrade", (req: any, socket: any, head: any) => {
      if (req.url?.startsWith("/ws/terminal")) {
        handleTerminalUpgrade(req, socket, head);
      } else {
        socket.destroy();
      }
    });
  }

  console.log(`Listening on http://${args.host}:${args.port}/`);
}

const runtime = new NodeRuntime();
main(runtime).catch((error) => {
  console.error("Failed to start server:", error);
  exit(1);
});
