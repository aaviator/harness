import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { logger } from "../utils/logger.ts";

// node-pty types (inline to avoid dependency if not installed)
interface IPty {
  pid: number;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: () => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}
interface IPtyModule {
  spawn: (shell: string, args: string[], opts: Record<string, unknown>) => IPty;
}

const _require = createRequire(import.meta.url);
let pty: IPtyModule | null = null;
try {
  pty = _require("node-pty") as IPtyModule;
} catch {
  logger.app.warn("node-pty not available — terminal feature disabled");
}

export function isPtyAvailable(): boolean {
  return pty !== null;
}

let _tmuxAvailable: boolean | null = null;
export function isTmuxAvailable(): boolean {
  if (_tmuxAvailable === null) {
    try { execSync("which tmux", { stdio: "ignore" }); _tmuxAvailable = true; }
    catch { _tmuxAvailable = false; }
  }
  return _tmuxAvailable;
}

// Minimal WebSocket frame encoder/decoder (RFC 6455)
function encodeWsText(data: string): Buffer {
  const payload = Buffer.from(data, "utf8");
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeWsFrames(buf: Buffer): { payload: Buffer; opcode: number }[] {
  const frames: { payload: Buffer; opcode: number }[] = [];
  let offset = 0;
  while (offset + 2 <= buf.length) {
    const b0 = buf[offset];
    const b1 = buf[offset + 1];
    const opcode = b0 & 0x0f;
    const masked = !!(b1 & 0x80);
    let payloadLen = b1 & 0x7f;
    let headerLen = 2;
    if (payloadLen === 126) {
      if (offset + 4 > buf.length) break;
      payloadLen = buf.readUInt16BE(offset + 2); headerLen = 4;
    } else if (payloadLen === 127) {
      if (offset + 10 > buf.length) break;
      payloadLen = Number(buf.readBigUInt64BE(offset + 2)); headerLen = 10;
    }
    const maskOffset = offset + headerLen;
    const dataOffset = masked ? maskOffset + 4 : maskOffset;
    if (dataOffset + payloadLen > buf.length) break;
    let payload = buf.slice(dataOffset, dataOffset + payloadLen);
    if (masked) {
      const mask = buf.slice(maskOffset, maskOffset + 4);
      const unmasked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) unmasked[i] = payload[i] ^ mask[i % 4];
      payload = unmasked;
    }
    frames.push({ payload, opcode });
    offset = dataOffset + payloadLen;
  }
  return frames;
}

export function handleTerminalUpgrade(req: IncomingMessage, socket: Duplex, _head: Buffer) {
  if (!pty) { socket.destroy(); return; }

  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const dir = url.searchParams.get("dir") || process.env.HOME || "/";
  const session = url.searchParams.get("session") || null;

  const key = req.headers["sec-websocket-key"] as string;
  if (!key) { socket.destroy(); return; }

  const accept = createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );

  let shell: string;
  let shellArgs: string[];
  if (session && isTmuxAvailable()) {
    let sessionExists = false;
    try { execSync(`tmux has-session -t ${session}`, { stdio: "ignore" }); sessionExists = true; } catch { /* does not exist */ }
    if (sessionExists) {
      shell = "tmux"; shellArgs = ["attach-session", "-t", session];
    } else {
      shell = "tmux"; shellArgs = ["new-session", "-s", session, "-c", dir];
    }
    logger.app.info(`Terminal tmux session=${session} exists=${sessionExists} in ${dir}`);
  } else {
    shell = "/bin/bash"; shellArgs = [];
    logger.app.info(`Terminal raw bash in ${dir}`);
  }

  const term = pty!.spawn(shell, shellArgs, {
    name: "xterm-256color", cols: 80, rows: 24, cwd: dir,
    env: { ...process.env, TERM: "xterm-256color" },
  });

  logger.app.info(`Terminal spawned (pid=${term.pid})`);

  term.onData((data: string) => {
    try { socket.write(encodeWsText(data)); } catch { /* closed */ }
  });
  term.onExit(() => {
    try { socket.end(); } catch { /* closed */ }
  });

  let buf = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    const frames = decodeWsFrames(buf);
    buf = Buffer.alloc(0); // reset; unframed bytes dropped (edge case, OK for PTY)
    for (const frame of frames) {
      if (frame.opcode === 0x8) { term.kill(); socket.end(); return; } // close
      if (frame.opcode === 0x9) { socket.write(Buffer.from([0x8a, 0x00])); continue; } // ping→pong
      const text = frame.payload.toString("utf8");
      try {
        const msg: Record<string, unknown> = JSON.parse(text);
        if (msg.type === "resize") term.resize(Math.max(1, msg.cols as number), Math.max(1, msg.rows as number));
        else if (msg.type === "input") term.write(msg.data as string);
      } catch { term.write(text); }
    }
  });
  socket.on("close", () => { try { term.kill(); } catch { /* dead */ } });
  socket.on("error", () => { try { term.kill(); } catch { /* dead */ } });
}
