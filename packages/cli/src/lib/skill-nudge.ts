import { isBrowseSkillInstalled } from "./skill-presence.js";

/**
 * Stderr tip suggesting `browse skills install`, shown when a new browser
 * session's daemon starts and the bundled skill is not installed. The daemon
 * spawn is the session boundary, so the tip appears once per session until
 * the skill is installed — no marker files or time windows. Best-effort and
 * stderr-only: it can never affect machine-readable stdout.
 */
export async function maybeNudgeInstallSkill(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (isNudgeDisabled(env)) {
    return;
  }

  if (await isBrowseSkillInstalled()) {
    return;
  }

  writeNudge();
}

function writeNudge(): void {
  process.stderr.write(
    [
      "Tip: browse works best with its skill loaded into your agent.",
      "Run:",
      "  browse skills install",
      "",
    ].join("\n"),
  );
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
