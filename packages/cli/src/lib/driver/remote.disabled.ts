import type {
  RemoteDoctorResult,
  StagehandConstructorOptions,
} from "./remote-types.js";
import type { ConnectionTarget } from "./types.js";

/**
 * Stub Browserbase capability used by `build:local-only`. It contains no API
 * key handling and never reaches the cloud. Any attempt to use a remote target
 * fails loudly.
 */

const DISABLED_MESSAGE =
  "Remote (Browserbase) mode is disabled in this local-only build of browse. Rebuild without local-only to use cloud sessions.";

export function resolveExplicitRemoteTarget(): ConnectionTarget {
  throw new Error(DISABLED_MESSAGE);
}

export function autoSelectRemoteTarget(): ConnectionTarget | null {
  return null;
}

export function remoteStagehandOptions(): StagehandConstructorOptions {
  throw new Error(DISABLED_MESSAGE);
}

export function remoteDoctorCheck(): RemoteDoctorResult {
  return { ok: true, message: "remote disabled (local-only build)" };
}
