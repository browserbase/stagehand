import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  loadMastraSdk,
  type MastraSdk,
  type MastraStdioServerDefinition,
} from "@browserbasehq/stagehand-integrations-mastra-sdk";
import { sanitizeErrorMessage } from "@browserbasehq/stagehand-integrations/harness";
import { z } from "zod";
import type { ProbeEvidence } from "stagehand-v3";
import {
  AGENT_RUN_TOOL_NAME,
  type StartupProfile,
  type ToolSurface,
} from "../core/contracts/tool.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import { startAgentToolRuntime } from "./agentToolRuntime.js";
import { startCodeBridge } from "./codexCodeBridge.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { resolveStartupProfile, resolveToolSurface } from "./harnesses/toolSurfaceResolution.js";
import { ObservationRecorder, type StepObservation } from "./observationRecorder.js";

export const MASTRA_RUN_TOOL_NAME = "stagehand_browser_run";
export const MASTRA_TOOL_SURFACES: ToolSurface[] = [
  "stagehand_facade",
  "playwright_mcp",
  "chrome_devtools_mcp",
  "stagehand_code",
  "playwright_code",
  "cdp_code",
];

export interface MastraToolAdapterInput {
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
  sdk?: MastraSdk;
  /** Test seam for runtime mounts. */
  startRuntime?: typeof startAgentToolRuntime;
}

export interface PreparedMastraToolAdapter {
  toolSurface: ToolSurface;
  startupProfile: StartupProfile;
  cwd: string;
  promptInstructions: string;
  mcpServers?: Record<string, MastraStdioServerDefinition>;
  tools?: Record<string, unknown>;
  captureEvidence?: () => Promise<ProbeEvidence>;
  drainStepObservations?: () => Promise<StepObservation[]>;
  onToolResult?: (toolName: string) => void;
  observedToolMatcher?: (name: string) => boolean;
  cleanup: () => Promise<void>;
}

export async function prepareMastraToolAdapter(
  input: MastraToolAdapterInput,
): Promise<PreparedMastraToolAdapter> {
  const toolSurface = resolveToolSurface(
    { harness: "mastra", supportedToolSurfaces: MASTRA_TOOL_SURFACES },
    input.toolSurface,
  );
  if (toolSurface === undefined) {
    throw new EvalsError("Mastra harness requires a tool surface.");
  }
  const startupProfile = resolveStartupProfile(
    toolSurface,
    input.environment,
    input.startupProfile,
  );
  const startRuntime = input.startRuntime ?? startAgentToolRuntime;
  let runtime: Awaited<ReturnType<typeof startAgentToolRuntime>> | undefined;
  let cwd: string | undefined;
  let bridge: Awaited<ReturnType<typeof startCodeBridge>> | undefined;

  try {
    runtime = await startRuntime({
      toolSurface,
      startupProfile,
      environment: input.environment,
      logger: input.logger,
    });
    const mount = runtime.running.agentMount;
    if (!mount) {
      throw new EvalsError(`Tool surface "${toolSurface}" does not provide an agent mount.`);
    }
    cwd = await fsp.mkdtemp(
      path.join(os.tmpdir(), `stagehand-evals-mastra-${toolSurface.replaceAll("_", "-")}-`),
    );
    const capturedCwd = cwd;
    const recorder = runtime.running.captureEvidence
      ? new ObservationRecorder(runtime.running.captureEvidence)
      : undefined;
    const evidenceFields = buildEvidenceFields(runtime.running.captureEvidence, recorder);

    if (mount.via === "mcp") {
      const mcpServers = buildMastraMcpServers(mount.mcpServers, cwd);
      const serverNames = Object.keys(mount.mcpServers);
      const matcher = mastraToolNameMatcher(serverNames);
      input.logger.log({
        category: "mastra",
        message: `Initialized ${toolSurface} MCP mount for Mastra (servers: ${serverNames.join(", ")}).`,
        level: 1,
        auxiliary: {
          startupProfile: { value: startupProfile, type: "string" },
          environment: { value: input.environment, type: "string" },
        },
      });
      let cleanupPromise: Promise<void> | undefined;
      return {
        toolSurface,
        startupProfile,
        cwd,
        promptInstructions: mount.promptInstructions,
        mcpServers,
        ...evidenceFields,
        ...(recorder && {
          onToolResult: (name: string) => {
            if (matcher(name)) void recorder.record();
          },
        }),
        observedToolMatcher: matcher,
        cleanup: async () => {
          cleanupPromise ??= cleanupRuntime(runtime.cleanup, capturedCwd);
          await cleanupPromise;
        },
      };
    }

    if (mount.via === "handles") {
      bridge = await startCodeBridge({
        mount,
        plan: input.plan,
        logger: input.logger,
        onRunExecuted: recorder ? () => recorder.record() : undefined,
      });
      const sdk = input.sdk ?? (await loadMastraSdk());
      const tool = sdk.createTool({
        id: MASTRA_RUN_TOOL_NAME,
        description: mount.runTool.description,
        inputSchema: z.object({
          code: z.string().describe(mount.runTool.codeParamDescription),
        }),
        execute: async (toolInput: Record<string, unknown>) =>
          executeViaCodeBridge(bridge!.port, String(toolInput.code)),
      });
      const scopeNames = [...Object.keys(mount.handles), "startUrl", "task", "console"].join(", ");
      const promptInstructions = [
        `Browser automation runs through the \`${MASTRA_RUN_TOOL_NAME}\` tool: pass a JavaScript snippet in \`code\`; it runs inside an async function with ${scopeNames} in scope; use await directly and return a JSON-serializable value.`,
        mount.promptInstructions.replaceAll(AGENT_RUN_TOOL_NAME, MASTRA_RUN_TOOL_NAME),
      ].join("\n");
      const capturedBridge = bridge;
      let cleanupPromise: Promise<void> | undefined;
      return {
        toolSurface,
        startupProfile,
        cwd,
        promptInstructions,
        tools: { [MASTRA_RUN_TOOL_NAME]: tool },
        ...evidenceFields,
        observedToolMatcher: (name) => name === MASTRA_RUN_TOOL_NAME,
        cleanup: async () => {
          cleanupPromise ??= (async () => {
            try {
              await capturedBridge.close();
            } catch {
              // Best-effort teardown continues through the remaining owners.
            }
            await cleanupRuntime(runtime.cleanup, capturedCwd);
          })();
          await cleanupPromise;
        },
      };
    }

    throw new EvalsError(`Mastra does not support agent mounts delivered via "${mount.via}" yet.`);
  } catch (error) {
    await bridge?.close().catch((): undefined => undefined);
    if (runtime) {
      await withCaptureTimeout(
        runtime.cleanup(),
        readCapturePositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
      ).catch((): undefined => undefined);
    }
    if (cwd) await fsp.rm(cwd, { recursive: true, force: true });
    throw new EvalsError(
      `mastra tool adapter setup failed: ${sanitizeErrorMessage(stringifyError(error))}`,
      { cause: error },
    );
  }
}

