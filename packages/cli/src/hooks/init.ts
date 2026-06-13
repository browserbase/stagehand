import { join } from "node:path";

import type { Hook } from "@oclif/core";

import { startTelemetryInvocation } from "../lib/telemetry.js";
import {
  scheduleBackgroundUpdateCheck,
  takeUpdateNotice,
} from "../lib/update.js";

const hook: Hook.Init = async function ({ config, id }) {
  try {
    startTelemetryInvocation();
  } catch {
    // Best-effort telemetry should never affect CLI behavior.
  }

  try {
    // Silent: refresh the cached latest version when stale, but never print.
    await scheduleBackgroundUpdateCheck(process.env, {
      cacheFile: join(config.cacheDir, "update-check.json"),
    });
  } catch {
    // Best-effort update checks should never affect CLI behavior.
  }

  try {
    // Remind until upgraded, at most once per interval; help and doctor render
    // it themselves, so skip those surfaces to avoid double-printing.
    if (id && id !== "help" && id !== "doctor") {
      const notice = await takeUpdateNotice(config.version, process.env, {
        cacheFile: join(config.cacheDir, "update-check.json"),
      });
      if (notice) {
        process.stderr.write(`\n${notice}`);
      }
    }
  } catch {
    // Best-effort update notices should never affect CLI behavior.
  }

};

export default hook;
