import type {
  DriverInitHints,
  RemoteBrowserLaunch,
  RemoteDoctorResult,
  RemoteInitErrorClassification,
  RemoteStagehandOptions,
} from "./remote-types.js";
import type { BrowserbaseIdentity, ConnectionTarget } from "./types.js";

const DISABLED_MESSAGE =
  "Remote (Browserbase) mode is disabled in this local-only build of browse. Rebuild without local-only to use cloud sessions.";

export function resolveExplicitRemoteTarget(): ConnectionTarget {
  throw new Error(DISABLED_MESSAGE);
}

export function autoSelectRemoteTarget(): ConnectionTarget | null {
  return null;
}

export function forwardedEnvKeys(): readonly string[] {
  return [];
}

export async function remoteStagehandOptions(): Promise<RemoteStagehandOptions> {
  throw new Error(DISABLED_MESSAGE);
}

export async function launchRemoteBrowser(): Promise<RemoteBrowserLaunch> {
  throw new Error(DISABLED_MESSAGE);
}

export async function remoteBrowserbaseIdentity(): Promise<BrowserbaseIdentity> {
  return {};
}

export function classifyRemoteInitError(error: unknown): RemoteInitErrorClassification {
  return {
    code: "remote_session_create_failed",
    message: error instanceof Error ? error.message : String(error),
  };
}

export function driverInitHints(): DriverInitHints {
  return {
    chromeNotFound:
      "No Chrome or Chromium found on this machine. Install one (Linux: apt install chromium \u00b7 macOS: brew install --cask google-chrome, or Chromium with CHROME_PATH set) or attach to a running browser with --cdp <port>.",
    repeatedInitFailure: " (failing repeatedly — check your browser setup or run browse doctor)",
  };
}

export function remoteDoctorCheck(): RemoteDoctorResult {
  return { ok: true, message: "remote disabled (local-only build)" };
}
