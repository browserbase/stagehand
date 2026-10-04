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

export async function ocrScreenshots(
  images: CanonicalScreenshot[],
  cmd: string,
  logger: (line: LogLine) => void,
): Promise<Map<number, string>> {
  const dir = process.env.VERIFIER_OCR_CACHE_DIR ?? path.join(os.tmpdir(), "evaluator-ocr");
  await fs.mkdir(dir, { recursive: true });
  const out = new Map<number, string>();
  const pending: Array<{ index: number; key: string; file: string }> = [];
  for (const img of images) {
    const key = createHash("sha256").update(img.bytes).digest("hex").slice(0, 24);
    try {
      out.set(img.canonicalIndex, await fs.readFile(path.join(dir, `${key}.txt`), "utf8"));
      continue;
    } catch {
      /* not cached */
    }
    const file = path.join(dir, `${key}${img.mediaType.includes("jpeg") ? ".jpg" : ".png"}`);
    await fs.writeFile(file, img.bytes);
    pending.push({ index: img.canonicalIndex, key, file });
  }
  if (!pending.length) return out;
  const lanes = Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2)));
  const chunks: (typeof pending)[] = Array.from({ length: lanes }, () => []);
  pending.forEach((p, i) => chunks[i % lanes].push(p));
  await Promise.all(
    chunks
      .filter((c) => c.length)
      .map(async (chunk) => {
        try {
          const { stdout } = await run(
            cmd,
            chunk.map((c) => c.file),
            { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
          );
          const byFile = new Map(chunk.map((c) => [c.file, c]));
          for (const line of stdout.split("\n")) {
            if (!line.trim()) continue;
            try {
              const row = JSON.parse(line) as { path?: string; text?: string };
              const c = row.path ? byFile.get(row.path) : undefined;
              if (!c || typeof row.text !== "string") continue;
              out.set(c.index, row.text);
              await fs.writeFile(path.join(dir, `${c.key}.txt`), row.text);
            } catch {
              /* skip malformed line */
            }
          }
        } catch (error) {
          logger({
            category: "verifier",
            level: 1,
            message: `ocr failed for ${chunk.length} images: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }),
  );
  return out;
}
