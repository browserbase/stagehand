import { StatusCodes } from "http-status-codes";

import type {
  DriverInitHints,
  RemoteDoctorResult,
  RemoteInitErrorClassification,
  StagehandConstructorOptions,
} from "./remote-types.js";
import type { ConnectionTarget } from "./types.js";

/**
 * Real Browserbase capability. This is the ONLY module that reads
 * `BROWSERBASE_API_KEY`; it is excluded from `build:local-only` so that
 * local-only artifacts cannot reach Browserbase.
 */

export function resolveExplicitRemoteTarget(): ConnectionTarget {
  return { kind: "remote" };
}

export function autoSelectRemoteTarget(): ConnectionTarget | null {
  return process.env.BROWSERBASE_API_KEY ? { kind: "remote" } : null;
}

export function remoteStagehandOptions(): StagehandConstructorOptions {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing BROWSERBASE_API_KEY for remote mode. Pass --local to run a managed local browser (no key needed), or set BROWSERBASE_API_KEY for cloud sessions.",
    );
  }

  return {
    apiKey,
    browserbaseSessionCreateParams: {
      userMetadata: { browse_cli: "true" },
    },
    disableAPI: true,
    disablePino: true,
    env: "BROWSERBASE",
    verbose: 0,
  };
}

/**
 * Map a failed remote `stagehand.init()` to an actionable message and a
 * stable result code. Browserbase SDK errors carry an HTTP `status`.
 */
export function classifyRemoteInitError(
  error: unknown,
): RemoteInitErrorClassification {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  const httpStatus = typeof status === "number" ? status : undefined;
  const original = error instanceof Error ? error.message : String(error);

  if (httpStatus === StatusCodes.UNAUTHORIZED) {
    return {
      code: "remote_auth_401",
      httpStatus,
      message:
        "Browserbase rejected your BROWSERBASE_API_KEY (401 Unauthorized). A set key makes browse default to remote mode. Check the key at https://browserbase.com/settings, run without one using --local (browse open <url> --local), or diagnose with browse doctor.",
    };
  }

  if (httpStatus === StatusCodes.FORBIDDEN) {
    return {
      code: "remote_auth_403",
      httpStatus,
      message:
        "Browserbase refused this request (403 Forbidden). Your BROWSERBASE_API_KEY may lack access to this project, or your plan may not allow this session type. Check the key at https://browserbase.com/settings, run without one using --local (browse open <url> --local), or diagnose with browse doctor.",
    };
  }

  return {
    code: "remote_session_create_failed",
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    message: `Failed to start a remote (Browserbase) session: ${original}\nRun browse doctor to diagnose remote connectivity.`,
  };
}

export function driverInitHints(): DriverInitHints {
  return {
    chromeNotFound:
      "No Chrome or Chromium found on this machine. Install one (Linux: apt install chromium \u00b7 macOS: brew install --cask google-chrome, or Chromium with CHROME_PATH set), attach to a running browser with --cdp <port>, or set BROWSERBASE_API_KEY to use a remote browser.",
    repeatedInitFailure:
      " (failing repeatedly — fix BROWSERBASE_API_KEY, use --local, or run browse doctor)",
  };
}

export function remoteDoctorCheck(env: NodeJS.ProcessEnv): RemoteDoctorResult {
  if (env.BROWSERBASE_API_KEY) {
    return { ok: true, message: "BROWSERBASE_API_KEY is set" };
  }

  return {
    ok: false,
    message: "BROWSERBASE_API_KEY is not set",
    fix: "export BROWSERBASE_API_KEY=...",
  };
}
