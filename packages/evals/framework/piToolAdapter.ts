import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  definePiCodeRunTool,
  isPiMcpToolName,
  type PiMcpServerSpec,
  type PiToolDefinition,
} from "@browserbasehq/stagehand-integrations-pi-sdk";
import type { ProbeEvidence } from "stagehand-v3";
import {
  AGENT_RUN_TOOL_NAME,
  type AgentMount,
  type AgentRunToolSpec,
  type StartupProfile,
  type ToolSurface,
} from "../core/contracts/tool.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import { startAgentToolRuntime } from "./agentToolRuntime.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { resolveStartupProfile, resolveToolSurface } from "./harnesses/toolSurfaceResolution.js";
import { ObservationRecorder, type StepObservation } from "./observationRecorder.js";

export const PI_TOOL_SURFACES: ToolSurface[] = [
  "stagehand_facade",
  "playwright_mcp",
  "chrome_devtools_mcp",
  "stagehand_code",
  "playwright_code",
  "cdp_code",
];

export interface PiToolAdapterInput {
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}

export interface PreparedPiToolAdapter {
  toolSurface: ToolSurface;
  startupProfile: StartupProfile;
  cwd: string;
  env: Record<string, string>;
  promptInstructions: string;
  /** via:"mcp" mounts — bridged in-process by pi-sdk. */
  mcpServers?: Record<string, PiMcpServerSpec>;
  /** via:"handles" mounts — the harness run tool hosted in-process by pi. */
  customTools?: PiToolDefinition[];
  captureEvidence?: () => Promise<ProbeEvidence>;
  drainStepObservations?: () => Promise<StepObservation[]>;
  onToolResult?: (toolName: string) => void;
  observedToolMatcher?: (toolName: string) => boolean;
  cleanup: () => Promise<void>;
}

export function buildPiMountConfig(input: {
  mount: AgentMount;
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
  recordObservation?: () => void | Promise<void>;
}): {
  mcpServers?: Record<string, PiMcpServerSpec>;
  customTools?: PiToolDefinition[];
  observedToolMatcher: (name: string) => boolean;
  promptInstructions: string;
} {
  const { mount } = input;
  if (mount.via === "mcp") {
    const mcpServers: Record<string, PiMcpServerSpec> = {};
    for (const [name, value] of Object.entries(mount.mcpServers)) {
      if (!isRecord(value) || typeof value.command !== "string") {
        throw new EvalsError(`pi MCP server "${name}" requires a string command.`);
      }
      mcpServers[name] = value as PiMcpServerSpec;
    }
    const serverNames = Object.keys(mcpServers);
    return {
      mcpServers,
      observedToolMatcher: (name) => serverNames.some((server) => isPiMcpToolName(name, server)),
      promptInstructions: mount.promptInstructions,
    };
  }

  if (mount.via === "handles") {
    const tool = definePiCodeRunTool({
      name: AGENT_RUN_TOOL_NAME,
      label: "Browser run",
      description: mount.runTool.description,
      codeParamDescription: mount.runTool.codeParamDescription,
      execute: async (code, signal) => {
        if (signal?.aborted) {
          throw new Error(`run tool aborted before start: ${abortReason(signal)}`);
        }
        const snippet = executeCodeExposureSnippet({
          code,
          handles: mount.handles,
          runToolSpec: mount.runTool,
          plan: input.plan,
          logger: input.logger,
        });
        try {
          const result = await withTimeout(
            snippet,
            readPositiveIntEnv("EVAL_PI_RUN_TOOL_TIMEOUT_MS", 60_000),
            signal,
            (reason) => {
              snippet.catch(() => {
                input.logger.log({
                  category: "pi",
                  message: `orphaned run tool snippet rejected after ${reason}`,
                  level: 1,
                });
              });
            },
          );
          const text = stringifyToolResult(result);
          input.logger.log({
            category: "pi",
            message: `run tool completed: ${clip(text, 500)}`,
            level: 1,
          });
          await input.recordObservation?.();
          return text;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          input.logger.warn({ category: "pi", message: `run tool failed: ${message}`, level: 1 });
          throw error;
        }
      },
    });
    return {
      customTools: [tool],
      observedToolMatcher: (name) => name === AGENT_RUN_TOOL_NAME,
      promptInstructions: mount.promptInstructions,
    };
  }

  throw new EvalsError(`pi does not support agent mounts delivered via "${mount.via}" yet.`);
}

