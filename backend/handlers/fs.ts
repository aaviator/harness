import { Context } from "hono";
import { readdir, mkdir, stat, readFile, writeFile, rm, rename } from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import type { FsListResponse } from "../../shared/types.ts";

const READ_LIMIT = 1 * 1024 * 1024; // 1 MB

export async function handleFsList(c: Context) {
  const rawPath = c.req.query("path") || "/";

  // Resolve to absolute, no tricks
  const absPath = resolve(rawPath);

  try {
    const entries = await readdir(absPath, { withFileTypes: true });
    const mapped = await Promise.all(
      entries
        .filter((e) => e.isDirectory() || e.isFile())
        .map(async (e) => {
          const entryPath = join(absPath, e.name);
          let size: number | undefined;
          if (e.isFile()) {
            try { size = (await stat(entryPath)).size; } catch { /* ignore */ }
          }
          return { name: e.name, path: entryPath, isDir: e.isDirectory(), size };
        })
    );
    const result: FsListResponse = {
      entries: mapped.sort((a, b) => {
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

export async function handleFsRead(c: Context) {
  const rawPath = c.req.query("path") || "";
  if (!rawPath) return c.json({ error: "path is required" }, 400);
  const absPath = resolve(rawPath);
  try {
    const info = await stat(absPath);
    if (info.size > READ_LIMIT) {
      return c.json({ error: `File too large (${info.size} bytes, max 1 MB)` }, 400);
    }
    const content = await readFile(absPath, "utf-8");
    return c.json({ content, size: info.size });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to read file";
    return c.json({ error: msg }, 404);
  }
}

export async function handleFsWrite(c: Context) {
  const { path: rawPath, content } = await c.req.json<{ path: string; content: string }>();
  if (!rawPath?.trim()) return c.json({ error: "path is required" }, 400);
  const absPath = resolve(rawPath.trim());
  try {
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, content ?? "", "utf-8");
    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to write file";
    return c.json({ error: msg }, 400);
  }
}

export async function handleFsRename(c: Context) {
  const { oldPath, newName } = await c.req.json<{ oldPath: string; newName: string }>();
  if (!oldPath?.trim() || !newName?.trim()) return c.json({ error: "oldPath and newName are required" }, 400);
  if (newName.includes("/") || newName.includes("\\")) return c.json({ error: "Invalid name" }, 400);
  const absOld = resolve(oldPath.trim());
  const absNew = join(dirname(absOld), newName.trim());
  try {
    await rename(absOld, absNew);
    return c.json({ ok: true, path: absNew });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to rename";
    return c.json({ error: msg }, 400);
  }
}

export async function handleFsDelete(c: Context) {
  const { path: rawPath } = await c.req.json<{ path: string }>();
  if (!rawPath?.trim()) return c.json({ error: "path is required" }, 400);
  const absPath = resolve(rawPath.trim());
  try {
    await rm(absPath, { recursive: true, force: true });
    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete";
    return c.json({ error: msg }, 400);
  }
}

export async function handleFsDownload(c: Context) {
  const rawPath = c.req.query("path") || "";
  if (!rawPath) return c.json({ error: "path is required" }, 400);
  const absPath = resolve(rawPath);
  try {
    const buf = await readFile(absPath);
    const data = new Uint8Array(buf);
    const name = basename(absPath);
    return new Response(data, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Content-Length": String(buf.length),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "File not found";
    return c.json({ error: msg }, 404);
  }
}

export async function handleFsUpload(c: Context) {
  const body = await c.req.parseBody();
  const dir = body["dir"] as string;
  const file = body["file"] as File;
  if (!dir || !file) return c.json({ error: "dir and file are required" }, 400);
  const absDir = resolve(dir);
  const destPath = join(absDir, basename(file.name));
  try {
    await mkdir(absDir, { recursive: true });
    await writeFile(destPath, new Uint8Array(await file.arrayBuffer()));
    return c.json({ ok: true, path: destPath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upload failed";
    return c.json({ error: msg }, 400);
  }
}
