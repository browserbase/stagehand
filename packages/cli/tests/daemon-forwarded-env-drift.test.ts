import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { forwardedEnvKeys } from "../src/lib/driver/remote.js";

/**
 * Drift guard for daemon/driver-path env reads.
 *
 * The daemon is a detached background process: its `process.env` is frozen at
 * spawn time. Some env vars (the API key) must be *forwarded* from a later
 * client invocation so a key set after the daemon started is still honored;
 * others are daemon-local and intentionally NOT forwarded. This test scans the
 * whole driver path (`src/lib/driver/**`) for `process.env.NAME` reads and
 * requires every discovered NAME to be explicitly categorized as either
 * FORWARDED_ENV or DAEMON_LOCAL_ENV below. A new, uncategorized env read fails
 * this test — forcing the author to make a conscious "forward or not" decision
 * rather than silently adding a read the daemon can never see updated.
 */

const driverDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/lib/driver",
);

/**
 * Env vars the daemon forwards from the caller so a value set after the daemon
 * started is honored. Seeded with the API key; kept in sync with the runtime
 * source of truth (`forwardedEnvKeys()` in remote.ts) by an assertion below.
 */
const FORWARDED_ENV = new Set<string>(["BROWSERBASE_API_KEY"]);

/**
 * Env vars the driver path reads but intentionally does NOT forward: they are
 * daemon-local process configuration, not per-client session identity.
 */
const DAEMON_LOCAL_ENV = new Set<string>([
  "BROWSE_DAEMON_DIR",
  "BROWSE_SESSION",
]);

/** Matches `process.env.NAME`, `process.env["NAME"]`, and `process.env['NAME']`. */
const ENV_READ =
  /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*(["'])([A-Za-z_][A-Za-z0-9_]*)\2\s*\])/g;

async function collectTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return collectTsFiles(full);
      // Only source files; a stray test in this tree must not be scanned.
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
    const overlap = [...FORWARDED_ENV].filter((name) =>
      DAEMON_LOCAL_ENV.has(name),
    );
    expect(overlap).toEqual([]);
  });

  it("categorizes every driver-path env read as forwarded or daemon-local", async () => {
    const reads = await collectEnvReads();
    // Sanity: the scan must find the seeded reads, else the regex/path drifted.
    expect(reads.size).toBeGreaterThan(0);

    const uncategorized = [...reads.entries()]
      .filter(
        ([name]) => !FORWARDED_ENV.has(name) && !DAEMON_LOCAL_ENV.has(name),
      )
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
