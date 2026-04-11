import { createMiddleware } from "hono/factory";
import type { AppConfig } from "../types.ts";

export function createConfigMiddleware(options: AppConfig) {
  return createMiddleware<{
    Variables: { config: AppConfig };
  }>(async (c, next) => {
    c.set("config", options);
    await next();
  });
}

export type ConfigContext = {
  Variables: { config: AppConfig };
};
