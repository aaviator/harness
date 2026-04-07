import { Context } from "hono";
import { readdir, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { FsListResponse } from "../../shared/types.ts";

export async function handleFsList(c: Context) {
  const rawPath = c.req.query("path") || "/";

  // Resolve to absolute, no tricks
  const absPath = resolve(rawPath);

  try {
    const entries = await readdir(absPath, { withFileTypes: true });
    const result: FsListResponse = {
      entries: entries
        .filter((e) => e.isDirectory() || e.isFile())
        .map((e) => ({
          name: e.name,
          path: join(absPath, e.name),
          isDir: e.isDirectory(),
        }))
        .sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
    };
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to list directory";
    return c.json({ error: msg }, 400);
  }
}

export async function handleFsMkdir(c: Context) {
  const { path: rawPath } = await c.req.json<{ path: string }>();
  if (!rawPath?.trim()) return c.json({ error: "path is required" }, 400);
  const absPath = resolve(rawPath.trim());
  try {
    await mkdir(absPath, { recursive: true });
    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create directory";
    return c.json({ error: msg }, 400);
  }
}
