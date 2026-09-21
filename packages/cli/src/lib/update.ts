import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import semver from "semver";

const CLI_PACKAGE_NAME = "browse";
const DEFAULT_NPM_REGISTRY_BASE_URL = "https://registry.npmjs.org/";
const UPDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const UPDATE_TIMEOUT_MS = 1500;

interface UpdateCheckCache {
  checkedAt: string;
  version: string;
}

interface UpdateCheckOptions {
  cacheFile?: string;
}

export async function maybeAutoUpdateCli(
  currentVersion: string,
  env: NodeJS.ProcessEnv = process.env,
  options: UpdateCheckOptions = {},
): Promise<void> {
  if (
    env.BROWSE_DISABLE_UPDATE_CHECK === "1" ||
    env.BB_DISABLE_UPDATE_CHECK === "1"
  ) {
    return;
  }

  const cachePath = resolveUpdateCheckPath(env, options);
  if (!cachePath) {
    return;
  }

  const cache = await readFreshUpdateCheckCache(cachePath);
  if (cache) {
    if (isVersionNewer(currentVersion, cache.version)) {
      writeUpdateNotice(currentVersion, cache.version);
    }
    return;
  }

  spawnBackgroundUpdateCheck(env, cachePath);
}

export async function refreshUpdateCheckCache(
  env: NodeJS.ProcessEnv = process.env,
  options: UpdateCheckOptions = {},
): Promise<void> {
  const cachePath = resolveUpdateCheckPath(env, options);
  if (!cachePath) {
    return;
  }

  const latestVersion = await fetchLatestCliVersion();
  if (!latestVersion) {
    return;
  }

  await writeUpdateCheckCache(cachePath, {
    checkedAt: new Date().toISOString(),
    version: latestVersion,
  });
}

async function readFreshUpdateCheckCache(
  cachePath: string,
): Promise<UpdateCheckCache | null> {
  const cache = await readUpdateCheckCache(cachePath);
  if (!cache) {
    return null;
  }

  const checkedAtMs = Date.parse(cache.checkedAt);
  if (!Number.isFinite(checkedAtMs)) {
    return null;
  }

  if (Date.now() - checkedAtMs >= UPDATE_CACHE_TTL_MS) {
    return null;
  }

  return cache;
}

async function readUpdateCheckCache(
  cachePath: string,
): Promise<UpdateCheckCache | null> {
  try {
    const contents = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(contents) as {
      checkedAt?: unknown;
      version?: unknown;
    };

    if (typeof parsed.version !== "string" || parsed.version.length === 0) {
      return null;
    }

    if (typeof parsed.checkedAt !== "string" || parsed.checkedAt.length === 0) {
      return null;
    }

    return {
      checkedAt: parsed.checkedAt,
      version: parsed.version,
    };
  } catch {
    return null;
  }
}

async function writeUpdateCheckCache(
  cachePath: string,
  cache: UpdateCheckCache,
): Promise<void> {
  try {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, `${JSON.stringify(cache)}\n`, "utf8");
  } catch {
    // Best-effort cache writes should never affect CLI behavior.
  }
}

function resolveUpdateCheckPath(
  env: NodeJS.ProcessEnv,
  options: UpdateCheckOptions = {},
): string | null {
  const configured =
    options.cacheFile ??
    env.BROWSE_UPDATE_CHECK_FILE ??
    env.BB_UPDATE_CHECK_FILE;
  return configured && configured.length > 0 ? configured : null;
}

function spawnBackgroundUpdateCheck(
  env: NodeJS.ProcessEnv,
  cachePath: string,
): void {
  try {
    const workerPath = resolveUpdateCheckWorkerPath();
    const childEnv = {
      ...env,
      BROWSE_UPDATE_CHECK_FILE: cachePath,
    };
    const child = spawn(process.execPath, [workerPath], {
      detached: true,
      env: childEnv,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch {
    // Background update checks are best-effort only.
  }
}

function resolveUpdateCheckWorkerPath(): string {
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  return fileURLToPath(
    new URL(`../update-check-worker.${extension}`, import.meta.url),
  );
}

function writeUpdateNotice(
  currentVersion: string,
  latestVersion: string,
): void {
  process.stderr.write(
    [
      `Update available: ${currentVersion} -> ${latestVersion}.`,
      "Run:",
      `  npm i -g ${CLI_PACKAGE_NAME}@latest`,
      "",
    ].join("\n"),
  );
}

async function fetchLatestCliVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPDATE_TIMEOUT_MS);

  try {
    const latestUrl = new URL(
      `${encodeURIComponent(CLI_PACKAGE_NAME)}/latest`,
      DEFAULT_NPM_REGISTRY_BASE_URL,
    );

    const response = await fetch(latestUrl, {
      headers: {
        accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { version?: unknown };
    if (typeof payload.version !== "string" || payload.version.length === 0) {
      return null;
    }

    return payload.version;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function isVersionNewer(
  currentVersion: string,
  latestVersion: string,
): boolean {
  if (!semver.valid(currentVersion) || !semver.valid(latestVersion)) {
    return false;
  }

  return semver.gt(latestVersion, currentVersion);
}
