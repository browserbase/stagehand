import { createHash } from "node:crypto";
import Browserbase from "@browserbasehq/sdk";
import { browserbase } from "@browserbasehq/stagehand";
import { StatusCodes } from "http-status-codes";

import { developmentApiOrigin, readCredential } from "../auth/store.js";
import { sdkCredentialFetch, resolveCredential } from "../auth/credentials.js";
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

/**
 * Real Browserbase capability. This module and its credential helpers are
 * excluded from `build:local-only` so that
 * local-only artifacts cannot reach Browserbase.
 */

export function resolveExplicitRemoteTarget(flags: DriverModeFlags): ConnectionTarget {
  return {
    kind: "remote",
    ...(flags.verified ? { verified: true } : {}),
    ...(flags.proxies ? { proxies: true } : {}),
  };
}

export function autoSelectRemoteTarget(): ConnectionTarget | null {
  return resolveCredential() ? { kind: "remote" } : null;
}

/**
 * Forward explicit credentials and saved-login configuration to a running daemon.
 * Saved keys themselves are read from the private store when launching a browser.
 */
export function forwardedEnvKeys(): readonly string[] {
  return [
    "BROWSERBASE_API_KEY",
    "BROWSERBASE_CONFIG_DIR",
    "BROWSERBASE_BASE_URL",
    "BROWSERBASE_PROJECT_ID",
    "XDG_CONFIG_HOME",
  ];
}

export function savedCredentialFingerprint(env: NodeJS.ProcessEnv): string | undefined {
  if (env.BROWSERBASE_API_KEY) return undefined;
  try {
    const credential = readCredential(env);
    return credential
      ? createHash("sha256").update(JSON.stringify(credential)).digest("hex")
      : undefined;
  } catch {
    // Explicit local browser commands must still work with an invalid saved login.
    // Remote startup reports the storage error when resolving its credential.
    return undefined;
  }
}

function remoteEnvironment(forwardedEnv?: ForwardedEnv): NodeJS.ProcessEnv {
  if (!forwardedEnv) return process.env;
  const env = { ...process.env };
  for (const key of forwardedEnvKeys()) {
    if (key in forwardedEnv) env[key] = forwardedEnv[key] || undefined;
  }
  return env;
}

export async function remoteStagehandOptions(
  target?: RemoteConnectionTarget,
  forwardedEnv?: ForwardedEnv,
): Promise<RemoteStagehandOptions> {
  const credential = resolveCredential({}, remoteEnvironment(forwardedEnv));
  if (!credential) {
    throw new Error(
      "Run browse login or set BROWSERBASE_API_KEY for remote mode. Pass --local for a local browser.",
    );
  }
  if (credential.source === "saved" && credential.baseUrl === developmentApiOrigin) {
    throw new Error(
      "Development login supports cloud API commands only. Remote browser automation also uses the Stagehand service; run browse login for production, or use --local.",
    );
  }
  const { apiKey } = credential;

  // Stamp anonymous attribution onto the session. Resolving the install id is
  // best-effort and never throws; if it can't be resolved we still send
  // browse_cli + cli_version so the session stays attributable to the CLI.
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
    ...(credential.source === "saved"
      ? { baseUrl: credential.baseUrl, clientOptions: { fetch: sdkCredentialFetch(credential) } }
      : {}),
    browser: {
      ...(credential.source === "saved" ? { projectId: credential.projectId } : {}),
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
  const {
    apiKey,
    browser: sessionOptions,
    baseUrl,
    clientOptions,
  } = await remoteStagehandOptions(target, forwardedEnv);
  // The V4 factory provisions the packaged Stagehand extension before it
  // creates the Browserbase session and owns both resources on browser.close().
  // A raw sessions.create() + browserbase.connect() skips that provisioning.
  let browser;
  try {
    browser = await browserbase.launch({
      apiKey,
      ...sessionOptions,
      ...(baseUrl ? { baseUrl, clientOptions } : {}),
    });
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
  const credential = resolveCredential({}, remoteEnvironment(forwardedEnv));
  if (!credential) return identity;

  try {
    const client =
      browserbase ??
      new Browserbase({
        apiKey: credential.apiKey,
        baseURL: credential.baseUrl,
        ...(credential.source === "saved" ? { fetch: sdkCredentialFetch(credential) } : {}),
      });
    const { debuggerUrl } = await client.sessions.debug(normalizedSessionId);
    if (debuggerUrl) {
      identity.browserbaseDebugUrl = debuggerUrl;
    }
  } catch {
    // The stable session URL and ID are still useful if live-view lookup fails.
  }
  return identity;
}

/**
 * Map a failed remote `stagehand.init()` to an actionable message and a
 * stable result code. Browserbase SDK errors carry an HTTP `status`.
 */
export function classifyRemoteInitError(error: unknown): RemoteInitErrorClassification {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  const httpStatus = typeof status === "number" ? status : undefined;
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
    message:
      "Failed to start a remote (Browserbase) session. Run browse doctor to diagnose remote connectivity.",
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
  let credential;
  try {
    credential = resolveCredential({}, env);
  } catch {
    return {
      ok: false,
      message: "Saved Browserbase login could not be read or used",
      fix: "Run browse auth status for details. Unlock your OS keystore or repair the private credential file; alternatively, use a new private BROWSERBASE_CONFIG_DIR and run browse login, or set BROWSERBASE_API_KEY.",
    };
  }
  if (credential) {
    return {
      ok: true,
      message:
        credential.source === "saved"
          ? "Saved Browserbase login is available"
          : "BROWSERBASE_API_KEY is set",
    };
  }

  return {
    ok: false,
    message: "BROWSERBASE_API_KEY is not set",
    fix: "browse login (or set BROWSERBASE_API_KEY)",
  };
}
