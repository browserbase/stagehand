import type { Hook } from "@oclif/core";

import { captureCommandCompleted } from "../lib/telemetry.js";

const hook: Hook.Finally = async function ({ config, error }) {
  try {
    await captureCommandCompleted(config.version, error);
  } catch {
    // Best-effort telemetry should never affect CLI behavior.
  }
};

export default hook;
