import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeVerifierTrace } from "../../framework/verifierTrace.js";

describe("verifier trace persistence", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "verifier-trace-"));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const lines = [{ category: "verifier", message: "fixture", level: 1 as const }];

  it.each(["../../escape", "..\\escape", "bad\u0000label"])(
    "rejects label %s without writing",
    async (label) => {
      await expect(writeVerifierTrace(dir, lines, label)).rejects.toThrow("label");
      expect(await fs.readdir(dir)).toEqual([]);
    },
  );

  it("writes a normal label as one filename component", async () => {
    const file = await writeVerifierTrace(dir, lines, "fixture-pass");
    expect(file).toBe(path.join(dir, "scores/verifier-trace_fixture-pass.jsonl"));
    expect(JSON.parse((await fs.readFile(file!, "utf8")).trim())).toEqual(lines[0]);
  });

  it("warns with the target path when trace persistence fails", async () => {
    await fs.writeFile(path.join(dir, "scores"), "not a directory");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await writeVerifierTrace(dir, lines)).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain(path.join(dir, "scores/verifier-trace.jsonl"));
  });

  it("redacts credentials from trace write errors", async () => {
    vi.spyOn(fs, "writeFile").mockRejectedValue(new Error("storage rejected sk-secret1234567890"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await writeVerifierTrace(dir, lines)).toBeUndefined();
    expect(String(warn.mock.calls[0][0])).toContain("storage rejected");
    expect(String(warn.mock.calls[0][0])).not.toContain("secret1234567890");
  });
});
