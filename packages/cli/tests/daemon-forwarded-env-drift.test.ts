import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { forwardedEnvKeys } from "../src/lib/driver/remote.js";

const driverDir = resolve(dirname(fileURLToPath(import.meta.url)), "../src/lib/driver");

const FORWARDED_ENV = new Set<string>(["BROWSERBASE_API_KEY"]);

const DAEMON_LOCAL_ENV = new Set<string>(["BROWSE_DAEMON_DIR", "BROWSE_SESSION"]);

const ENV_READ =
  /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*(["'])([A-Za-z_][A-Za-z0-9_]*)\2\s*\])/g;

async function collectTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return collectTsFiles(full);
      if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        return [full];
      }
      return [];
    }),
  );
  return nested.flat().sort();
}

async function collectEnvReads(): Promise<Map<string, string[]>> {
  const files = await collectTsFiles(driverDir);
  const byName = new Map<string, string[]>();
  for (const file of files) {
    const contents = await readFile(file, "utf8");
    for (const match of contents.matchAll(ENV_READ)) {
      const name = match[1] ?? match[3];
      if (!name) continue;
      const rel = file.slice(driverDir.length + 1);
      const existing = byName.get(name);
      if (existing) {
        if (!existing.includes(rel)) existing.push(rel);
      } else {
        byName.set(name, [rel]);
      }
    }
  }
  return byName;
}

describe("daemon forwarded-env drift guard", () => {
  it("keeps FORWARDED_ENV in sync with remote.ts forwardedEnvKeys()", () => {
    expect([...FORWARDED_ENV].sort()).toEqual([...forwardedEnvKeys()].sort());
  });

  it("declares the two sets as disjoint", () => {
    const overlap = [...FORWARDED_ENV].filter((name) => DAEMON_LOCAL_ENV.has(name));
    expect(overlap).toEqual([]);
  });

  it("categorizes every driver-path env read as forwarded or daemon-local", async () => {
    const reads = await collectEnvReads();
    expect(reads.size).toBeGreaterThan(0);

    const uncategorized = [...reads.entries()]
      .filter(([name]) => !FORWARDED_ENV.has(name) && !DAEMON_LOCAL_ENV.has(name))
      .map(([name, files]) => `${name} (read in: ${files.join(", ")})`);

    expect(
      uncategorized,
      uncategorized.length === 0
        ? undefined
        : [
            "New driver-path env read(s) are uncategorized:",
            ...uncategorized.map((entry) => `  - ${entry}`),
            "",
            "The daemon captures process.env once at spawn time, so a new env",
            "read must be a conscious decision:",
            "  • If it is per-client session identity that should be honored on a",
            "    running daemon, add it to forwardedEnvKeys() in",
            "    src/lib/driver/remote.ts (the FORWARDED_ENV set here stays in",
            "    sync via the assertion above).",
            "  • If it is daemon-local process config that must NOT be forwarded,",
            "    add it to DAEMON_LOCAL_ENV in this test.",
          ].join("\n"),
    ).toEqual([]);
  });
});
