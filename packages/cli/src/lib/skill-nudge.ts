import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";

import { isBrowseSkillInstalled } from "./skill-presence.js";

interface SkillNudgeOptions {
  cacheFile?: string;
  commandId?: string;
}

const SKILL_NUDGE_TIP = [
  "Tip: browse works best with its skill loaded into your agent.",
  "Run:",
  "  browse skills install",
  "",
].join("\n");

/**
 * Once-per-install hint to install the browse skill, printed to stderr so it
 * never corrupts machine-readable stdout. Fires on the first regular command
 * when the canonical skill dir is absent; a marker file in the CLI cache dir
 * (same mechanism as update-check.json) keeps it silent afterwards.
 * Best-effort: any failure is swallowed so it can never affect CLI behavior.
 */
export async function maybeNudgeInstallSkill(
  env: NodeJS.ProcessEnv = process.env,
  options: SkillNudgeOptions = {},
): Promise<void> {
  if (isNudgeDisabled(env)) {
    return;
  }

  // The user is already engaging with skills; don't nudge on those commands or
  // on bare/`--help` invocations (the help banner covers discovery there).
  const commandId = options.commandId;
  if (!commandId || commandId === "help" || commandId.startsWith("skills")) {
    return;
  }

  const cachePath = options.cacheFile;
  if (!cachePath) {
    return;
  }

  if (await markerExists(cachePath)) {
    return;
  }

  if (await isBrowseSkillInstalled()) {
    return;
  }

  // Write the marker first and only nudge when it actually lands, so an
  // unwritable cache dir can't cause the once-per-install tip to fire on
  // every run.
  if (await writeNudgeMarker(cachePath)) {
    process.stderr.write(SKILL_NUDGE_TIP);
  }
}

function isNudgeDisabled(env: NodeJS.ProcessEnv): boolean {
  if (
    env.BROWSE_DISABLE_SKILL_NUDGE === "1" ||
    env.BB_DISABLE_SKILL_NUDGE === "1"
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

async function writeNudgeMarker(cachePath: string): Promise<boolean> {
  try {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(
      cachePath,
      `${JSON.stringify({ shownAt: new Date().toISOString() })}\n`,
      "utf8",
    );
    return true;
  } catch {
    // Best-effort marker writes should never affect CLI behavior.
    return false;
  }
}
