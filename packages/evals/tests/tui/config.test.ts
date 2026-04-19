import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readConfig } from "../../tui/commands/config.js";

const tempDirs: string[] = [];

function makeTempEntryDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evals-config-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("readConfig", () => {
  it("throws on malformed evals.config.json instead of treating it as empty", () => {
    const entryDir = makeTempEntryDir();
    fs.writeFileSync(
      path.join(entryDir, "evals.config.json"),
      '{ "defaults": { "env": "local", } }',
    );

    expect(() => readConfig(entryDir)).toThrow(/Invalid JSON/);
  });

  it("throws on missing evals.config.json", () => {
    const entryDir = makeTempEntryDir();
    expect(() => readConfig(entryDir)).toThrow(/Missing config file/);
  });
});
