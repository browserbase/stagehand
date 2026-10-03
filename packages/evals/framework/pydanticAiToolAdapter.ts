import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PydanticAiMcpServerConfig } from "@browserbasehq/stagehand-integrations-pydantic-ai-sdk";
import type { ProbeEvidence } from "stagehand-v3";
import type { StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import { startAgentToolRuntime } from "./agentToolRuntime.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { resolveStartupProfile, resolveToolSurface } from "./harnesses/toolSurfaceResolution.js";
import { ObservationRecorder, type StepObservation } from "./observationRecorder.js";

export interface PydanticAiToolAdapterInput {
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}

export interface PreparedPydanticAiToolAdapter {
  toolSurface: ToolSurface;
  startupProfile: StartupProfile;
  cwd: string;
  env: Record<string, string>;
  promptInstructions: string;
  mcpServers: Record<string, PydanticAiMcpServerConfig>;
  captureEvidence?: () => Promise<ProbeEvidence>;
  drainStepObservations?: () => Promise<StepObservation[]>;
  recordObservation?: () => void;
  observedToolMatcher: (name: string) => boolean;
  cleanup: () => Promise<void>;
}

export const PYDANTIC_AI_TOOL_SURFACES: ToolSurface[] = [
  "stagehand_facade",
  "playwright_mcp",
  "chrome_devtools_mcp",
];

export function normalizePydanticAiMcpServers(
  mcpServers: Record<string, unknown>,
): Record<string, PydanticAiMcpServerConfig> {
  const normalized: Record<string, PydanticAiMcpServerConfig> = {};
  for (const [name, raw] of Object.entries(mcpServers)) {
    if (!isRecord(raw)) throw invalidServer(name, "must be an object");
    if (typeof raw.command !== "string" || !raw.command) {
      throw invalidServer(name, "command must be a non-empty string");
    }
    const args = raw.args ?? [];
    if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
      throw invalidServer(name, "args must be an array of strings");
    }
    if (raw.env !== undefined && !isStringMap(raw.env)) {
      throw invalidServer(name, "env must be a string map");
    }
    if (raw.cwd !== undefined && typeof raw.cwd !== "string") {
      throw invalidServer(name, "cwd must be a string");
    }
    const env = isStringMap(raw.env) ? raw.env : undefined;
    normalized[name] = {
      command: raw.command,
      args: [...args],
      ...(env && { env: { ...env } }),
      ...(typeof raw.cwd === "string" && { cwd: raw.cwd }),
    };
  }
  return normalized;
}

export async function preparePydanticAiToolAdapter(
  input: PydanticAiToolAdapterInput,
): Promise<PreparedPydanticAiToolAdapter> {
  const toolSurface = resolveToolSurface(
    { harness: "pydantic_ai", supportedToolSurfaces: PYDANTIC_AI_TOOL_SURFACES },
    input.toolSurface,
  );
  if (toolSurface === undefined) {
    throw new EvalsError("Pydantic AI harness requires a tool surface.");
  }
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
    if (!mount)
      throw new EvalsError(`Tool surface "${toolSurface}" does not provide an agent mount.`);
    if (mount.via !== "mcp") {
      throw new EvalsError(
        `Pydantic AI does not support agent mounts delivered via "${mount.via}" yet.`,
      );
    }
    const mcpServers = normalizePydanticAiMcpServers(mount.mcpServers);
    const recorder = runtime.running.captureEvidence
      ? new ObservationRecorder(runtime.running.captureEvidence)
      : undefined;
    cwd = await fsp.mkdtemp(
      path.join(os.tmpdir(), `stagehand-evals-pydantic-ai-${toolSurface.replace(/_/g, "-")}-`),
    );
    const capturedCwd = cwd;
    const serverNames = Object.keys(mcpServers);
    let cleanupPromise: Promise<void> | undefined;

    input.logger.log({
      category: "pydantic_ai",
      message: `Initialized ${toolSurface} MCP mount for Pydantic AI (servers: ${serverNames.join(", ")}).`,
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
      promptInstructions: mount.promptInstructions,
      mcpServers,
      ...(runtime.running.captureEvidence && {
        captureEvidence: boundedCaptureEvidence(runtime.running.captureEvidence),
      }),
      ...(recorder && {
        drainStepObservations: async () => {
          await recorder.settle();
          return recorder.drain();
        },
        recordObservation: () => void recorder.record(),
      }),
      observedToolMatcher: (name) => serverNames.some((server) => name.startsWith(`${server}.`)),
      cleanup: async () => {
        cleanupPromise ??= (async () => {
          try {
            await withCaptureTimeout(
              runtime.cleanup(),
              readCapturePositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
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
    await withCaptureTimeout(
      runtime.cleanup(),
      readCapturePositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
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
      return await withCaptureTimeout(
        capture(),
        readCapturePositiveIntEnv("EVAL_CAPTURE_EVIDENCE_TIMEOUT_MS", 15_000),
      );
    } catch {
      return {};
    }
  };
}

function readCapturePositiveIntEnv(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function withCaptureTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`pydantic_ai adapter operation timed out after ${timeoutMs}ms`)),
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

function invalidServer(name: string, message: string): EvalsError {
  return new EvalsError(`Invalid Pydantic AI MCP server "${name}": ${message}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}
