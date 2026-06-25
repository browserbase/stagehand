import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, open, readFile } from "node:fs/promises";
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

async function resolveAnonymousInstallId(
  env: NodeJS.ProcessEnv,
  fallbackId?: string,
): Promise<string> {
  const installIdPath = resolveInstallIdPath(env);

  try {
    const existing = (await readFile(installIdPath, "utf8")).trim();
    if (existing) {
      return existing;
    }
  } catch {
    // Fall through and create a new anonymous install ID.
  }

  const installId = fallbackId ?? randomUUID();

  try {
    await mkdir(dirname(installIdPath), { recursive: true });
    // Use exclusive-create ('wx') so that only one concurrent first-run process
    // wins the write. If another process already created the file (EEXIST), read
    // back whatever it wrote so both processes converge on the same stable id.
    const fh = await open(installIdPath, "wx");
    try {
      await fh.writeFile(`${installId}\n`, "utf8");
    } finally {
      await fh.close();
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      // Another concurrent first-run wrote the file first — use its id.
      try {
        const raced = (await readFile(installIdPath, "utf8")).trim();
        if (raced) {
          return raced;
        }
      } catch {
        // If the re-read also fails, fall through and return the in-memory id.
      }
    }
    // Any other error (e.g. permissions): continue with an in-memory id.
  }

  return installId;
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
 * The CLI version, read once from the package's own `package.json`. This is the
 * same source oclif uses for `config.version`; it is read here so non-command
 * contexts (remote session options, cloud API headers) can stamp the version
 * without an oclif `Config` in hand.
 */
export function getCliVersion(): string {
  if (cachedCliVersion !== undefined) {
    return cachedCliVersion;
  }
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };
    cachedCliVersion =
      typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    cachedCliVersion = "unknown";
  }
  return cachedCliVersion;
}
