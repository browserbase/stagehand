import Browserbase from "@browserbasehq/sdk";
import { browserbase } from "@browserbasehq/stagehand";
import { StatusCodes } from "http-status-codes";

import { getCliVersion, resolveInstallId, toMetadataValue } from "../identity.js";
import type { ForwardedEnv } from "./daemon/forwarded-env.js";
import { DriverError } from "./errors.js";
import type { DriverModeFlags } from "./mode.js";
import type {
  DriverInitHints,
  RemoteBrowserLaunch,
  RemoteDoctorResult,
  RemoteInitErrorClassification,
  RemoteStagehandOptions,
} from "./remote-types.js";
import type { BrowserbaseIdentity, ConnectionTarget, RemoteConnectionTarget } from "./types.js";

type BrowserbaseDebugClient = {
  sessions: {
    debug(sessionId: string): Promise<{ debuggerUrl?: string }>;
  };
};

export function resolveExplicitRemoteTarget(flags: DriverModeFlags): ConnectionTarget {
  return {
    kind: "remote",
    ...(flags.verified ? { verified: true } : {}),
    ...(flags.proxies ? { proxies: true } : {}),
  };
}

export function autoSelectRemoteTarget(): ConnectionTarget | null {
  return process.env.BROWSERBASE_API_KEY ? { kind: "remote" } : null;
}

/**
 * Env vars the client forwards to a running daemon. Only the API key needs
 * forwarding: the Browserbase backend infers the project from the key, so a
 * project id is not required for session creation. (A multi-project key that
 * wants to pin a non-default project via BROWSERBASE_PROJECT_ID is a rare edge
 * case; that still resolves from the daemon's own env, not the forwarded set.)
 */
export function forwardedEnvKeys(): readonly string[] {
  return ["BROWSERBASE_API_KEY"];
}

export async function remoteStagehandOptions(
  target?: RemoteConnectionTarget,
  forwardedEnv?: ForwardedEnv,
): Promise<RemoteStagehandOptions> {
  const apiKey = resolveApiKey(forwardedEnv);
  if (!apiKey) {
    throw new Error(
      "Missing BROWSERBASE_API_KEY for remote mode. Pass --local to run a managed local browser (no key needed), or set BROWSERBASE_API_KEY for cloud sessions.",
    );
  }

  const userMetadata: Record<string, string> = {
    browse_cli: "true",
    cli_version: toMetadataValue(getCliVersion()),
  };
  const installId = await resolveInstallId(process.env).catch(() => undefined);
  if (installId) {
    userMetadata.install_id = toMetadataValue(installId);
  }

  return {
    apiKey,
    browser: {
      userMetadata,
      ...(target?.proxies ? { proxies: true } : {}),
      ...(target?.verified ? { browserSettings: { verified: true } } : {}),
    },
  };
}

export async function launchRemoteBrowser(
  target?: RemoteConnectionTarget,
  forwardedEnv?: ForwardedEnv,
): Promise<RemoteBrowserLaunch> {
  const { apiKey, browser: sessionOptions } = await remoteStagehandOptions(target, forwardedEnv);
  let browser;
  try {
    browser = await browserbase.launch({ apiKey, ...sessionOptions });
  } catch (error) {
    throw remoteDriverError(error);
  }
  return {
    browser,
    identity: browser.sessionId
      ? await remoteBrowserbaseIdentity(browser.sessionId, forwardedEnv)
      : {},
  };
}

export async function remoteBrowserbaseIdentity(
  sessionId: string,
  forwardedEnv?: ForwardedEnv,
  browserbase?: BrowserbaseDebugClient,
): Promise<BrowserbaseIdentity> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) return {};

  const identity: BrowserbaseIdentity = {
    browserbaseSessionId: normalizedSessionId,
    browserbaseSessionUrl: `https://www.browserbase.com/sessions/${normalizedSessionId}`,
  };
  const apiKey = resolveApiKey(forwardedEnv);
  if (!apiKey) return identity;

  try {
    const client = browserbase ?? new Browserbase({ apiKey });
    const { debuggerUrl } = await client.sessions.debug(normalizedSessionId);
    if (debuggerUrl) {
      identity.browserbaseDebugUrl = debuggerUrl;
    }
  } catch {
    // The stable session URL and ID are still useful if live-view lookup fails.
  }
  return identity;
}

function resolveApiKey(forwardedEnv?: ForwardedEnv): string | undefined {
  return forwardedEnv?.BROWSERBASE_API_KEY ?? process.env.BROWSERBASE_API_KEY;
}

function extractHttpStatus(error: unknown, depth = 0): number | undefined {
  if (depth > 5 || !error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") return status;
  const cause = (error as { cause?: unknown }).cause;
  return cause ? extractHttpStatus(cause, depth + 1) : undefined;
}

function extractUpstreamMessage(error: unknown, maxLen = 120, depth = 0): string | undefined {
  if (depth > 5 || !error) return undefined;
  if (error instanceof Error && error.message) {
    const msg = error.message.trim();
    return msg.length > maxLen ? msg.slice(0, maxLen) + "…" : msg;
  }
  if (typeof error === "object") {
    const cause = (error as { cause?: unknown }).cause;
    return cause ? extractUpstreamMessage(cause, maxLen, depth + 1) : undefined;
  }
  return undefined;
}

export function classifyRemoteInitError(error: unknown): RemoteInitErrorClassification {
  const httpStatus = extractHttpStatus(error);
  if (httpStatus === StatusCodes.UNAUTHORIZED) {
    return {
      code: "remote_auth_401",
      httpStatus,
      message:
        "Browserbase rejected your BROWSERBASE_API_KEY (401 Unauthorized). A set key makes browse default to remote mode. Check the key at https://browserbase.com/settings, run without one using --local (browse open <url> --local), or diagnose with browse doctor.",
    };
  }

  if (httpStatus === StatusCodes.PAYMENT_REQUIRED) {
    return {
      code: "remote_payment_required",
      httpStatus,
      message:
        "Browserbase plan limit or payment required (402). Check your plan at https://browserbase.com/settings/billing, or run with --local to use a local browser.",
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

  if (httpStatus === StatusCodes.TOO_MANY_REQUESTS) {
    return {
      code: "remote_rate_limited",
      httpStatus,
      message:
        "Browserbase concurrency or rate limit reached (429). Retry later, lower parallel sessions, or run with --local to use a local browser.",
    };
  }

  const upstreamMsg = extractUpstreamMessage(error);
  return {
    code: "remote_session_create_failed",
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    message: upstreamMsg
      ? `Failed to start a remote (Browserbase) session: ${upstreamMsg}`
      : "Failed to start a remote (Browserbase) session.",
  };
}

function remoteDriverError(error: unknown): DriverError {
  const { code, httpStatus, message } = classifyRemoteInitError(error);
  return new DriverError(message, { code, httpStatus });
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
