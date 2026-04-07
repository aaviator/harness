import { Context } from "hono";
import { query, type PermissionMode } from "@anthropic-ai/claude-code";
import type { ChatRequest, StreamResponse, ToolResultRequest } from "../../shared/types.ts";
import { logger } from "../utils/logger.ts";
import { ensureTmuxSession } from "../utils/tmux.ts";

// Per-request pending tool result promises (for AskUserQuestion)
const pendingToolResults = new Map<string, (answer: string) => void>();

export function resolveToolResult(requestId: string, answer: string): boolean {
  const resolve = pendingToolResults.get(requestId);
  if (!resolve) return false;
  resolve(answer);
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
        ...(request.allowedTools ? { allowedTools: request.allowedTools } : {}),
        ...(request.workingDirectory ? { cwd: request.workingDirectory } : {}),
        ...(request.permissionMode ? { permissionMode: request.permissionMode as PermissionMode } : {}),
        ...(request.model ? { model: request.model } : {}),
        ...(request.maxThinkingTokens ? { maxThinkingTokens: request.maxThinkingTokens } : {}),
        ...(request.customSystemPrompt ? { customSystemPrompt: request.customSystemPrompt } : {}),
        ...(request.appendSystemPrompt || request.tmuxSession ? {
          appendSystemPrompt: [
            request.appendSystemPrompt || "",
            request.tmuxSession ? `\nYou have a persistent tmux session: ${request.tmuxSession}\nUse it for long-running processes that need to survive between messages.\nStart: tmux send-keys -t ${request.tmuxSession} 'command' Enter\nCheck output: tmux capture-pane -t ${request.tmuxSession} -p -S -50\nThis session is also visible to the user in the Terminal tab.` : "",
          ].join("").trim(),
        } : {}),
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
            const question: string = (item.input as any)?.question ?? "Please provide input:";
            const suggestions: string[] = (item.input as any)?.suggestions ?? [];

            yield { type: "ask_user", toolUseId, question, suggestions };

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
    logger.chat.error("Claude Code execution failed: {error}", { error });
    yield {
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    pendingToolResults.delete(request.requestId);
    if (requestAbortControllers.has(request.requestId)) {
      requestAbortControllers.delete(request.requestId);
    }
  }
}

export async function handleChatRequest(
  c: Context,
  requestAbortControllers: Map<string, AbortController>,
) {
  const chatRequest: ChatRequest = await c.req.json();
  const { cliPath, allowSudo } = c.var.config;

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
