import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isFirstRun,
  markFirstRunComplete,
  readWelcomeMeta,
} from "../../tui/welcomeState.js";
import { readConfig, writeConfig } from "../../tui/commands/config.js";

const tempDirs: string[] = [];

function makeTempEntryDir(initial?: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evals-welcome-state-"));
  tempDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, "evals.config.json"),
    JSON.stringify(
      { defaults: {}, benchmarks: {}, ...(initial ?? {}) },
      null,
      2,
    ),
  );
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("welcomeState", () => {
  it("isFirstRun is true on a fresh config", () => {
    const dir = makeTempEntryDir();
    expect(isFirstRun(dir)).toBe(true);
    expect(readWelcomeMeta(dir)).toEqual({});
  });

  it("markFirstRunComplete writes _meta with ISO timestamp + version", () => {
    const dir = makeTempEntryDir();
    markFirstRunComplete(dir);
    const meta = readWelcomeMeta(dir);
    expect(meta.firstRunCompletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(meta.version).toBe(1);
    expect(isFirstRun(dir)).toBe(false);
  });

  it("markFirstRunComplete is idempotent — second call doesn't overwrite timestamp", () => {
    const dir = makeTempEntryDir();
    markFirstRunComplete(dir);
    const first = readWelcomeMeta(dir).firstRunCompletedAt;
    // small delay to ensure timestamps would differ if rewritten
    const now = Date.now();
    while (Date.now() - now < 5) {
      /* spin */
    }
    markFirstRunComplete(dir);
    expect(readWelcomeMeta(dir).firstRunCompletedAt).toBe(first);
  });

  it("marker round-trips without clobbering defaults / core / benchmarks", () => {
    const dir = makeTempEntryDir({
      defaults: { trials: 7, env: "browserbase" },
      core: { tool: "understudy_code" },
      benchmarks: { webvoyager: { limit: 12 } },
    });
    markFirstRunComplete(dir);
    const config = readConfig(dir);
    expect(config.defaults.trials).toBe(7);
    expect(config.defaults.env).toBe("browserbase");
    expect(config.core?.tool).toBe("understudy_code");
    expect(config.benchmarks).toMatchObject({ webvoyager: { limit: 12 } });
    expect(config._meta?.firstRunCompletedAt).toBeDefined();
  });

  it("writeConfig prune does not drop _meta when present", () => {
    const dir = makeTempEntryDir();
    const config = readConfig(dir);
    config._meta = { firstRunCompletedAt: "2026-05-10T00:00:00Z", version: 1 };
    writeConfig(dir, config);
    const reread = readConfig(dir);
    expect(reread._meta).toEqual({
      firstRunCompletedAt: "2026-05-10T00:00:00Z",
      version: 1,
    });
  });

  it("missing config — readWelcomeMeta returns {} instead of throwing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evals-welcome-state-"));
    tempDirs.push(dir);
    // No evals.config.json written
    expect(readWelcomeMeta(dir)).toEqual({});
    expect(isFirstRun(dir)).toBe(true);
  });
});
