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

export interface V4CodeBrowserbaseCleanupInput {
  apiKey: string;
  projectId?: string;
  resources: V4CodeBrowserbaseResources;
}

export interface V4CodeBrowserbaseCleanupClient {
  releaseSession(sessionId: string, projectId?: string): Promise<unknown>;
  deleteExtension(extensionId: string): Promise<unknown>;
}

export async function cleanupV4CodeBrowserbaseResources(
  input: V4CodeBrowserbaseCleanupInput,
  createClient: (
    apiKey: string,
  ) => V4CodeBrowserbaseCleanupClient = createBrowserbaseCleanupClient,
): Promise<void> {
  const browserbase = createClient(input.apiKey);
  const errors: unknown[] = [];

  if (input.resources.sessionId) {
    try {
      await browserbase.releaseSession(
        input.resources.sessionId,
        input.projectId,
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
      timeout: 10_000,
    },
  );
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
