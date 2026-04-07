import { Context } from "hono";
import type { ServerConfig } from "../../shared/types.ts";

export function handleServerConfig(c: Context) {
  const config = c.var.config;
  const result = {
    defaultDir: config.defaultDir,
    allowSudo: config.allowSudo,
    terminalEnabled: config.terminalEnabled,
    tmuxAvailable: config.tmuxAvailable,
    authEnabled: config.authEnabled,
    convPageSize: config.convPageSize,
    defaultModel: config.defaultModel,
    models: config.models,
  };
  return c.json(result);
}
