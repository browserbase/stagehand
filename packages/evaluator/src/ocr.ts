/**
 * Optional local OCR of screenshots (VERIFIER_OCR_CMD): turns screenshot pixels into observation-tier
 * text so retrieval, answer anchors and the signals selector can find claimed values that appear only
 * on screen. Zero LLM calls. The command takes image paths and prints one JSON line per image:
 * {"path": "...", "text": "..."} (scripts/ocr-macos.swift is a Vision-framework implementation).
 * Results are cached by image hash, so re-grading the same run is free.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { LogLine } from "./client.js";
import type { CanonicalScreenshot } from "./types.js";

const run = promisify(execFile);
const OCR_TIMEOUT_MS = 60_000;

/**
 * `cmd` is an executable followed by optional whitespace-separated arguments (no shell quoting),
 * e.g. `swift scripts/ocr-macos.swift`. OCR is optional: any cache or subprocess failure is logged
 * and the affected screenshots are graded without OCR text.
 */
export async function ocrScreenshots(
  images: CanonicalScreenshot[],
  cmd: string,
  logger: (line: LogLine) => void,
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const fail = (what: string, error: unknown) =>
    logger({
      category: "verifier",
      level: 1,
      message: `ocr failed for ${what}: ${error instanceof Error ? error.message : String(error)}`,
    });
  const dir = process.env.VERIFIER_OCR_CACHE_DIR ?? path.join(os.tmpdir(), "evaluator-ocr");
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    fail("cache directory", error);
    return out;
  }
  // Byte-identical screenshots share one OCR job and fan the text out to every canonical index.
  const pending = new Map<string, { indices: number[]; key: string; file: string }>();
  for (const img of images) {
    const key = createHash("sha256").update(img.bytes).digest("hex").slice(0, 24);
    const queued = pending.get(key);
    if (queued) {
      queued.indices.push(img.canonicalIndex);
      continue;
    }
    try {
      out.set(img.canonicalIndex, await fs.readFile(path.join(dir, `${key}.txt`), "utf8"));
      continue;
    } catch {
      /* not cached */
    }
    const file = path.join(dir, `${key}${img.mediaType.includes("jpeg") ? ".jpg" : ".png"}`);
    try {
      await fs.writeFile(file, img.bytes);
    } catch (error) {
      fail("image write", error);
      continue;
    }
    pending.set(key, { indices: [img.canonicalIndex], key, file });
  }
  if (!pending.size) return out;
  const [bin, ...baseArgs] = cmd.trim().split(/\s+/);
  const lanes = Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2)));
  const chunks: Array<Array<{ indices: number[]; key: string; file: string }>> = Array.from(
    { length: lanes },
    () => [],
  );
  [...pending.values()].forEach((p, i) => chunks[i % lanes].push(p));
  await Promise.all(
    chunks
      .filter((c) => c.length)
      .map(async (chunk) => {
        try {
          const { stdout } = await run(bin, [...baseArgs, ...chunk.map((c) => c.file)], {
            timeout: OCR_TIMEOUT_MS,
            maxBuffer: 64 * 1024 * 1024,
          });
          const byFile = new Map(chunk.map((c) => [c.file, c]));
          for (const line of stdout.split("\n")) {
            if (!line.trim()) continue;
            try {
              const row = JSON.parse(line) as { path?: string; text?: string };
              const c = row.path ? byFile.get(row.path) : undefined;
              if (!c || typeof row.text !== "string") continue;
              for (const index of c.indices) out.set(index, row.text);
              await fs.writeFile(path.join(dir, `${c.key}.txt`), row.text);
            } catch {
              /* skip malformed line or unwritable cache entry */
            }
          }
        } catch (error) {
          fail(`${chunk.length} images (timeout ${OCR_TIMEOUT_MS} ms)`, error);
        } finally {
          // Only the .txt result is cached; screenshots may hold sensitive page content.
          await Promise.all(chunk.map((c) => fs.rm(c.file, { force: true })));
        }
      }),
  );
  return out;
}
