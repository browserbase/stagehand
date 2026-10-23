import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { ocrScreenshots } from "../src/ocr.js";
import type { CanonicalScreenshot } from "../src/types.js";

const shot = (canonicalIndex: number, bytes: string): CanonicalScreenshot =>
  ({
    canonicalIndex,
    originalStepIndex: canonicalIndex,
    bytes: Buffer.from(bytes),
    mediaType: "image/png",
  }) as CanonicalScreenshot;

async function fakeOcr(): Promise<{ cmd: string; log: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ocr-cmd-"));
  const script = path.join(dir, "ocr.mjs");
  const log = path.join(dir, "calls.log");
  await fs.writeFile(
    script,
    `import fs from "node:fs";
const [log, ...files] = process.argv.slice(2);
fs.appendFileSync(log, files.length + "\\n");
for (const p of files) console.log(JSON.stringify({ path: p, text: "text:" + fs.readFileSync(p, "utf8") }));
`,
  );
  return { cmd: `${process.execPath} ${script} ${log}`, log };
}

afterEach(() => {
  delete process.env.VERIFIER_OCR_CACHE_DIR;
});

test("runs a command with arguments, fans out identical screenshots, and removes input images", async () => {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), "ocr-cache-"));
  process.env.VERIFIER_OCR_CACHE_DIR = cache;
  const { cmd, log } = await fakeOcr();
  const images = [shot(0, "same"), shot(1, "other"), shot(2, "same")];
  const out = await ocrScreenshots(images, cmd, () => {});
  expect(out.get(0)).toBe("text:same");
  expect(out.get(1)).toBe("text:other");
  expect(out.get(2)).toBe("text:same");
  const files = await fs.readdir(cache);
  expect(files.every((f) => f.endsWith(".txt"))).toBe(true);
  expect(files).toHaveLength(2);
  // Second pass is served from the .txt cache without running the command.
  const before = await fs.readFile(log, "utf8");
  expect((await ocrScreenshots(images, cmd, () => {})).get(2)).toBe("text:same");
  expect(await fs.readFile(log, "utf8")).toBe(before);
});

test("an unusable cache directory disables OCR instead of throwing", async () => {
  const blocker = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "ocr-cache-")), "file");
  await fs.writeFile(blocker, "");
  process.env.VERIFIER_OCR_CACHE_DIR = path.join(blocker, "sub");
  const lines: string[] = [];
  const out = await ocrScreenshots([shot(0, "x")], "unused", (l) => lines.push(l.message));
  expect(out.size).toBe(0);
  expect(lines[0]).toContain("ocr failed for cache directory");
});

test("a failing command is logged with the timeout and leaves no images behind", async () => {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), "ocr-cache-"));
  process.env.VERIFIER_OCR_CACHE_DIR = cache;
  const lines: string[] = [];
  const out = await ocrScreenshots([shot(0, "x")], path.join(cache, "missing-binary"), (l) =>
    lines.push(l.message),
  );
  expect(out.size).toBe(0);
  expect(lines[0]).toContain("timeout 60000 ms");
  expect(await fs.readdir(cache)).toEqual([]);
});

test("cache entries are owner-only and keyed by command", async () => {
  const cache = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "ocr-cache-")), "sub");
  process.env.VERIFIER_OCR_CACHE_DIR = cache;
  const first = await fakeOcr();
  await ocrScreenshots([shot(0, "x")], first.cmd, () => {});
  if (process.platform !== "win32") {
    expect((await fs.stat(cache)).mode & 0o777).toBe(0o700);
    const [file] = await fs.readdir(cache);
    expect((await fs.stat(path.join(cache, file))).mode & 0o777).toBe(0o600);
  }
  // A different OCR command must not reuse the first command's cached text.
  const second = await fakeOcr();
  await ocrScreenshots([shot(0, "x")], second.cmd, () => {});
  expect(await fs.readFile(second.log, "utf8")).toBe("1\n");
  expect(await fs.readdir(cache)).toHaveLength(2);
});
