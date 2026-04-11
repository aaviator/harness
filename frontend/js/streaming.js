// Claude NDJSON streaming parser + message renderer
// Dispatches custom events; chat.html listens and updates Alpine state

import { api } from "./api.js";
import { parse as markedParse } from "/vendor/marked.esm.js";

function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function dispatch(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export class ClaudeStream {
  constructor() {
    this.requestId = null;
    this.sessionId = null;
    this.aborted = false;
  }

  async send({ message, workingDirectory, sessionId, allowedTools, permissionMode,
               useSudo, model, maxThinkingTokens, customSystemPrompt, appendSystemPrompt, maxTurns, tmuxSession, convId }) {
    this.aborted = false;
    this.requestId = crypto.randomUUID();
    this.sessionId = sessionId;

    dispatch("stream:start", { requestId: this.requestId });

    const body = {
      message,
      requestId: this.requestId,
      workingDirectory,
      ...(sessionId ? { sessionId } : {}),
      ...(allowedTools?.length ? { allowedTools } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      ...(useSudo ? { useSudo } : {}),
      ...(model ? { model } : {}),
      ...(maxThinkingTokens > 0 ? { maxThinkingTokens } : {}),
      ...(customSystemPrompt ? { customSystemPrompt } : {}),
      ...(appendSystemPrompt ? { appendSystemPrompt } : {}),
      ...(maxTurns > 0 ? { maxTurns } : {}),
      ...(tmuxSession ? { tmuxSession } : {}),
      ...(convId ? { convId } : {}),
    };

    try {
      const res = await fetch(api.chat(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        dispatch("stream:error", { message: `HTTP ${res.status}` });
        dispatch("stream:done", {});
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) this._processLine(line);
        }
      }
    } catch (err) {
      if (!this.aborted) dispatch("stream:error", { message: err.message });
    }

    dispatch("stream:done", {});
  }

  async abort() {
    this.aborted = true;
    if (this.requestId) {
      await fetch(api.abort(this.requestId), { method: "POST" }).catch(() => {});
    }
    dispatch("stream:aborted", {});
    dispatch("stream:done", {});
  }

  async sendToolResult(answer) {
    await fetch(api.toolResult(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: this.requestId, toolUseId: this._pendingToolUseId, answer }),
    });
    this._pendingToolUseId = null;
  }

  _processLine(line) {
    let envelope;
    try { envelope = JSON.parse(line); } catch { return; }

    switch (envelope.type) {
      case "claude_json": return this._handleSdkMessage(envelope.data);
      case "ask_user":
        this._pendingToolUseId = envelope.toolUseId;
        dispatch("stream:ask_user", {
          toolUseId: envelope.toolUseId,
          question: envelope.question,
          suggestions: envelope.suggestions ?? [],
          options: envelope.options ?? [],
          multiSelect: envelope.multiSelect ?? false,
        });
        return;
      case "error": return dispatch("stream:error", { message: envelope.error });
      case "aborted": return dispatch("stream:aborted", {});
      case "done": return;
    }
  }

  _handleSdkMessage(msg) {
    if (!msg?.type) return;

    switch (msg.type) {
      case "system":
        if (msg.subtype === "init") {
          this.sessionId = msg.session_id;
          dispatch("stream:session", { sessionId: msg.session_id, cwd: msg.cwd, model: msg.model, tools: msg.tools });
        }
        return;

      case "assistant": {
        const content = msg.message?.content ?? [];
        for (const item of content) {
          if (item.type === "thinking") {
            dispatch("stream:thinking", { text: item.thinking });
          } else if (item.type === "text") {
            dispatch("stream:text", { text: item.text });
          } else if (item.type === "tool_use") {
            dispatch("stream:tool_use", {
              id: item.id,
              name: item.name,
              input: item.input ?? {},
            });
            // Track AskUserQuestion tool IDs so we can suppress their "dismissed" tool_results
            if (item.name === "AskUserQuestion") {
              this._lastAskToolId = item.id;
            }
          }
        }
        return;
      }

      case "user": {
        const content = msg.message?.content ?? [];
        for (const item of content) {
          if (item.type === "tool_result") {
            const isAskDismiss = item.tool_use_id === this._lastAskToolId;
            if (isAskDismiss) this._lastAskToolId = null;
            dispatch("stream:tool_result", {
              toolUseId: item.tool_use_id,
              content: item.content,
              isError: item.is_error ?? false,
              isAskDismiss,
            });
          }
        }
        return;
      }

      case "result":
        dispatch("stream:result", {
          subtype: msg.subtype,
          cost: msg.total_cost_usd,
          turns: msg.num_turns,
          duration: msg.duration_ms,
          isError: msg.is_error,
          permissionDenials: msg.permission_denials ?? [],
        });
        return;
    }
  }
}

// Render a tool_use block to HTML
export function renderToolUse(name, input) {
  const inputStr = JSON.stringify(input, null, 2);
  return `<details class="tool-block my-1 rounded border border-slate-700 bg-slate-800/50 text-xs">
    <summary class="px-2 py-1 cursor-pointer text-slate-400 hover:text-slate-200 select-none">
      🔧 <span class="font-mono">${escHtml(name)}</span>
    </summary>
    <pre class="px-3 py-2 overflow-x-auto text-slate-300 font-mono text-xs">${escHtml(inputStr)}</pre>
  </details>`;
}

// Render a tool_result block to HTML
export function renderToolResult(content, isError) {
  const cls = isError ? "text-red-400 border-red-800" : "text-green-400 border-green-900";
  const text = typeof content === "string" ? content
    : Array.isArray(content) ? content.map(c => c.text ?? JSON.stringify(c)).join("\n")
    : JSON.stringify(content);
  return `<details class="tool-result-block my-1 rounded border ${cls} bg-slate-800/30 text-xs">
    <summary class="px-2 py-1 cursor-pointer select-none">${isError ? "❌" : "✅"} Result</summary>
    <pre class="px-3 py-2 overflow-x-auto font-mono text-xs whitespace-pre-wrap break-all">${escHtml(text)}</pre>
  </details>`;
}

// Global markdown toggle — set from chat.html toggleMd()
export let mdEnabled = true;
export function setMdEnabled(val) { mdEnabled = !!val; }

// Parse & render markdown text
export function renderText(text) {
  if (!mdEnabled) {
    return `<div class="whitespace-pre-wrap text-sm font-mono text-slate-200">${escHtml(text)}</div>`;
  }
  try {
    return `<div class="prose prose-invert prose-sm max-w-none">${markedParse(text)}</div>`;
  } catch {
    return `<div class="whitespace-pre-wrap text-sm">${escHtml(text)}</div>`;
  }
}

// Render thinking block
export function renderThinking(text) {
  return `<details class="thinking-block my-1 rounded border border-purple-800 bg-purple-900/20 text-xs">
    <summary class="px-2 py-1 cursor-pointer text-purple-400 select-none">💭 Thinking</summary>
    <pre class="px-3 py-2 overflow-x-auto text-purple-300 font-mono text-xs whitespace-pre-wrap">${escHtml(text)}</pre>
  </details>`;
}
