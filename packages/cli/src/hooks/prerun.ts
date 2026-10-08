import type { Hook } from "@oclif/core";

import { captureCommandInvoked } from "../lib/telemetry.js";

const hook: Hook.Prerun = async function ({ Command, config }) {
  try {
    captureCommandInvoked(Command, config.version);
  } catch {
    // Best-effort telemetry should never affect CLI behavior.
  }
};

export default hook;
