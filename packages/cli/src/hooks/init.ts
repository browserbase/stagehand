import { join } from "node:path";

import type { Hook } from "@oclif/core";

import { maybeNudgeInstallSkill } from "../lib/skill-nudge.js";
import { startTelemetryInvocation } from "../lib/telemetry.js";
import { scheduleBackgroundUpdateCheck } from "../lib/update.js";

const hook: Hook.Init = async function ({ config, id }) {
  try {
    startTelemetryInvocation();
  } catch {
    // Best-effort telemetry should never affect CLI behavior.
  }

  try {
    // Silent: refresh the cached latest version when stale, but never print.
    // The notice itself is shown only on `browse`/`--help` and `doctor`.
    await scheduleBackgroundUpdateCheck(process.env, {
      cacheFile: join(config.cacheDir, "update-check.json"),
    });
  } catch {
    // Best-effort update checks should never affect CLI behavior.
  }

  try {
    await maybeNudgeInstallSkill(process.env, {
      cacheFile: join(config.cacheDir, "skill-nudge.json"),
      commandId: id,
    });
  } catch {
    // Best-effort skill nudges should never affect CLI behavior.
  }
};

export default hook;
