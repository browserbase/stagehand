import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadBrowserbaseSdk } from "../core/runtime/coreDeps.js";
import { getRepoRootDir } from "../runtimePaths.js";
import type { V4CodeBrowserbaseResources } from "./v4CodeConfig.js";

const CLEANUP_API_KEY_ENV = "STAGEHAND_V4_CLEANUP_BROWSERBASE_API_KEY";
const CLEANUP_PROJECT_ID_ENV = "STAGEHAND_V4_CLEANUP_BROWSERBASE_PROJECT_ID";
const CLEANUP_SESSION_ID_ENV = "STAGEHAND_V4_CLEANUP_BROWSERBASE_SESSION_ID";
const CLEANUP_EXTENSION_ID_ENV =
  "STAGEHAND_V4_CLEANUP_BROWSERBASE_EXTENSION_ID";
const DEFAULT_SESSION_CLEANUP_TIMEOUT_MS = 6_000;
const DEFAULT_SESSION_RELEASE_RETRY_AFTER_MS = 1_000;
const DEFAULT_SESSION_STATUS_POLL_INTERVAL_MS = 250;
// Leaves room for TSX startup and extension deletion around the verified poll.
const SYNC_CLEANUP_BRIDGE_TIMEOUT_MS = 15_000;
const TERMINAL_SESSION_STATUSES = new Set(["COMPLETED", "ERROR", "TIMED_OUT"]);

export interface V4CodeBrowserbaseCleanupInput {
  apiKey: string;
  projectId?: string;
  resources: V4CodeBrowserbaseResources;
}

export interface V4CodeBrowserbaseCleanupClient {
  releaseSession(sessionId: string, projectId?: string): Promise<unknown>;
  retrieveSession(sessionId: string): Promise<unknown>;
  deleteExtension(extensionId: string): Promise<unknown>;
}

interface V4CodeBrowserbaseCleanupTiming {
  sessionCleanupTimeoutMs?: number;
  sessionReleaseRetryAfterMs?: number;
  sessionStatusPollIntervalMs?: number;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}

export async function cleanupV4CodeBrowserbaseResources(
  input: V4CodeBrowserbaseCleanupInput,
  createClient: (
    apiKey: string,
  ) => V4CodeBrowserbaseCleanupClient = createBrowserbaseCleanupClient,
  timing: V4CodeBrowserbaseCleanupTiming = {},
): Promise<void> {
  const browserbase = createClient(input.apiKey);
  const errors: unknown[] = [];

  if (input.resources.sessionId) {
    try {
      await releaseAndVerifySession(
        browserbase,
        input.resources.sessionId,
        input.projectId,
        timing,
      );
    } catch (error) {
      if (!isBenignCleanupError(error)) errors.push(error);
    }
  }

  if (input.resources.extensionId) {
    try {
      await browserbase.deleteExtension(input.resources.extensionId);
    } catch (error) {
      if (!isBenignCleanupError(error)) errors.push(error);
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      "Best-effort V4 Browserbase resource cleanup failed.",
    );
  }
}

function createBrowserbaseCleanupClient(
  apiKey: string,
): V4CodeBrowserbaseCleanupClient {
  const Browserbase = loadBrowserbaseSdk();
  const browserbase = new Browserbase({ apiKey });
  return {
    releaseSession: (sessionId, projectId) =>
      browserbase.sessions.update(sessionId, {
        status: "REQUEST_RELEASE",
        ...(projectId && { projectId }),
      }),
    retrieveSession: (sessionId) => browserbase.sessions.retrieve(sessionId),
    deleteExtension: (extensionId) =>
      browserbase.extensions.delete(extensionId, {
        headers: { "Content-Type": null },
      }),
  };
}

