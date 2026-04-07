import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Runtime } from "./runtime/types.ts";
import { type ConfigContext, createConfigMiddleware } from "./middleware/config.ts";
import { createAuthMiddleware } from "./middleware/auth.ts";
import { handleProjectsRequest } from "./handlers/projects.ts";
import { handleHistoriesRequest } from "./handlers/histories.ts";
import { handleConversationRequest } from "./handlers/conversations.ts";
import { handleChatRequest, handleToolResult } from "./handlers/chat.ts";
import { handleAbortRequest } from "./handlers/abort.ts";
import { handleFsList, handleFsMkdir } from "./handlers/fs.ts";
import { handleServerConfig } from "./handlers/serverconfig.ts";
import { handleAuthStatus, handleLogin, handleLogout } from "./handlers/auth.ts";
import { handleListConvs, handleGetConv, handleCreateConv, handleUpdateConv, handleDeleteConv } from "./handlers/convStore.ts";
import { handleGenerateTitle } from "./handlers/title.ts";
import { handleListTmux, handleKillTmux, handleCleanupTmux } from "./handlers/tmux.ts";
import { logger } from "./utils/logger.ts";
import { readBinaryFile } from "./utils/fs.ts";
import type { AppConfig } from "./types.ts";

export interface CreateAppConfig {
  debugMode: boolean;
  staticPath: string;
  cliPath: string;
  defaultDir: string;
  allowSudo: boolean;
  terminalEnabled: boolean;
  tmuxAvailable: boolean;
  authEnabled: boolean;
  authPasswordHash: string | null;
  authUsername: string;
  authSecret: string;
  convPageSize: number;
  defaultModel: string;
  models: string[];
}

export function createApp(runtime: Runtime, config: CreateAppConfig): Hono<ConfigContext> {
  const app = new Hono<ConfigContext>();
  const requestAbortControllers = new Map<string, AbortController>();

  app.use("*", cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }));

  const appConfig: AppConfig = {
    debugMode: config.debugMode,
    runtime,
    cliPath: config.cliPath,
    defaultDir: config.defaultDir,
    allowSudo: config.allowSudo,
    terminalEnabled: config.terminalEnabled,
    tmuxAvailable: config.tmuxAvailable,
    authEnabled: config.authEnabled,
    authPasswordHash: config.authPasswordHash,
    authUsername: config.authUsername,
    authSecret: config.authSecret,
    convPageSize: config.convPageSize,
    defaultModel: config.defaultModel,
    models: config.models,
  };

  app.use("*", createConfigMiddleware(appConfig));
  app.use("*", createAuthMiddleware());

  // Auth endpoints
  app.get("/api/auth/status", (c) => handleAuthStatus(c));
  app.post("/api/auth/login", (c) => handleLogin(c));
  app.post("/api/auth/logout", (c) => handleLogout(c));

  // Server config + filesystem
  app.get("/api/server-config", (c) => handleServerConfig(c));
  app.get("/api/fs/list", (c) => handleFsList(c));
  app.post("/api/fs/mkdir", (c) => handleFsMkdir(c));

  // Project history
  app.get("/api/projects", (c) => handleProjectsRequest(c));
  app.get("/api/projects/:encodedProjectName/histories", (c) => handleHistoriesRequest(c));
  app.get("/api/projects/:encodedProjectName/histories/:sessionId", (c) => handleConversationRequest(c));

  // Conversations
  app.get("/api/convs", (c) => handleListConvs(c));
  app.post("/api/convs", (c) => handleCreateConv(c));
  app.get("/api/convs/:id", (c) => handleGetConv(c));
  app.put("/api/convs/:id", (c) => handleUpdateConv(c));
  app.delete("/api/convs/:id", (c) => handleDeleteConv(c));

  // Title generation
  app.post("/api/title", (c) => handleGenerateTitle(c));

  // Tmux management
  app.get("/api/tmux", (c) => handleListTmux(c));
  app.delete("/api/tmux/:name", (c) => handleKillTmux(c));
  app.post("/api/tmux/cleanup", (c) => handleCleanupTmux(c));

  // Chat
  app.post("/api/chat", (c) => handleChatRequest(c, requestAbortControllers));
  app.post("/api/chat/tool-result", (c) => handleToolResult(c));
  app.post("/api/abort/:requestId", (c) => handleAbortRequest(c, requestAbortControllers));

  // Block sensitive files
  app.get("/config.json", (c) => c.text("Not found", 404));
  app.get("/config.*", (c) => c.text("Not found", 404));

  // Static files
  const serveStatic = runtime.createStaticFileMiddleware({ root: config.staticPath });
  app.use("/vendor/*", serveStatic);
  app.use("/js/*", serveStatic);
  app.use("/css/*", serveStatic);

  // Named HTML pages
  app.get("/login.html", async (c) => {
    try {
      const file = await readBinaryFile(`${config.staticPath}/login.html`);
      return c.html(new TextDecoder().decode(file));
    } catch {
      return c.text("Not found", 404);
    }
  });

  app.get("/chat.html", async (c) => {
    try {
      const file = await readBinaryFile(`${config.staticPath}/chat.html`);
      return c.html(new TextDecoder().decode(file));
    } catch {
      return c.text("Not found", 404);
    }
  });

  // SPA fallback → index.html
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api/")) return c.text("Not found", 404);
    try {
      const file = await readBinaryFile(`${config.staticPath}/index.html`);
      return c.html(new TextDecoder().decode(file));
    } catch (error) {
      logger.app.error("Error serving index.html: {error}", { error });
      return c.text("Internal server error", 500);
    }
  });

  return app;
}
