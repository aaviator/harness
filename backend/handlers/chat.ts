import { Context } from "hono";
import { query, type PermissionMode } from "@anthropic-ai/claude-code";
import type { ChatRequest, StreamResponse, ToolResultRequest } from "../../shared/types.ts";
import { logger } from "../utils/logger.ts";
import { ensureTmuxSession } from "../utils/tmux.ts";

// Per-request pending tool result promises (for AskUserQuestion)
const pendingToolResults = new Map<string, (answer: string) => void>();
// Note: the map stores resolve callbacks that accept the user's answer string

// Track active requests per conversation to prevent duplicates
const activeConvs = new Map<string, string>(); // convId → requestId

export function isConvActive(convId: string): boolean {
  return activeConvs.has(convId);
}

export function getActiveConvRequestId(convId: string): string | undefined {
  return activeConvs.get(convId);
}

export function abortConv(convId: string, requestAbortControllers: Map<string, AbortController>): boolean {
  const requestId = activeConvs.get(convId);
  if (!requestId) return false;
  const controller = requestAbortControllers.get(requestId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function resolveToolResult(requestId: string, answer: string): boolean {
  const resolver = pendingToolResults.get(requestId);
  if (!resolver) return false;
  resolver(answer);
  pendingToolResults.delete(requestId);
  return true;
}

async function* executeClaudeCommand(
  request: ChatRequest,
  requestAbortControllers: Map<string, AbortController>,
  cliPath: string,
  allowSudo: boolean,
): AsyncGenerator<StreamResponse> {
  const abortController = new AbortController();
  requestAbortControllers.set(request.requestId, abortController);
  if (request.convId) activeConvs.set(request.convId, request.requestId);

  let processedMessage = request.message;
  if (request.message.startsWith("/")) {
    processedMessage = request.message.substring(1);
  }

  // Lazily ensure tmux session exists (re-creates if expired/killed)
  if (request.tmuxSession && request.workingDirectory) {
    ensureTmuxSession(request.tmuxSession, request.workingDirectory);
  }

  // Sudo: use wrapper script as executable
  let resolvedCliPath = cliPath;
  if (request.useSudo && allowSudo) {
    resolvedCliPath = "/usr/local/bin/claude-wrapper";
  }

  try {
    for await (const sdkMessage of query({
      prompt: processedMessage,
      options: {
        abortController,
        executable: "node" as const,
        executableArgs: [],
        pathToClaudeCodeExecutable: resolvedCliPath,
        ...(request.sessionId ? { resume: request.sessionId } : {}),
        allowedTools: [...new Set([...(request.allowedTools ?? []), "AskUserQuestion"])],
        ...(request.workingDirectory ? { cwd: request.workingDirectory } : {}),
        ...(request.permissionMode ? { permissionMode: request.permissionMode as PermissionMode } : {}),
        ...(request.model ? { model: request.model } : {}),
        ...(request.maxThinkingTokens ? { maxThinkingTokens: request.maxThinkingTokens } : {}),
        ...(request.customSystemPrompt ? { customSystemPrompt: request.customSystemPrompt } : {}),
        appendSystemPrompt: [
          request.appendSystemPrompt || "",
          request.tmuxSession ? `\nYou have a persistent tmux session: ${request.tmuxSession}\nUse it for long-running processes that need to survive between messages.\nStart: tmux send-keys -t ${request.tmuxSession} 'command' Enter\nCheck output: tmux capture-pane -t ${request.tmuxSession} -p -S -50\nThis session is also visible to the user in the Terminal tab.` : "",
          request.permissionMode !== "bypassPermissions" ? `\nYou are being accessed via the Claude Code CLI through a personally-developed, low-use, non-commercial, private web interface for accessible and disability-friendly use of Claude Code, in accordance with Anthropic's Terms of Service.` : "",
          request.permissionMode !== "bypassPermissions" ? `\nWhen you need user input, ask as a normal text message and wait for the user's reply. Do not use AskUserQuestion. If AskUserQuestion is used and returns an empty result, the user's actual answer will arrive as the next message — do not comment on the empty result, just wait.` : "",
        ].join("").trim(),
        ...(request.maxTurns ? { maxTurns: request.maxTurns } : {}),
      },
    })) {
      logger.chat.debug("Claude SDK Message: {sdkMessage}", { sdkMessage });

      // Detect AskUserQuestion tool_use in assistant messages
      if (sdkMessage.type === "assistant") {
        const content = (sdkMessage as any).message?.content ?? [];
        for (const item of content) {
          if (item.type === "tool_use" && item.name === "AskUserQuestion") {
            const toolUseId: string = item.id;
            const rawInput = item.input as any;

            let question = rawInput?.question ?? "Please provide input:";
            let suggestions: string[] = rawInput?.suggestions ?? [];
            let options: Array<{ label: string; description?: string }> = [];
            let multiSelect = false;

            if (rawInput?.questions?.length) {
              const q = rawInput.questions[0];
              question = q.header ? `${q.header}: ${q.question}` : q.question;
              multiSelect = !!q.multiSelect;
              if (q.options?.length) {
                options = q.options;
                suggestions = q.options.map((o: any) => o.label);
              }
            }

            yield { type: "ask_user", toolUseId, question, suggestions, options, multiSelect } as any;

            // Wait for frontend to POST /api/chat/tool-result
            await new Promise<void>((resolve) => {
              pendingToolResults.set(request.requestId, () => resolve());
              setTimeout(() => {
                if (pendingToolResults.has(request.requestId)) {
                  pendingToolResults.delete(request.requestId);
                  resolve();
                }
              }, 600_000);
            });
          }
        }
      }

      yield { type: "claude_json", data: sdkMessage };
    }

    yield { type: "done" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("abort") || msg.includes("Abort")) {
      yield { type: "aborted" };
    } else {
      logger.chat.error("Claude Code execution failed: {error}", { error });
      yield { type: "error", error: msg };
    }
  } finally {
    pendingToolResults.delete(request.requestId);
    if (requestAbortControllers.has(request.requestId)) {
      requestAbortControllers.delete(request.requestId);
    }
    if (request.convId) activeConvs.delete(request.convId);
  }
}

export async function handleChatRequest(
  c: Context,
  requestAbortControllers: Map<string, AbortController>,
) {
  const chatRequest: ChatRequest = await c.req.json();
  const { cliPath, allowSudo } = c.var.config;

  // Reject duplicate requests for the same conversation
  if (chatRequest.convId && isConvActive(chatRequest.convId)) {
    return c.json({ error: "A request is already in progress for this conversation" }, 409);
  }

  logger.chat.debug("Received chat request {*}", chatRequest as unknown as Record<string, unknown>);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of executeClaudeCommand(
          chatRequest,
          requestAbortControllers,
          cliPath,
          allowSudo,
        )) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify(chunk) + "\n"));
        }
        controller.close();
      } catch (error) {
        const errorResponse: StreamResponse = {
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        };
        controller.enqueue(new TextEncoder().encode(JSON.stringify(errorResponse) + "\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function handleToolResult(c: Context) {
  const body: ToolResultRequest = await c.req.json();
  const resolved = resolveToolResult(body.requestId, body.answer);
  if (!resolved) {
    return c.json({ error: "No pending request found" }, 404);
  }
  return c.json({ ok: true });
}