export async function preparePiToolAdapter(
  input: PiToolAdapterInput,
): Promise<PreparedPiToolAdapter> {
  const toolSurface = resolveToolSurface(
    { harness: "pi", supportedToolSurfaces: PI_TOOL_SURFACES },
    input.toolSurface,
  );
  if (toolSurface === undefined) throw new EvalsError("pi harness requires a tool surface.");
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
    const recorder = runtime.running.captureEvidence
      ? new ObservationRecorder(runtime.running.captureEvidence)
      : undefined;
    cwd = await fsp.mkdtemp(
      path.join(os.tmpdir(), `stagehand-evals-pi-${toolSurface.replace(/_/g, "-")}-`),
    );
    const config = buildPiMountConfig({
      mount,
      plan: input.plan,
      logger: input.logger,
      ...(recorder && { recordObservation: () => recorder.record() }),
    });
    const capturedCwd = cwd;
    let cleanupPromise: Promise<void> | undefined;
    input.logger.log({
      category: "pi",
      message: `Initialized ${toolSurface} ${mount.via} mount for pi.`,
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
      promptInstructions: config.promptInstructions,
      ...(config.mcpServers && { mcpServers: config.mcpServers }),
      ...(config.customTools && { customTools: config.customTools }),
      ...(runtime.running.captureEvidence && {
        captureEvidence: boundedCaptureEvidence(runtime.running.captureEvidence),
      }),
      ...(recorder && {
        drainStepObservations: async () => {
          await recorder.settle();
          return recorder.drain();
        },
      }),
      ...(mount.via === "mcp" &&
        recorder && {
          onToolResult: (name: string) => {
            if (config.observedToolMatcher(name)) void recorder.record();
          },
        }),
      observedToolMatcher: config.observedToolMatcher,
      cleanup: async () => {
        cleanupPromise ??= (async () => {
          try {
            await withTimeout(
              runtime.cleanup(),
              readPositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
            );
          } catch {
            // Cleanup is best-effort, but temp-dir cleanup must run.
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

// Duplicated from claudeCodeToolAdapter.ts (private there); consolidate when a third harness needs it.
async function executeCodeExposureSnippet(input: {
  code: string;
  handles: Record<string, unknown>;
  runToolSpec: AgentRunToolSpec;
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}): Promise<unknown> {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<unknown>;
  const fn = new AsyncFunction(
    ...Object.keys(input.handles),
    "startUrl",
    "task",
    "console",
    input.code,
  );
  return fn(
    ...Object.values(input.handles),
    input.plan.startUrl,
    {
      dataset: input.plan.dataset,
      id: input.plan.taskId,
      startUrl: input.plan.startUrl,
      instruction: input.plan.instruction,
    },
    buildRunToolConsole(input.logger),
  );
}

function buildRunToolConsole(logger: EvalLogger): Pick<Console, "log" | "warn" | "error"> {
  const write = (level: "log" | "warn" | "error", values: unknown[]) => {
    logger.log({
      category: "pi",
      message: `run console.${level}: ${values.map(stringifyToolResult).join(" ")}`,
      level: 1,
    });
  };
  return {
    log: (...values: unknown[]) => write("log", values),
    warn: (...values: unknown[]) => write("warn", values),
    error: (...values: unknown[]) => write("error", values),
  };
}

function readPositiveIntEnv(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
  onAbandoned?: (reason: "abort" | "timeout") => void,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          onAbandoned?.("timeout");
          reject(new Error(`pi adapter operation timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
      ...(signal
        ? [
            new Promise<never>((_, reject) => {
              onAbort = () => {
                onAbandoned?.("abort");
                reject(new Error(`run tool aborted: ${abortReason(signal)}`));
              };
              signal.addEventListener("abort", onAbort, { once: true });
            }),
          ]
        : []),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function abortReason(signal: AbortSignal): string {
  if (signal.reason instanceof Error) return signal.reason.message;
  return signal.reason === undefined ? "aborted" : String(signal.reason);
}

function stringifyToolResult(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function clip(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
