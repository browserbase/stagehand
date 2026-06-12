import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "./helpers/run-cli.js";
import {
  getUpdateNotice,
  refreshUpdateCheckCache,
  takeUpdateNotice,
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
  it("shows the update notice on root help from a fresh cache without hitting the network", async () => {
    const cacheDir = await createTempDir("browse-update-cache-");
    const cachePath = join(cacheDir, "update-check.json");
    await writeUpdateCache(cachePath, {
      checkedAt: new Date().toISOString(),
      version: "99.0.0",
    });

    const result = await runCli(["--help"], {
      env: {
        BROWSE_CACHE_DIR: cacheDir,
        BROWSE_DISABLE_UPDATE_CHECK: "0",
        BROWSE_DAEMON_DIR: cacheDir,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(
      `Update available: ${cliVersion} -> 99.0.0.`,
    );
    expect(result.stderr).toContain("Run:\n  npm i -g browse@latest");
  });

  it("shows the update notice on regular commands, deduped within the notify interval", async () => {
    const cacheDir = await createTempDir("browse-update-once-");
    const cachePath = join(cacheDir, "update-check.json");
    await writeUpdateCache(cachePath, {
      checkedAt: new Date().toISOString(),
      version: "99.0.0",
    });
    const env = {
      BROWSE_CACHE_DIR: cacheDir,
      BROWSE_DISABLE_UPDATE_CHECK: "0",
      BROWSE_DAEMON_DIR: cacheDir,
    };

    const first = await runCli(["status"], { env });
    expect(first.exitCode).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({
      browserConnected: false,
      session: "default",
    });
    expect(first.stderr).toContain(
      `Update available: ${cliVersion} -> 99.0.0.`,
    );

    const second = await runCli(["status"], { env });
    expect(second.exitCode).toBe(0);
    expect(second.stderr).not.toContain("Update available:");
  });

  it("reminds again after the notify interval until the user upgrades", async () => {
    const cacheDir = await createTempDir("browse-update-renotify-");
    const cachePath = join(cacheDir, "update-check.json");
    const env = {
      ...process.env,
      BROWSE_DISABLE_UPDATE_CHECK: "0",
      BROWSE_UPDATE_CHECK_FILE: cachePath,
    };

    await writeUpdateCache(cachePath, {
      checkedAt: new Date().toISOString(),
      version: "99.0.0",
    });
    expect(await takeUpdateNotice("1.0.0", env)).toContain("99.0.0");
    expect(await takeUpdateNotice("1.0.0", env)).toBeNull();

    // 21h-old lastNotifiedAt (past the 20h interval) -> reminds again.
    await writeUpdateCache(cachePath, {
      checkedAt: new Date().toISOString(),
      lastNotifiedAt: new Date(Date.now() - 21 * 60 * 60 * 1000).toISOString(),
      version: "99.0.0",
    });
    expect(await takeUpdateNotice("1.0.0", env)).toContain("99.0.0");
    expect(await takeUpdateNotice("1.0.0", env)).toBeNull();

    // Upgraded -> silence even past the interval.
    await writeUpdateCache(cachePath, {
      checkedAt: new Date().toISOString(),
      lastNotifiedAt: new Date(Date.now() - 21 * 60 * 60 * 1000).toISOString(),
      version: "99.0.0",
    });
    expect(await takeUpdateNotice("99.0.0", env)).toBeNull();
  });

  it("never repeats the push notice when the cache is unwritable", async () => {
    const cacheDir = await createTempDir("browse-update-unwritable-");
    const cachePath = join(cacheDir, "update-check.json", "nested.json");

    const env = {
      ...process.env,
      BROWSE_DISABLE_UPDATE_CHECK: "0",
      BROWSE_UPDATE_CHECK_FILE: cachePath,
    };

    // A file standing in for the parent directory makes the path unwritable.
    await writeFile(join(cacheDir, "update-check.json"), "not a directory");
    expect(await takeUpdateNotice("1.0.0", env)).toBeNull();
  });

  it("does not repeat the push notice after help already showed it", async () => {
    const cacheDir = await createTempDir("browse-update-pullmark-");
    const cachePath = join(cacheDir, "update-check.json");
    const env = {
      ...process.env,
      BROWSE_DISABLE_UPDATE_CHECK: "0",
      BROWSE_UPDATE_CHECK_FILE: cachePath,
    };

    await writeUpdateCache(cachePath, {
      checkedAt: new Date().toISOString(),
      version: "99.0.0",
    });
    expect(await getUpdateNotice("1.0.0", env)).toContain("99.0.0");
    expect(await takeUpdateNotice("1.0.0", env)).toBeNull();
  });

  it("returns no notice for prerelease identifiers with ASCII ordering", async () => {
    const cacheDir = await createTempDir("browse-update-prerelease-");
    const cachePath = join(cacheDir, "update-check.json");
    await writeUpdateCache(cachePath, {
      checkedAt: new Date().toISOString(),
      version: "1.0.0-beta.B",
    });

    const notice = await getUpdateNotice("1.0.0-beta.b", {
      ...process.env,
      BROWSE_DISABLE_UPDATE_CHECK: "0",
      BROWSE_UPDATE_CHECK_FILE: cachePath,
    });

    expect(notice).toBeNull();
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

  it("does not notify from a stale cache even on root help", async () => {
    const cacheDir = await createTempDir("browse-update-stale-");
    const cachePath = join(cacheDir, "update-check.json");
    await writeUpdateCache(cachePath, {
      checkedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      version: "98.0.0",
    });

    const result = await runCli(["--help"], {
      env: {
        BROWSE_CACHE_DIR: cacheDir,
        BROWSE_DISABLE_UPDATE_CHECK: "0",
        BROWSE_DAEMON_DIR: cacheDir,
      },
    });

    expect(result.exitCode).toBe(0);
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
