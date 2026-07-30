import { join } from "node:path";

import type { Hook } from "@oclif/core";

import { startTelemetryInvocation } from "../lib/telemetry.js";
import { maybeAutoUpdateCli } from "../lib/update.js";

const hook: Hook.Init = async function ({ config }) {
  try {
    startTelemetryInvocation();
  } catch {
    // Best-effort telemetry should never affect CLI behavior.
  }

  try {
    await maybeAutoUpdateCli(config.version, process.env, {
      cacheFile: join(config.cacheDir, "update-check.json"),
    });
  } catch {
    // Best-effort update checks should never affect CLI behavior.
  }
};

export default hook;