export function buildMastraMcpServers(
  mcpServers: Record<string, unknown>,
  cwd: string,
): Record<string, MastraStdioServerDefinition> {
  return Object.fromEntries(
    Object.entries(mcpServers).map(([name, raw]) => {
      if (!isRecord(raw) || "url" in raw || typeof raw.command !== "string") {
        throw new EvalsError(
          `Mastra MCP server "${name}" must use a stdio definition with a string command.`,
        );
      }
      const args = raw.args;
      const env = raw.env;
      const definition: MastraStdioServerDefinition = { command: raw.command, cwd };
      if (args !== undefined) {
        if (!isStringArray(args)) {
          throw new EvalsError(`Mastra MCP server "${name}" has invalid args; expected strings.`);
        }
        definition.args = args;
      }
      if (env !== undefined) {
        if (!isStringRecord(env)) {
          throw new EvalsError(
            `Mastra MCP server "${name}" has invalid env; expected string values.`,
          );
        }
        definition.env = env;
      }
      return [name, definition] as const;
    }),
  );
}

export function mastraToolNameMatcher(serverNames: string[]): (name: string) => boolean {
  return (name) => serverNames.some((server) => name.startsWith(`${server}_`));
}

export async function executeViaCodeBridge(
  port: number,
  code: string,
): Promise<{ ok: true; result: string } | { ok: false; error: string }> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const payload: unknown = await response.json();
    if (isRecord(payload) && payload.ok === true) {
      return { ok: true, result: String(payload.result ?? "") };
    }
    return {
      ok: false,
      error: isRecord(payload) && typeof payload.error === "string" ? payload.error : "run failed",
    };
  } catch (error) {
    return { ok: false, error: stringifyError(error) };
  }
}

function buildEvidenceFields(
  captureEvidence: (() => Promise<ProbeEvidence>) | undefined,
  recorder: ObservationRecorder | undefined,
): Pick<PreparedMastraToolAdapter, "captureEvidence" | "drainStepObservations"> {
  return {
    ...(captureEvidence && { captureEvidence: boundedCaptureEvidence(captureEvidence) }),
    ...(recorder && {
      drainStepObservations: async () => {
        await recorder.settle();
        return recorder.drain();
      },
    }),
  };
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

async function cleanupRuntime(cleanup: () => Promise<void>, cwd: string): Promise<void> {
  try {
    await withCaptureTimeout(
      cleanup(),
      readCapturePositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
    );
  } catch {
    // The temporary workspace is still removed when runtime cleanup fails.
  }
  await fsp.rm(cwd, { recursive: true, force: true });
}

function readCapturePositiveIntEnv(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function withCaptureTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`mastra adapter operation timed out after ${timeoutMs}ms`)),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function stringifyError(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
