import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "./helpers/run-cli.js";
import {
  maybeAutoUpdateCli,
  refreshUpdateCheckCache,
} from "../src/lib/update.js";

const require = createRequire(import.meta.url);
const { version: cliVersion } = require("../package.json") as {
  version: string;
};
const cleanupPaths: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();

  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (!path) {
      continue;
    }
    await rm(path, { recursive: true, force: true });
  }
});

describe("CLI auto-update", () => {
  it("uses a fresh cache to print an update notice without hitting the network", async () => {
    const cacheDir = await createTempDir("browse-update-cache-");
    const cachePath = join(cacheDir, "update-check.json");
    await writeUpdateCache(cachePath, {
      checkedAt: new Date().toISOString(),
      version: "99.0.0",
    });

    const result = await runCli(["status"], {
      env: {
        BROWSE_CACHE_DIR: cacheDir,
        BROWSE_DISABLE_UPDATE_CHECK: "0",
        BROWSE_DAEMON_DIR: cacheDir,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      browserConnected: false,
      session: "default",
    });
    expect(result.stderr).toContain(
      `Update available: ${cliVersion} -> 99.0.0.`,
    );
    expect(result.stderr).toContain("Run:\n  npm i -g browse@latest");
  });

  it("compares prerelease identifiers with ASCII ordering", async () => {
    const cacheDir = await createTempDir("browse-update-prerelease-");
    const cachePath = join(cacheDir, "update-check.json");
    await writeUpdateCache(cachePath, {
      checkedAt: new Date().toISOString(),
      version: "1.0.0-beta.B",
    });

    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    try {
      await maybeAutoUpdateCli("1.0.0-beta.b", {
        ...process.env,
        BROWSE_DISABLE_UPDATE_CHECK: "0",
        BROWSE_UPDATE_CHECK_FILE: cachePath,
      });

      expect(stderrSpy).not.toHaveBeenCalled();
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("refreshes the update cache from the npm registry", async () => {
    const cacheDir = await createTempDir("browse-update-refresh-");
    const cachePath = join(cacheDir, "update-check.json");

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ version: "99.0.0" }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await refreshUpdateCheckCache({
      ...process.env,
      BROWSE_DISABLE_UPDATE_CHECK: "0",
      BROWSE_UPDATE_CHECK_FILE: cachePath,
    });

    const cache = JSON.parse(await readFile(cachePath, "utf8")) as {
      checkedAt: string;
      version: string;
    };
    expect(cache.version).toBe("99.0.0");
    expect(typeof cache.checkedAt).toBe("string");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://registry.npmjs.org/browse/latest");
    expect(init).toMatchObject({
      headers: { accept: "application/json" },
    });
  });

  it("treats stale cache entries as refreshes instead of notifying immediately", async () => {
    const cacheDir = await createTempDir("browse-update-stale-");
    const cachePath = join(cacheDir, "update-check.json");
    await writeUpdateCache(cachePath, {
      checkedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      version: "98.0.0",
    });

    const result = await runCli(["status"], {
      env: {
        BROWSE_CACHE_DIR: cacheDir,
        BROWSE_DISABLE_UPDATE_CHECK: "0",
        BROWSE_DAEMON_DIR: cacheDir,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      browserConnected: false,
      session: "default",
    });
    expect(result.stderr).not.toContain("Update available:");
  });
});

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  cleanupPaths.push(directory);
  return directory;
}

async function writeUpdateCache(
  pathname: string,
  cache: { checkedAt: string; version: string },
): Promise<void> {
  await writeFile(pathname, `${JSON.stringify(cache)}\n`, "utf8");
}
