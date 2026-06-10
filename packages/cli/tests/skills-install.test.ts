import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { shouldUseWindowsShell } from "../src/lib/skills/install.js";
import { runCli } from "./helpers/run-cli.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) await rm(path, { recursive: true, force: true });
  }
});

describe("skills install", () => {
  it("installs the bundled browse CLI skill", async () => {
    const stubDir = await createTempDir("browse-skills-install-bin-");
    const logPath = join(stubDir, "npx.log");
    await writeNpxStub(stubDir);

    const result = await runCli(["skills", "install"], {
      env: {
        BB_STUB_LOG: logPath,
        PATH: stubDir,
      },
    });

    expect(result.exitCode).toBe(0);
    const log = await readFile(logPath, "utf8");
    expect(log).toContain("--yes skills add ");
    expect(log).toContain("/skills/browse");
    expect(log).toContain("--yes --global --agent *");
  });

  it("uses a shell for Windows command shims", () => {
    expect(shouldUseWindowsShell("C:\\npm\\npx.cmd", "win32")).toBe(true);
    expect(shouldUseWindowsShell("C:\\npm\\npx.bat", "win32")).toBe(true);
    expect(shouldUseWindowsShell("/usr/local/bin/npx", "darwin")).toBe(false);
    expect(shouldUseWindowsShell("C:\\npm\\npx.exe", "win32")).toBe(false);
  });
});

async function createTempDir(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  cleanupPaths.push(path);
  return path;
}

async function writeNpxStub(stubDir: string): Promise<void> {
  const stubPath = join(stubDir, "npx");
  await writeFile(
    stubPath,
    ["#!/bin/sh", 'printf \'%s\\n\' "$*" >> "$BB_STUB_LOG"', "exit 0", ""].join(
      "\n",
    ),
  );
  await chmod(stubPath, 0o755);
}
