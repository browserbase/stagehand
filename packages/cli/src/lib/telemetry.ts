import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { Command } from "@oclif/core";

import { detectAgent } from "./agent.js";
import { getRunTelemetry, resetRunTelemetry } from "./run-telemetry.js";
import type { CommandFailureTelemetry } from "./errors.js";

const browserbaseTelemetrySource = "cli";
const browserbaseTelemetryHost = "https://us.i.posthog.com";
const browserbaseTelemetryTimeoutMs = 400;
const browserbaseTelemetryProjectToken =
  "phc_CKQBSpdeU2GGyBgcBhW8ZbDnhEVbZbuzMsqhMb9YRs5x";

type TelemetryPrimitive = string | number | boolean | null;
type TelemetryProperties = Record<string, TelemetryPrimitive>;

type CliTelemetryEvent = "cli.command_invoked" | "cli.command_completed";
type CliTelemetryErrorType = "oclif" | "runtime";

interface CliTelemetry {
  capture(
    event: CliTelemetryEvent,
    properties: TelemetryProperties,
  ): Promise<void>;
}

interface CreateCliTelemetryOptions {
  cliVersion: string;
  env?: NodeJS.ProcessEnv;
  sessionId?: string;
}

interface PostHogTransportConfig {
  host: string;
  projectToken: string;
  timeoutMs: number;
}

interface PostHogCapturePayload {
  api_key: string;
  distinct_id: string;
  event: CliTelemetryEvent;
  properties: TelemetryProperties;
  timestamp: string;
}

interface CommandInvocation {
  commandPath: string;
  topLevelCommand: string;
  leafCommand: string;
  startedAtMs: number;
}

interface RecordedCommandError {
  code: string | null;
  telemetry: CommandFailureTelemetry;
  type: CliTelemetryErrorType;
}

interface TelemetryState {
  command?: CommandInvocation;
  pendingInvokedCapture?: Promise<void>;
  recordedError?: RecordedCommandError;
  startedAtMs: number;
}

let telemetryState: TelemetryState | undefined;
let telemetryClient: CliTelemetry | undefined;
let telemetryClientVersion: string | undefined;

export function startTelemetryInvocation(startedAtMs = Date.now()): void {
  resetRunTelemetry();
  telemetryState = { startedAtMs };
}

export function captureCommandInvoked(
  CommandClass: Command.Class,
  cliVersion: string,
): void {
  const state = getTelemetryState();
  const command = createCommandInvocation(CommandClass, state.startedAtMs);
  state.command = command;

  state.pendingInvokedCapture = getCliTelemetry(cliVersion)
    .capture("cli.command_invoked", commandInvokedProperties(command))
    .catch(() => {
      // Best-effort telemetry should never affect CLI behavior.
    });
}

export function recordCommandError(
  type: CliTelemetryErrorType,
  code: string | null,
  telemetry: CommandFailureTelemetry = {},
): void {
  const state = getTelemetryState();
  state.recordedError = { type, code, telemetry };
}

export async function captureCommandCompleted(
  cliVersion: string,
  error: Error | undefined,
): Promise<void> {
  const state = telemetryState;
  const command = state?.command;
  if (!state || !command) {
    return;
  }

  const exitCode = resolveExitCode(error);
  const success = exitCode === 0;
  const completionCapture = getCliTelemetry(cliVersion)
    .capture(
      "cli.command_completed",
      commandCompletedProperties(command, {
        error,
        exitCode,
        recordedError: state.recordedError,
        success,
      }),
    )
    .catch(() => {
      // Best-effort telemetry should never affect CLI behavior.
    });

  await Promise.allSettled([
    state.pendingInvokedCapture ?? Promise.resolve(),
    completionCapture,
  ]);
}

function createCliTelemetry(options: CreateCliTelemetryOptions): CliTelemetry {
  const env = options.env ?? process.env;
  const transport = resolveTransportConfig(env);
  const telemetryEnabled = !isTelemetryDisabled(env);
  const distinctIdPromise = telemetryEnabled
    ? resolveAnonymousInstallId(env, options.sessionId)
    : Promise.resolve("");
  const agentPromise = telemetryEnabled ? detectAgent() : Promise.resolve(null);

  const baseProperties: TelemetryProperties = {
    source: browserbaseTelemetrySource,
    cli_version: options.cliVersion,
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    $process_person_profile: false,
  };

  return {
    async capture(event, properties) {
      if (!telemetryEnabled) {
        return;
      }

      const [distinctId, agent] = await Promise.all([
        distinctIdPromise,
        agentPromise,
      ]);

      await posthogCapture(transport, {
        api_key: transport.projectToken,
        distinct_id: distinctId,
        event,
        timestamp: new Date().toISOString(),
        properties: {
          ...baseProperties,
          agent,
          ...properties,
        },
      });
    },
  };
}

function getCliTelemetry(cliVersion: string): CliTelemetry {
  if (!telemetryClient || telemetryClientVersion !== cliVersion) {
    telemetryClient = createCliTelemetry({ cliVersion });
    telemetryClientVersion = cliVersion;
  }
  return telemetryClient;
}

function getTelemetryState(): TelemetryState {
  telemetryState ??= { startedAtMs: Date.now() };
  return telemetryState;
}

