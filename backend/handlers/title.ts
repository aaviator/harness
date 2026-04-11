import { Context } from "hono";
import { query } from "@anthropic-ai/claude-code";

export async function handleGenerateTitle(c: Context): Promise<Response> {
  const { firstMessage } = await c.req.json<{ firstMessage: string }>();

  const { cliPath } = c.var.config;

  const prompt = `Write a short title (5 words max) for this user request:
"${firstMessage.slice(0, 500)}"

Reply with only the title. No punctuation at the end. No quotes.`;

  try {
    let resultText = "";
    for await (const msg of query({
      prompt,
      options: {
        maxTurns: 1,
        model: "claude-haiku-4-5-20251001",
        pathToClaudeCodeExecutable: cliPath,
        executable: "node" as const,
        executableArgs: [],
        permissionMode: "plan",
      },
    })) {
      if (msg.type === "assistant") {
        const content = (msg as any).message?.content ?? [];
        for (const item of content) {
          if (item.type === "text") resultText += item.text;
        }
      }
    }

    const title = resultText.trim().replace(/[."']+$/, "").slice(0, 60);
    return c.json({ title: title || "" });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
}
