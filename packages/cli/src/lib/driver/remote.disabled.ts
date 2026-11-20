import type {
  DriverInitHints,
  RemoteBrowserLaunch,
  RemoteDoctorResult,
  RemoteInitErrorClassification,
  RemoteStagehandOptions,
} from "./remote-types.js";
import type { BrowserbaseIdentity, ConnectionTarget } from "./types.js";

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

export function forwardedEnvKeys(): readonly string[] {
  // The local-only build never reaches the cloud, so there is nothing to
  // forward — and no API-key names may appear in this artifact.
  return [];
}

export async function remoteStagehandOptions(): Promise<RemoteStagehandOptions> {
  // Accepts the forwarded-env arg structurally (fewer params is
  // assignable) without naming it, keeping this stub key-name-free.
  throw new Error(DISABLED_MESSAGE);
}

export async function launchRemoteBrowser(): Promise<RemoteBrowserLaunch> {
  throw new Error(DISABLED_MESSAGE);
}

export async function remoteBrowserbaseIdentity(): Promise<BrowserbaseIdentity> {
  return {};
}

function extractHttpStatus(error: unknown, depth = 0): number | undefined {
  if (depth > 5 || !error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") return status;
  const cause = (error as { cause?: unknown }).cause;
  return cause ? extractHttpStatus(cause, depth + 1) : undefined;
}

export function classifyRemoteInitError(error: unknown): RemoteInitErrorClassification {
  // Remote targets cannot be selected in a local-only build, so this is only
  // reachable if a remote error somehow surfaces anyway; preserve it as-is.
  const httpStatus = extractHttpStatus(error);
  return {
    code: "remote_session_create_failed",
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    message: error instanceof Error ? error.message : String(error),
  };
}

export function driverInitHints(): DriverInitHints {
  // Key-free variants: a local-only artifact must not mention the API key.
  return {
    chromeNotFound:
      "No Chrome or Chromium found on this machine. Install one (Linux: apt install chromium \u00b7 macOS: brew install --cask google-chrome, or Chromium with CHROME_PATH set) or attach to a running browser with --cdp <port>.",
    repeatedInitFailure: " (failing repeatedly — check your browser setup or run browse doctor)",
  };
}

export function remoteDoctorCheck(): RemoteDoctorResult {
  return { ok: true, message: "remote disabled (local-only build)" };
}
