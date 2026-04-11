import { Context } from "hono";
import { query, type PermissionMode } from "@anthropic-ai/claude-code";
import type { CompactRequest, CompactResponse } from "../../shared/types.ts";
import { loadConversation } from "../history/conversationLoader.ts";
import { getEncodedProjectName } from "../history/pathUtils.ts";

export async function handleCompactRequest(c: Context): Promise<Response> {
  const { sessionId, workingDirectory, customInstructions, model } =
    (await c.req.json()) as CompactRequest;
  const { cliPath } = c.var.config;

  if (!sessionId) {
    return c.json({ error: "sessionId is required" }, 400);
  }

  const encodedPath = workingDirectory
    ? await getEncodedProjectName(workingDirectory)
    : null;

  if (!encodedPath) {
    return c.json({ error: "Could not resolve project path" }, 400);
  }

  const history = await loadConversation(encodedPath, sessionId);

  if (!history || !history.messages.length) {
    return c.json({ summary: "(No conversation history found.)" } satisfies CompactResponse);
  }

  const userMessages: string[] = [];
  const formattedLines: string[] = [];

  for (const msg of history.messages as any[]) {
    if (msg.type === "user") {
      const parts = Array.isArray(msg.message?.content)
        ? msg.message.content
        : [{ type: "text", text: String(msg.message?.content ?? "") }];
      const text = parts
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("\n")
        .trim();
      if (text) {
        userMessages.push(text);
        formattedLines.push(`USER: ${text}`);
      }
    } else if (msg.type === "assistant") {
      const text = (msg.message?.content ?? [])
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("\n")
        .trim();
      if (text) {
        formattedLines.push(`ASSISTANT: ${text.slice(0, 800)}${text.length > 800 ? "…" : ""}`);
      }
    }
  }

  const prompt = [
    "Create a concise but complete conversation summary. Include: decisions made, code written/modified, key findings, current task state, errors/blockers encountered.",
    customInstructions ? `Additional instructions: ${customInstructions}` : "",
    `\n<conversation>\n${formattedLines.join("\n\n")}\n</conversation>`,
  ]
    .filter(Boolean)
    .join("\n");

  let generatedSummary = "";

  for await (const sdkMsg of query({
    prompt,
    options: {
      executable: "node" as const,
      executableArgs: [],
      pathToClaudeCodeExecutable: cliPath,
      ...(model ? { model } : {}),
      maxTurns: 1,
    },
  })) {
    if (sdkMsg.type === "assistant") {
      for (const item of (sdkMsg as any).message?.content ?? []) {
        if (item.type === "text") generatedSummary += item.text;
      }
    }
  }

  const verbatimSection =
    userMessages.length > 0
      ? "\n\n---\n**User messages (verbatim):**\n" +
        userMessages.map((m, i) => `${i + 1}. ${m}`).join("\n")
      : "";

  const summary = (generatedSummary.trim() || "(Could not generate summary.)") + verbatimSection;

  return c.json({ summary } satisfies CompactResponse);
}
