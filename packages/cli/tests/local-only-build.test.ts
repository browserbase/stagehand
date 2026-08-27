import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const full = join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : Promise.resolve([full]);
    }),
  );
  return files.flat();
}

async function exists(path: string): Promise<boolean> {
  try {
    // access() (unlike readFile) correctly reports directories as existing,
    // which matters for the excluded-module directory assertions below.
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// Compiles the `build:local-only` TypeScript program into a throwaway outDir and
// asserts the artifact contains no Browserbase API-key code. This is the
// security contract of the local-only (CDP-only) build: if a future change
// reintroduces a key code path into a non-excluded module, this test fails.
describe("local-only build", () => {
  let outDir: string;
  let jsFiles: string[];

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "browse-local-only-"));
    await execFileAsync(
      process.execPath,
      [
        resolve(repoRoot, "node_modules/typescript/bin/tsc"),
        "-p",
        "tsconfig.local-only.json",
        "--outDir",
        outDir,
      ],
      { cwd: repoRoot },
    );
    jsFiles = (await walk(outDir)).filter((f) => f.endsWith(".js"));
  }, 120_000);

  afterAll(async () => {
    if (outDir) await rm(outDir, { recursive: true, force: true });
  });

  it("emits a non-trivial artifact", () => {
    expect(jsFiles.length).toBeGreaterThan(10);
  });

  it("contains no BROWSERBASE_API_KEY reference anywhere in the artifact", async () => {
    const offenders: string[] = [];
    for (const file of jsFiles) {
      const contents = await readFile(file, "utf8");
      if (contents.includes("BROWSERBASE_API_KEY")) {
        offenders.push(file.slice(outDir.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("excludes the cloud / functions / skills / templates modules and the remote driver", async () => {
    const excluded = [
      "commands/cloud",
      "commands/functions",
      "commands/skills",
      "commands/templates",
      "lib/cloud",
      "lib/functions",
      "lib/skills",
      "lib/templates",
      "lib/driver/remote.js",
    ];
    for (const rel of excluded) {
      expect(await exists(join(outDir, rel))).toBe(false);
    }
  });

  it("keeps the local CDP driver and substitutes the disabled remote stub", async () => {
    expect(await exists(join(outDir, "commands/open.js"))).toBe(true);
    expect(await exists(join(outDir, "lib/driver/session-manager.js"))).toBe(
      true,
    );
    expect(await exists(join(outDir, "lib/driver/remote.disabled.js"))).toBe(
      true,
    );
  });
});
