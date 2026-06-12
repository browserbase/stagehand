import { access } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { maybeNudgeOpen, OPEN_NUDGE_HINT } from "../src/lib/open-nudge.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (!path) continue;
    await rm(path, { recursive: true, force: true });
  }
});

async function freshCacheFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "browse-open-nudge-"));
  cleanupPaths.push(dir);
  return join(dir, "open-nudge.json");
}

const enabledEnv: NodeJS.ProcessEnv = { NODE_ENV: "development", CI: "" };

describe("maybeNudgeOpen", () => {
  it("returns the hint once, then honors the install marker", async () => {
    const cacheFile = await freshCacheFile();
    expect(await maybeNudgeOpen({ cacheFile }, enabledEnv)).toBe(
      OPEN_NUDGE_HINT,
    );
    await expect(access(cacheFile)).resolves.toBeUndefined();
    expect(await maybeNudgeOpen({ cacheFile }, enabledEnv)).toBeNull();
  });

  it("respects BROWSE_DISABLE_OPEN_NUDGE and BB_DISABLE_OPEN_NUDGE", async () => {
    const cacheFile = await freshCacheFile();
    expect(
      await maybeNudgeOpen(
        { cacheFile },
        { ...enabledEnv, BROWSE_DISABLE_OPEN_NUDGE: "1" },
      ),
    ).toBeNull();
    expect(
      await maybeNudgeOpen(
        { cacheFile },
        { ...enabledEnv, BB_DISABLE_OPEN_NUDGE: "1" },
      ),
    ).toBeNull();
  });

  it("does not nudge in CI or test environments", async () => {
    const cacheFile = await freshCacheFile();
    expect(
      await maybeNudgeOpen(
        { cacheFile },
        { NODE_ENV: "development", CI: "true" },
      ),
    ).toBeNull();
    expect(
      await maybeNudgeOpen({ cacheFile }, { NODE_ENV: "test", CI: "" }),
    ).toBeNull();
  });

  it("returns null when no cache file is configured", async () => {
    expect(await maybeNudgeOpen({}, enabledEnv)).toBeNull();
  });
});
