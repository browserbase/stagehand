import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const OPEN_NUDGE_HINT =
  "Tip: open any of these in a live browser — browse open <url> (no API key needed locally).";

const OPEN_NUDGE_MARKER_FILE = "open-nudge.json";

interface OpenNudgeOptions {
  cacheFile?: string;
}

/**
 * Once-per-install nudge from a successful `cloud search`/`cloud fetch`
 * toward `browse open`. Returns the hint the first time it fires — the caller
 * prints it to stderr so machine-readable stdout stays clean — and null once
 * the install marker exists. Best-effort: any failure yields null so it can
 * never affect CLI behavior.
 */
export async function maybeNudgeOpen(
  options: OpenNudgeOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (isNudgeDisabled(env)) {
    return null;
  }

  const cachePath = options.cacheFile;
  if (!cachePath) {
    return null;
  }

  if (await markerExists(cachePath)) {
    return null;
  }

  await writeNudgeMarker(cachePath);
  return OPEN_NUDGE_HINT;
}

/**
 * Print the once-per-install `browse open` hint to stderr, keyed on a marker
 * file in the CLI cache dir. Called by cloud commands after successful output.
 */
export async function writeOpenNudge(
  cacheDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  try {
    const hint = await maybeNudgeOpen(
      { cacheFile: join(cacheDir, OPEN_NUDGE_MARKER_FILE) },
      env,
    );
    if (hint) {
      process.stderr.write(`\n${hint}\n`);
    }
  } catch {
    // Best-effort nudges should never affect command output.
  }
}

function isNudgeDisabled(env: NodeJS.ProcessEnv): boolean {
  if (
    env.BROWSE_DISABLE_OPEN_NUDGE === "1" ||
    env.BB_DISABLE_OPEN_NUDGE === "1"
  ) {
    return true;
  }
  if (env.NODE_ENV === "test") {
    return true;
  }
  return isCiEnvironment(env);
}

function isCiEnvironment(env: NodeJS.ProcessEnv): boolean {
  const value = env.CI;
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return !(
    normalized === "" ||
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  );
}

async function markerExists(cachePath: string): Promise<boolean> {
  try {
    await access(cachePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function writeNudgeMarker(cachePath: string): Promise<void> {
  try {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(
      cachePath,
      `${JSON.stringify({ shownAt: new Date().toISOString() })}\n`,
      "utf8",
    );
  } catch {
    // Best-effort marker writes should never affect CLI behavior.
  }
}
