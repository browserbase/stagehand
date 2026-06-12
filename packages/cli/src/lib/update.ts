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
  /** Latest version the user has already been told about (once per version). */
  notifiedVersion?: string;
}

interface UpdateCheckOptions {
  cacheFile?: string;
}

/**
 * Read-only check for a newer published version. Returns the formatted notice
 * text when a fresh cache shows an update is available, otherwise null. Never
 * prints and never hits the network — call from human-facing surfaces (root
 * help, `doctor`) rather than on every command so we don't spam automation.
 */
export async function getUpdateNotice(
  currentVersion: string,
  env: NodeJS.ProcessEnv = process.env,
  options: UpdateCheckOptions = {},
): Promise<string | null> {
  if (isUpdateCheckDisabled(env)) {
    return null;
  }

  const cachePath = resolveUpdateCheckPath(env, options);
  if (!cachePath) {
    return null;
  }

  const cache = await readFreshUpdateCheckCache(cachePath);
  if (!cache || !isVersionNewer(currentVersion, cache.version)) {
    return null;
  }

  // Pull surfaces always render; marking is best-effort so the one-time
  // push notice does not repeat what the user has already seen.
  if (cache.notifiedVersion !== cache.version) {
    await writeUpdateCheckCache(cachePath, {
      ...cache,
      notifiedVersion: cache.version,
    });
  }

  return formatUpdateNotice(currentVersion, cache.version);
}

/**
 * One-time push notice: returns the update notice the FIRST time a given
 * newer version is seen, then stays silent until the next release. No time
 * windows — state is just "which version was already announced" in the same
 * update-check cache. The notice is only returned when recording that state
 * succeeds, so a read-only cache dir can never cause repeated printing.
 */
export async function takeFirstUpdateNotice(
  currentVersion: string,
  env: NodeJS.ProcessEnv = process.env,
  options: UpdateCheckOptions = {},
): Promise<string | null> {
  if (isUpdateCheckDisabled(env)) {
    return null;
  }

  const cachePath = resolveUpdateCheckPath(env, options);
  if (!cachePath) {
    return null;
  }

  const cache = await readFreshUpdateCheckCache(cachePath);
  if (!cache || !isVersionNewer(currentVersion, cache.version)) {
    return null;
  }

  if (cache.notifiedVersion === cache.version) {
    return null;
  }

  const recorded = await writeUpdateCheckCache(cachePath, {
    ...cache,
    notifiedVersion: cache.version,
  });
  if (!recorded) {
    return null;
  }

  return formatUpdateNotice(currentVersion, cache.version);
}

/**
 * Refresh the cached "latest version" in the background when it is stale, so
 * the surfaces that show the notice have fresh data. Silent: never prints.
 */
export async function scheduleBackgroundUpdateCheck(
  env: NodeJS.ProcessEnv = process.env,
  options: UpdateCheckOptions = {},
): Promise<void> {
  if (isUpdateCheckDisabled(env)) {
    return;
  }

  const cachePath = resolveUpdateCheckPath(env, options);
  if (!cachePath) {
    return;
  }

  const cache = await readFreshUpdateCheckCache(cachePath);
  if (cache) {
    return;
  }

  spawnBackgroundUpdateCheck(env, cachePath);
}

function isUpdateCheckDisabled(env: NodeJS.ProcessEnv): boolean {
  return (
    env.BROWSE_DISABLE_UPDATE_CHECK === "1" ||
    env.BB_DISABLE_UPDATE_CHECK === "1"
  );
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
      notifiedVersion?: unknown;
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
      ...(typeof parsed.notifiedVersion === "string" &&
      parsed.notifiedVersion.length > 0
        ? { notifiedVersion: parsed.notifiedVersion }
        : {}),
    };
  } catch {
    return null;
  }
}

async function writeUpdateCheckCache(
  cachePath: string,
  cache: UpdateCheckCache,
): Promise<boolean> {
  try {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, `${JSON.stringify(cache)}\n`, "utf8");
    return true;
  } catch {
    // Best-effort cache writes should never affect CLI behavior.
    return false;
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

function formatUpdateNotice(
  currentVersion: string,
  latestVersion: string,
): string {
  return [
    `Update available: ${currentVersion} -> ${latestVersion}.`,
    "Run:",
    `  npm i -g ${CLI_PACKAGE_NAME}@latest`,
    "",
  ].join("\n");
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
