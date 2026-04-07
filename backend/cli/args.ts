import { program } from "commander";
import { VERSION } from "./version.ts";
import { getEnv, getArgs } from "../utils/os.ts";
import { randomUUID } from "node:crypto";

export interface ParsedArgs {
  debug: boolean;
  port: number;
  host: string;
  claudePath?: string;
  defaultDir: string;
  auth: boolean;
  authPassword?: string;
  authSecret: string;
  allowSudo: boolean;
  noTerminal: boolean;
}

export function parseCliArgs(config: Record<string, any> = {}): ParsedArgs {
  const version = VERSION;
  const defaultPort = config.port ?? parseInt(getEnv("PORT") || "8080", 10);

  program
    .name("harness")
    .version(version, "-v, --version", "display version number")
    .description("aaviator/harness — Claude Code web interface")
    .option("-p, --port <port>", "Port to listen on", (value) => {
      const parsed = parseInt(value, 10);
      if (isNaN(parsed)) throw new Error(`Invalid port number: ${value}`);
      return parsed;
    }, defaultPort)
    .option("--host <host>", "Host address to bind to (use 0.0.0.0 for all interfaces)", config.host ?? "127.0.0.1")
    .option("--claude-path <path>", "Path to claude executable (overrides automatic detection)")
    .option("--default-dir <path>", "Default directory for folder picker", config.defaultDir ?? "/")
    .option("--auth", "Enable authentication", config.auth ?? false)
    .option("--auth-password <password>", "Password for authentication (plaintext, hashed at startup)", config.authPassword)
    .option("--auth-secret <secret>", "HMAC secret for session tokens (auto-generated if not set)", config.authSecret)
    .option("--allow-sudo", "Enable sudo toggle (requires sudoers rule for claude-wrapper)", config.allowSudo ?? false)
    .option("--no-terminal", "Disable integrated terminal feature")
    .option("-d, --debug", "Enable debug mode", config.debug ?? false);

  program.parse(getArgs(), { from: "user" });
  const options = program.opts();

  const debugEnv = getEnv("DEBUG");
  const debugFromEnv = debugEnv?.toLowerCase() === "true" || debugEnv === "1";

  return {
    debug: options.debug || debugFromEnv,
    port: options.port,
    host: options.host,
    claudePath: options.claudePath,
    defaultDir: options.defaultDir,
    auth: options.auth,
    authPassword: options.authPassword,
    authSecret: options.authSecret || randomUUID(),
    allowSudo: options.allowSudo,
    noTerminal: options.terminal === false,
  };
}
