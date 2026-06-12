import type {
  DriverInitHints,
  RemoteDoctorResult,
  RemoteInitErrorClassification,
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

export function classifyRemoteInitError(
  error: unknown,
): RemoteInitErrorClassification {
  // Remote targets cannot be selected in a local-only build, so this is only
  // reachable if a remote error somehow surfaces anyway; preserve it as-is.
  return {
    code: "remote_session_create_failed",
    message: error instanceof Error ? error.message : String(error),
  };
}

export function driverInitHints(): DriverInitHints {
  // Key-free variants: a local-only artifact must not mention the API key.
  return {
    chromeNotFound:
      "No Chrome or Chromium found on this machine. Install one (Linux: apt install chromium \u00b7 macOS: brew install --cask google-chrome, or Chromium with CHROME_PATH set) or attach to a running browser with --cdp <port>.",
    repeatedInitFailure:
      " (failing repeatedly — check your browser setup or run browse doctor)",
  };
}

export function remoteDoctorCheck(): RemoteDoctorResult {
  return { ok: true, message: "remote disabled (local-only build)" };
}