export function cleanupV4CodeBrowserbaseResourcesSync(
  input: V4CodeBrowserbaseCleanupInput,
): void {
  if (!input.resources.sessionId && !input.resources.extensionId) return;
  spawnSync(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      resolveV4CodeBrowserbaseCleanupBridgePath(),
    ],
    {
      env: {
        ...process.env,
        [CLEANUP_API_KEY_ENV]: input.apiKey,
        ...(input.projectId && {
          [CLEANUP_PROJECT_ID_ENV]: input.projectId,
        }),
        ...(input.resources.sessionId && {
          [CLEANUP_SESSION_ID_ENV]: input.resources.sessionId,
        }),
        ...(input.resources.extensionId && {
          [CLEANUP_EXTENSION_ID_ENV]: input.resources.extensionId,
        }),
      },
      stdio: "ignore",
      timeout: SYNC_CLEANUP_BRIDGE_TIMEOUT_MS,
    },
  );
}

async function releaseAndVerifySession(
  browserbase: V4CodeBrowserbaseCleanupClient,
  sessionId: string,
  projectId: string | undefined,
  timing: V4CodeBrowserbaseCleanupTiming,
): Promise<void> {
  const timeoutMs =
    timing.sessionCleanupTimeoutMs ?? DEFAULT_SESSION_CLEANUP_TIMEOUT_MS;
  const retryAfterMs =
    timing.sessionReleaseRetryAfterMs ?? DEFAULT_SESSION_RELEASE_RETRY_AFTER_MS;
  const pollIntervalMs =
    timing.sessionStatusPollIntervalMs ??
    DEFAULT_SESSION_STATUS_POLL_INTERVAL_MS;
  const now = timing.now ?? Date.now;
  const sleep = timing.sleep ?? delay;
  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  let retried = false;

  await browserbase.releaseSession(sessionId, projectId);

  while (true) {
    const status = readSessionStatus(
      await browserbase.retrieveSession(sessionId),
    );
    if (status && TERMINAL_SESSION_STATUSES.has(status)) return;

    const currentTime = now();
    if (!retried && currentTime - startedAt >= retryAfterMs) {
      await browserbase.releaseSession(sessionId, projectId);
      retried = true;
      continue;
    }
    if (currentTime >= deadline) {
      throw new Error(
        "Browserbase session did not reach a terminal state after fallback cleanup.",
      );
    }
    await sleep(Math.min(pollIntervalMs, deadline - currentTime));
  }
}

function readSessionStatus(value: unknown): string | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("status" in value) ||
    typeof value.status !== "string"
  ) {
    return undefined;
  }
  return value.status.toUpperCase();
}

function delay(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function readV4CodeBrowserbaseCleanupInputFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): V4CodeBrowserbaseCleanupInput {
  const apiKey = env[CLEANUP_API_KEY_ENV]?.trim();
  if (!apiKey) throw new Error("Missing V4 Browserbase cleanup API key.");
  return {
    apiKey,
    ...(env[CLEANUP_PROJECT_ID_ENV]?.trim() && {
      projectId: env[CLEANUP_PROJECT_ID_ENV]!.trim(),
    }),
    resources: {
      ...(env[CLEANUP_SESSION_ID_ENV]?.trim() && {
        sessionId: env[CLEANUP_SESSION_ID_ENV]!.trim(),
      }),
      ...(env[CLEANUP_EXTENSION_ID_ENV]?.trim() && {
        extensionId: env[CLEANUP_EXTENSION_ID_ENV]!.trim(),
      }),
    },
  };
}

export function resolveV4CodeBrowserbaseCleanupBridgePath(
  repoRoot: string = getRepoRootDir(),
): string {
  const bridgePath = path.join(
    repoRoot,
    "packages",
    "evals",
    "framework",
    "v4CodeBrowserbaseCleanupBridge.ts",
  );
  if (!fs.existsSync(bridgePath) || !fs.statSync(bridgePath).isFile()) {
    throw new Error(`V4 Browserbase cleanup bridge is missing: ${bridgePath}`);
  }
  return bridgePath;
}

function isBenignCleanupError(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const status =
      "status" in error
        ? error.status
        : "statusCode" in error
          ? error.statusCode
          : undefined;
    if (status === 404) return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /not found|already (?:released|deleted)|does not exist/i.test(message);
}
