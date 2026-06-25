import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Shared anonymous-install identity for the CLI.
 *
 * The install id is a stable, per-machine anonymous UUID persisted to a marker
 * file. It is reused for (a) telemetry, (b) remote browser session
 * `userMetadata`, and (c) cloud API request headers so that CLI-driven usage is
 * attributable to a single install without identifying the user.
 *
 * Resolution is best-effort and must never throw: a read/write failure falls
 * back to an in-memory UUID. After the first async resolution, the value is
 * cached so it can be read synchronously via {@link peekInstallId}.
 */

let cachedInstallId: string | undefined;
let inFlightResolution: Promise<string> | undefined;

/**
 * Resolve the anonymous install id, reading (or creating) the marker file.
 * Memoizes the result so repeated calls share one resolution. Behavior matches
 * the original telemetry implementation byte-for-byte: same marker path, a
 * UUID on miss, and swallowed write failures.
 */
export async function resolveInstallId(
  env: NodeJS.ProcessEnv,
  fallbackId?: string,
): Promise<string> {
  if (cachedInstallId !== undefined) {
    return cachedInstallId;
  }
  inFlightResolution ??= resolveAnonymousInstallId(env, fallbackId).then(
    (id) => {
      cachedInstallId = id;
      return id;
    },
  );
  return inFlightResolution;
}

/**
 * Read the install id synchronously if it has already been resolved. Returns
 * `undefined` when resolution has not completed yet — callers must not block on
 * it (e.g. cloud API headers omit the id rather than wait for disk I/O).
 */
export function peekInstallId(): string | undefined {
  return cachedInstallId;
}

const INSTALL_ID_MAX_ATTEMPTS = 5;

/**
 * Resolve (or create) the anonymous install id with a bounded, race-safe loop.
 *
 * The contract is: never return an id that wasn't persisted, and converge so
 * concurrent first-run processes all settle on a single stable id. Resolution
 * is best-effort and never throws — a hard FS failure (e.g. read-only volume)
 * falls back to an in-memory id.
 *
 * Each attempt:
 *  1. Read the marker; if it holds a non-empty id, that id won — use it.
 *  2. Try an exclusive create (`open(path, "wx")`) and write our id; if the
 *     create succeeds we won the race — persist and return our id.
 *  3. On EEXIST the file exists but was empty (another process created it and
 *     hasn't written yet, or a stale empty marker). Back off briefly and loop
 *     so the next read can pick up the winner's id.
 *  4. On any non-EEXIST `open` error (e.g. EACCES/EROFS), the FS is unwritable;
 *     return the in-memory id without throwing.
 *
 * If every attempt sees an empty marker (no one ever wrote), we take ownership
 * after the loop with a truncating `writeFile` so we still return a persisted
 * id rather than a non-persistent one.
 */
async function resolveAnonymousInstallId(
  env: NodeJS.ProcessEnv,
  fallbackId?: string,
): Promise<string> {
  const installIdPath = resolveInstallIdPath(env);
  const installId = fallbackId ?? randomUUID();

  for (let attempt = 0; attempt < INSTALL_ID_MAX_ATTEMPTS; attempt++) {
    // 1. Prefer an already-persisted, non-empty id.
    try {
      const existing = (await readFile(installIdPath, "utf8")).trim();
      if (existing) {
        return existing;
      }
    } catch {
      // No readable file yet — fall through to attempt an exclusive create.
    }

    // 2. Try to win the create race with an exclusive-create write.
    try {
      await mkdir(dirname(installIdPath), { recursive: true });
      const fh = await open(installIdPath, "wx");
      try {
        await fh.writeFile(`${installId}\n`, "utf8");
      } finally {
        await fh.close();
      }
      return installId;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        // 4. FS is unwritable (permissions, read-only) — best-effort fallback.
        return installId;
      }
      // 3. File exists but was empty on our read. Another process is about to
      //    write it; back off and loop so the next read picks up its id.
      await delay(1 << attempt); // ~1, 2, 4, 8 ms
    }
  }

  // 5. The marker exists but stayed empty across every attempt (no winner ever
  //    wrote). Take ownership with a truncating write so we never return a
  //    non-persisted id.
  try {
    await writeFile(installIdPath, `${installId}\n`, "utf8");
  } catch {
    // If even this fails, return the in-memory id without throwing.
  }
  return installId;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveInstallIdPath(env: NodeJS.ProcessEnv): string {
  const overriddenPath = env.BROWSERBASE_TELEMETRY_INSTALL_ID_FILE;
  if (overriddenPath) {
    return overriddenPath;
  }

  if (process.platform === "win32") {
    const baseDir =
      env.APPDATA ?? env.LOCALAPPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(baseDir, "Browserbase", "cli", "telemetry-id");
  }

  if (process.platform === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "Browserbase",
      "cli",
      "telemetry-id",
    );
  }

  const baseDir = env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(baseDir, "browserbase", "cli", "telemetry-id");
}

/**
 * Sanitize a value for use in Browserbase `userMetadata`. The session-create
 * validator only accepts characters matching `[\w\-_,;:.()&$%#@!?~]` and
 * enforces a total length limit; this function strips everything else and
 * truncates to `max` characters (default 64) so a semver `+build` suffix or
 * any other unexpected character cannot cause a 400 on every remote session.
 */
export function toMetadataValue(v: string, max = 64): string {
  return v.replace(/[^\w\-_,;:.()&$%#@!?~]/g, "").slice(0, max);
}

let cachedCliVersion: string | undefined;

/**
 * Seed the CLI version from oclif's `Config.version` (the single source of
 * truth). This is called once at startup from `BrowseCommand.init()` in base.ts
 * — and because every command (including the background `browse daemon` that
 * creates Browserbase sessions) extends `BrowseCommand`, the cache is populated
 * in whichever process builds a session/header. Only truthy values are stored
 * so a missing version leaves the `"unknown"` fallback intact.
 */
export function setCliVersion(version: string): void {
  if (version) {
    cachedCliVersion = version;
  }
}

/**
 * The CLI version for non-command contexts (remote session `userMetadata`,
 * cloud API headers). It is seeded once from `Config.version` in base.ts at
 * startup via {@link setCliVersion}; this reads back the cached value with no
 * filesystem access. Falls back to `"unknown"` if it was never seeded.
 */
export function getCliVersion(): string {
  return cachedCliVersion ?? "unknown";
}