function createCommandInvocation(
  CommandClass: Command.Class,
  startedAtMs: number,
): CommandInvocation {
  const commandPath = resolveCommandPath(CommandClass.id);
  const pathTokens = commandPath.split(".").filter(Boolean);

  return {
    commandPath,
    topLevelCommand: pathTokens[0] ?? CommandClass.id,
    leafCommand: pathTokens.at(-1) ?? CommandClass.id,
    startedAtMs,
  };
}

function commandInvokedProperties(
  invocation: CommandInvocation,
): TelemetryProperties {
  return {
    command_path: invocation.commandPath,
    top_level_command: invocation.topLevelCommand,
    leaf_command: invocation.leafCommand,
    command_depth: invocation.commandPath.split(".").filter(Boolean).length,
  };
}

function commandCompletedProperties(
  invocation: CommandInvocation,
  completion: {
    error: Error | undefined;
    exitCode: number;
    recordedError?: RecordedCommandError;
    success: boolean;
  },
): TelemetryProperties {
  const durationMs = Date.now() - invocation.startedAtMs;
  const errorType = completion.success
    ? null
    : (completion.recordedError?.type ?? inferErrorType(completion.error));
  const runTelemetry = getRunTelemetry();
  const failureTelemetry = completion.recordedError?.telemetry;
  const resultCode =
    failureTelemetry?.resultCode ??
    runTelemetry.resultCode ??
    fallbackResultCode(completion.success, errorType);

  return {
    command_path: invocation.commandPath,
    top_level_command: invocation.topLevelCommand,
    leaf_command: invocation.leafCommand,
    command_depth: invocation.commandPath.split(".").filter(Boolean).length,
    duration_ms: Math.max(0, durationMs),
    exit_code: completion.exitCode,
    success: completion.success,
    error_type: errorType,
    error_code: completion.success
      ? null
      : (completion.recordedError?.code ?? inferErrorCode(completion.error)),
    result_code: resultCode,
    http_status:
      failureTelemetry?.httpStatus ?? runTelemetry.httpStatus ?? null,
    request_had_http_response:
      failureTelemetry?.requestHadHttpResponse ??
      runTelemetry.requestHadHttpResponse ??
      null,
  };
}

function fallbackResultCode(
  success: boolean,
  errorType: CliTelemetryErrorType | null,
): string {
  if (success) {
    return "ok";
  }
  if (errorType === "oclif") {
    return "usage_error";
  }
  return "unexpected";
}

function resolveCommandPath(commandId: string): string {
  return commandId.split(":").filter(Boolean).join(".");
}

function resolveExitCode(error: Error | undefined): number {
  if (error) {
    const oclifExit = (error as { oclif?: { exit?: unknown } }).oclif?.exit;
    if (typeof oclifExit === "number") {
      return oclifExit;
    }

    const exitCode = (error as { exitCode?: unknown }).exitCode;
    if (typeof exitCode === "number") {
      return exitCode;
    }

    return typeof process.exitCode === "number" ? process.exitCode : 1;
  }

  return typeof process.exitCode === "number" ? process.exitCode : 0;
}

function inferErrorType(
  error: Error | undefined,
): CliTelemetryErrorType | null {
  if (!error) {
    return null;
  }

  const oclifExit = (error as { oclif?: { exit?: unknown } }).oclif?.exit;
  return typeof oclifExit === "number" ? "oclif" : "runtime";
}

function inferErrorCode(error: Error | undefined): string | null {
  if (!error) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code.trim()) {
    return sanitizeErrorCode(code);
  }

  return sanitizeErrorCode(error.name || "Error");
}

function sanitizeErrorCode(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 80) || "Error";
}

function resolveTransportConfig(
  env: NodeJS.ProcessEnv,
): PostHogTransportConfig {
  const host = normalizeHost(
    env.BROWSERBASE_TELEMETRY_HOST ?? browserbaseTelemetryHost,
  );
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

async function resolveAnonymousInstallId(
  env: NodeJS.ProcessEnv,
  fallbackId?: string,
): Promise<string> {
  const installIdPath = resolveInstallIdPath(env);

  try {
    const existing = (await readFile(installIdPath, "utf8")).trim();
    if (existing) {
      return existing;
    }
  } catch {
    // Fall through and create a new anonymous install ID.
  }

  const installId = fallbackId ?? randomUUID();

  try {
    await mkdir(dirname(installIdPath), { recursive: true });
    await writeFile(installIdPath, `${installId}\n`, "utf8");
  } catch {
    // If persistence fails, continue with an in-memory anonymous ID.
  }

  return installId;
}

function resolveInstallIdPath(env: NodeJS.ProcessEnv): string {
  const overriddenPath = env.BROWSERBASE_TELEMETRY_INSTALL_ID_FILE;
  if (overriddenPath) {
    return overriddenPath;
  }

  if (process.platform === "win32") {
    const baseDir =
      env.APPDATA ?? env.LOCALAPPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(baseDir, "Browserbase", "cli", "telemetry-id");
  }

  if (process.platform === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "Browserbase",
      "cli",
      "telemetry-id",
    );
  }

  const baseDir = env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(baseDir, "browserbase", "cli", "telemetry-id");
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
