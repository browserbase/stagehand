/**
 * Telemetry for community and help link events.
 *
 * These events track when users interact with support resources, helping
 * measure the effectiveness of community channels and identify pain points.
 */

import { detectAgent } from "./agent.js";
import { resolveInstallId } from "./identity.js";

const browserbaseTelemetrySource = "cli";
const browserbaseTelemetryHost = "https://us.i.posthog.com";
const browserbaseTelemetryTimeoutMs = 400;
const browserbaseTelemetryProjectToken = "phc_CKQBSpdeU2GGyBgcBhW8ZbDnhEVbZbuzMsqhMb9YRs5x";

type TelemetryPrimitive = string | number | boolean | null;
type TelemetryProperties = Record<string, TelemetryPrimitive>;

export type LinkTarget = "discord" | "github_issues" | "docs";
export type LinkSource = "discord_command" | "issues_command" | "help_footer" | "error_hint";
export type HelpLinksSource = "help_footer" | "error_hint";

export interface LinkOpenedProperties {
  target: LinkTarget;
  source: LinkSource;
  opened: boolean;
  browser_open_succeeded: boolean;
}

export interface HelpLinksShownProperties {
  source: HelpLinksSource;
  result_code?: string | null;
  error_type?: string | null;
}

let cliVersion: string | undefined;
let helpLinksShownThisInvocation = false;

export function setLinkTelemetryCliVersion(version: string): void {
  cliVersion = version;
}

export function resetLinkTelemetryInvocation(): void {
  helpLinksShownThisInvocation = false;
}

export async function captureLinkOpened(
  properties: LinkOpenedProperties,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (isTelemetryDisabled(env)) {
    return;
  }

  const telemetryProps: TelemetryProperties = {
    target: properties.target,
    source: properties.source,
    opened: properties.opened,
    browser_open_succeeded: properties.browser_open_succeeded,
  };

  await capture("cli.link_opened", telemetryProps, env).catch(() => {
    // Best-effort telemetry should never affect CLI behavior.
  });
}

export async function captureHelpLinksShown(
  properties: HelpLinksShownProperties,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (isTelemetryDisabled(env)) {
    return;
  }

  if (helpLinksShownThisInvocation) {
    return;
  }
  helpLinksShownThisInvocation = true;

  const telemetryProps: TelemetryProperties = {
    source: properties.source,
    result_code: properties.result_code ?? null,
    error_type: properties.error_type ?? null,
  };

  await capture("cli.help_links_shown", telemetryProps, env).catch(() => {
    // Best-effort telemetry should never affect CLI behavior.
  });
}

async function capture(
  event: "cli.link_opened" | "cli.help_links_shown",
  properties: TelemetryProperties,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const transport = resolveTransportConfig(env);
  const [distinctId, agent] = await Promise.all([resolveInstallId(env), detectAgent()]);

  const baseProperties: TelemetryProperties = {
    source: browserbaseTelemetrySource,
    cli_version: cliVersion ?? "unknown",
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    agent,
    $process_person_profile: false,
  };

  await posthogCapture(transport, {
    api_key: transport.projectToken,
    distinct_id: distinctId,
    event,
    timestamp: new Date().toISOString(),
    properties: {
      ...baseProperties,
      ...properties,
    },
  });
}

interface PostHogTransportConfig {
  host: string;
  projectToken: string;
  timeoutMs: number;
}

interface PostHogCapturePayload {
  api_key: string;
  distinct_id: string;
  event: string;
  properties: TelemetryProperties;
  timestamp: string;
}

function resolveTransportConfig(env: NodeJS.ProcessEnv): PostHogTransportConfig {
  const host = normalizeHost(env.BROWSERBASE_TELEMETRY_HOST ?? browserbaseTelemetryHost);
  const timeoutMs = parseTimeoutMs(env.BROWSERBASE_TELEMETRY_TIMEOUT_MS);

  return {
    host,
    timeoutMs,
    projectToken: browserbaseTelemetryProjectToken,
  };
}

function parseTimeoutMs(value: string | undefined): number {
  if (!value) {
    return browserbaseTelemetryTimeoutMs;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return browserbaseTelemetryTimeoutMs;
  }

  return parsed;
}

function normalizeHost(host: string): string {
  return host.endsWith("/") ? host.slice(0, -1) : host;
}

function isTelemetryDisabled(env: NodeJS.ProcessEnv): boolean {
  return (
    envFlagEnabled(env.DO_NOT_TRACK) ||
    envFlagEnabled(env.BROWSERBASE_TELEMETRY_DISABLED) ||
    isCiEnvironment(env) ||
    isUnconfiguredTestEnvironment(env)
  );
}

function isCiEnvironment(env: NodeJS.ProcessEnv): boolean {
  const value = env.CI;
  if (!value) {
    return false;
  }
  return !isExplicitFalse(value);
}

function isUnconfiguredTestEnvironment(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "test" && !env.BROWSERBASE_TELEMETRY_HOST;
}

function envFlagEnabled(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return !isExplicitFalse(value);
}

function isExplicitFalse(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  );
}

async function posthogCapture(
  transport: PostHogTransportConfig,
  payload: PostHogCapturePayload,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), transport.timeoutMs);
  timeout.unref?.();
  const endpoint = `${transport.host}/i/v0/e/`;

  try {
    await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Best-effort telemetry should never affect CLI behavior.
  } finally {
    clearTimeout(timeout);
  }
}
