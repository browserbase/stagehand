import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

let cachedInstallId: string | undefined;
let inFlightResolution: Promise<string> | undefined;

export async function resolveInstallId(
  env: NodeJS.ProcessEnv,
  fallbackId?: string,
): Promise<string> {
  if (cachedInstallId !== undefined) {
    return cachedInstallId;
  }
  inFlightResolution ??= resolveAnonymousInstallId(env, fallbackId).then((id) => {
    cachedInstallId = id;
    return id;
  });
  return inFlightResolution;
}

export function peekInstallId(): string | undefined {
  return cachedInstallId;
}

const INSTALL_ID_MAX_ATTEMPTS = 5;

async function resolveAnonymousInstallId(
  env: NodeJS.ProcessEnv,
  fallbackId?: string,
): Promise<string> {
  const installIdPath = resolveInstallIdPath(env);
  const installId = fallbackId ?? randomUUID();

  if (!env.BROWSERBASE_TELEMETRY_INSTALL_ID_FILE) {
    const migrated = await migrateLegacyInstallId(env, installIdPath);
    if (migrated) {
      return migrated;
    }
  }

  for (let attempt = 0; attempt < INSTALL_ID_MAX_ATTEMPTS; attempt++) {
    try {
      const existing = (await readFile(installIdPath, "utf8")).trim();
      if (existing) {
        return existing;
      }
    } catch {
      // No readable file yet — fall through to attempt an exclusive create.
    }

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
        return installId;
      }
      await delay(1 << attempt);
    }
  }

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
  return join(resolveConfigDir(env), "install-id");
}

export function resolveConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.BROWSERBASE_CONFIG_DIR) {
    return env.BROWSERBASE_CONFIG_DIR;
  }
  const xdg = env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdg, "browserbase");
}

function legacyInstallIdPaths(env: NodeJS.ProcessEnv): string[] {
  const paths: string[] = [];
  if (process.platform === "win32") {
    const baseDir = env.APPDATA ?? env.LOCALAPPDATA ?? join(homedir(), "AppData", "Roaming");
    paths.push(join(baseDir, "Browserbase", "cli", "telemetry-id"));
  } else if (process.platform === "darwin") {
    paths.push(
      join(homedir(), "Library", "Application Support", "Browserbase", "cli", "telemetry-id"),
    );
  }
  const xdg = env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  paths.push(join(xdg, "browserbase", "cli", "telemetry-id"));
  return [...new Set(paths)];
}

async function migrateLegacyInstallId(
  env: NodeJS.ProcessEnv,
  canonicalPath: string,
): Promise<string | undefined> {
  try {
    const existing = (await readFile(canonicalPath, "utf8")).trim();
    if (existing) {
      return existing;
    }
  } catch {
    // Canonical marker missing — fall through to the legacy lookup.
  }

  for (const legacyPath of legacyInstallIdPaths(env)) {
    if (legacyPath === canonicalPath) {
      continue;
    }
    let legacyId: string;
    try {
      legacyId = (await readFile(legacyPath, "utf8")).trim();
    } catch {
      continue;
    }
    if (!legacyId) {
      continue;
    }
    try {
      await mkdir(dirname(canonicalPath), { recursive: true });
      const fh = await open(canonicalPath, "wx");
      try {
        await fh.writeFile(`${legacyId}\n`, "utf8");
      } finally {
        await fh.close();
      }
    } catch {
      // Race lost or FS unwritable — returning the legacy id still keeps it
      // stable for this run.
    }
    return legacyId;
  }
  return undefined;
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

export function setCliVersion(version: string): void {
  if (version) {
    cachedCliVersion = version;
  }
}

export function getCliVersion(): string {
  return cachedCliVersion ?? "unknown";
}
