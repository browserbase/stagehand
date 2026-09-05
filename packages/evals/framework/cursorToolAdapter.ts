import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProbeEvidence } from "stagehand-v3";
import type { StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import { startAgentToolRuntime } from "./agentToolRuntime.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { resolveStartupProfile, resolveToolSurface } from "./harnesses/toolSurfaceResolution.js";
import { ObservationRecorder, type StepObservation } from "./observationRecorder.js";

export interface CursorToolAdapterInput {
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}

export interface PreparedCursorToolAdapter {
  toolSurface: ToolSurface;
  startupProfile: StartupProfile;
  cwd: string;
  env: Record<string, string>;
  mcpConfigPath: string;
  mcpServerNames: string[];
  promptInstructions: string;
  captureEvidence?: () => Promise<ProbeEvidence>;
  drainStepObservations?: () => Promise<StepObservation[]>;
  onToolResult?: (toolName: string) => void;
  observedToolMatcher?: (name: string) => boolean;
  cleanup: () => Promise<void>;
}

export const CURSOR_TOOL_SURFACES: ToolSurface[] = [
  "stagehand_facade",
  "playwright_mcp",
  "chrome_devtools_mcp",
];

export function buildCursorMcpConfig(mcpServers: Record<string, unknown>): {
  mcpServers: Record<string, unknown>;
} {
  return { mcpServers };
}

export async function writeCursorWorkspace(
  cwd: string,
  mcpServers: Record<string, unknown>,
): Promise<{ mcpConfigPath: string }> {
  const configDir = path.join(cwd, ".cursor");
  const mcpConfigPath = path.join(configDir, "mcp.json");
  await fsp.mkdir(configDir, { recursive: true });
  await fsp.writeFile(
    mcpConfigPath,
    `${JSON.stringify(buildCursorMcpConfig(mcpServers), null, 2)}\n`,
    { mode: 0o600 },
  );
  return { mcpConfigPath };
}

export function isCursorMountToolName(serverNames: string[], toolName: string): boolean {
  return serverNames.some(
    (server) =>
      toolName === server ||
      toolName.startsWith(`${server}.`) ||
      toolName.startsWith(`${server}__`) ||
      toolName === `mcp__${server}` ||
      toolName.startsWith(`mcp__${server}__`) ||
      toolName.startsWith(`${server}:`),
  );
}

export async function prepareCursorToolAdapter(
  input: CursorToolAdapterInput,
): Promise<PreparedCursorToolAdapter> {
  const toolSurface = resolveToolSurface(
    { harness: "cursor", supportedToolSurfaces: CURSOR_TOOL_SURFACES },
    input.toolSurface,
  );
  if (toolSurface === undefined) throw new EvalsError("cursor harness requires a tool surface.");
  const startupProfile = resolveStartupProfile(
    toolSurface,
    input.environment,
    input.startupProfile,
  );
  const runtime = await startAgentToolRuntime({
    toolSurface,
    startupProfile,
    environment: input.environment,
    logger: input.logger,
  });

  let cwd: string | undefined;
  try {
    const mount = runtime.running.agentMount;
    if (!mount) {
      throw new EvalsError(`Tool surface "${toolSurface}" does not provide an agent mount.`);
    }
    if (mount.via !== "mcp") {
      throw new EvalsError(
        `Cursor does not support agent mounts delivered via "${mount.via}" yet.`,
      );
    }

    cwd = await fsp.mkdtemp(
      path.join(os.tmpdir(), `stagehand-evals-cursor-${toolSurface.replace(/_/g, "-")}-`),
    );
    const capturedCwd = cwd;
    const { mcpConfigPath } = await writeCursorWorkspace(cwd, mount.mcpServers);
    const mcpServerNames = Object.keys(mount.mcpServers);
    const recorder = runtime.running.captureEvidence
      ? new ObservationRecorder(runtime.running.captureEvidence)
      : undefined;
    const observedToolMatcher = (name: string): boolean =>
      isCursorMountToolName(mcpServerNames, name);
    let cleanupPromise: Promise<void> | undefined;

    input.logger.log({
      category: "cursor",
      message: `Initialized ${toolSurface} MCP mount for Cursor (servers: ${mcpServerNames.join(", ")}).`,
      level: 1,
      auxiliary: {
        startupProfile: { value: startupProfile, type: "string" },
        environment: { value: input.environment, type: "string" },
      },
    });

    return {
      toolSurface,
      startupProfile,
      cwd,
      env: { ...process.env } as Record<string, string>,
      mcpConfigPath,
      mcpServerNames,
      promptInstructions: mount.promptInstructions,
      ...(runtime.running.captureEvidence && {
        captureEvidence: boundedCaptureEvidence(runtime.running.captureEvidence),
      }),
      ...(recorder && {
        drainStepObservations: async () => {
          await recorder.settle();
          return recorder.drain();
        },
        onToolResult: (toolName: string) => {
          if (observedToolMatcher(toolName)) void recorder.record();
        },
      }),
      observedToolMatcher,
      cleanup: async () => {
        cleanupPromise ??= (async () => {
          try {
            await withTimeout(
              runtime.cleanup(),
              readPositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
            );
          } catch {
            // best-effort only
          } finally {
            await fsp.rm(capturedCwd, { recursive: true, force: true });
          }
        })();
        await cleanupPromise;
      },
    };
  } catch (error) {
    await withTimeout(
      runtime.cleanup(),
      readPositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
    ).catch((): undefined => undefined);
    if (cwd) await fsp.rm(cwd, { recursive: true, force: true });
    throw error;
  }
}

function boundedCaptureEvidence(
  capture: () => Promise<ProbeEvidence>,
): () => Promise<ProbeEvidence> {
  return async () => {
    try {
      return await withTimeout(
        capture(),
        readPositiveIntEnv("EVAL_CAPTURE_EVIDENCE_TIMEOUT_MS", 15_000),
      );
    } catch {
      return {};
    }
  };
}

function readPositiveIntEnv(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`cursor adapter operation timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
