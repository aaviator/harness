/**
 * Backend-specific type definitions
 */

import type { Runtime } from "./runtime/types.ts";

// Application configuration shared across backend handlers
export interface AppConfig {
  debugMode: boolean;
  runtime: Runtime;
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
  defaultAllowedTools: string[];
}
