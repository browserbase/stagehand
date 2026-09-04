import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenCodeSessionConfig } from "@browserbasehq/stagehand-integrations-opencode-sdk";
import type { ProbeEvidence } from "stagehand-v3";
import type { StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import { startAgentToolRuntime } from "./agentToolRuntime.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { resolveStartupProfile, resolveToolSurface } from "./harnesses/toolSurfaceResolution.js";
import { ObservationRecorder, type StepObservation } from "./observationRecorder.js";

export const OPENCODE_TOOL_SURFACES: ToolSurface[] = [
  "stagehand_facade",
  "playwright_mcp",
  "chrome_devtools_mcp",
];

export interface OpenCodeToolAdapterInput {
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}

export interface PreparedOpenCodeToolAdapter {
  toolSurface: ToolSurface;
  startupProfile: StartupProfile;
  cwd: string;
  configRoot: string;
  config: OpenCodeSessionConfig["config"];
  enabledTools: Record<string, boolean>;
  promptInstructions: string;
  captureEvidence?: () => Promise<ProbeEvidence>;
  drainStepObservations?: () => Promise<StepObservation[]>;
  onToolResult?: (toolName: string) => void;
  observedToolMatcher: (toolName: string) => boolean;
  cleanup: () => Promise<void>;
}

type McpServerSpec = { command: string; args?: string[]; env?: Record<string, string> };

export function buildOpenCodeMcpConfig(mcpServers: Record<string, unknown>): {
  mcp: NonNullable<OpenCodeSessionConfig["config"]["mcp"]>;
  tools: Record<string, boolean>;
  permission: Record<string, "allow" | "deny">;
} {
  const mcp: Record<string, unknown> = {};
  const tools: Record<string, boolean> = { "*": false };
  const permission: Record<string, "allow" | "deny"> = { "*": "deny" };
  for (const [serverName, rawSpec] of Object.entries(mcpServers)) {
    if (!isRecord(rawSpec) || typeof rawSpec.command !== "string") {
      throw new EvalsError(`OpenCode MCP server "${serverName}" requires a string command.`);
    }
    const spec = rawSpec as McpServerSpec;
    mcp[serverName] = {
      type: "local",
      enabled: true,
      command: [spec.command, ...(Array.isArray(spec.args) ? spec.args : [])],
      environment: isStringRecord(spec.env) ? spec.env : {},
    };
    tools[`${serverName}_*`] = true;
    permission[`${serverName}_*`] = "allow";
  }
  return {
    mcp: mcp as NonNullable<OpenCodeSessionConfig["config"]["mcp"]>,
    tools,
    permission,
  };
}

export function isOpenCodeMountToolName(serverNames: string[], toolName: string): boolean {
  return serverNames.some(
    (server) =>
      toolName === server ||
      toolName.startsWith(`${server}_`) ||
      toolName.startsWith(`${server}.`) ||
      toolName.startsWith(`mcp__${server}__`),
  );
}

export async function prepareOpenCodeToolAdapter(
  input: OpenCodeToolAdapterInput,
): Promise<PreparedOpenCodeToolAdapter> {
  const toolSurface = resolveToolSurface(
    { harness: "opencode", supportedToolSurfaces: OPENCODE_TOOL_SURFACES },
    input.toolSurface,
  );
  if (toolSurface === undefined) throw new EvalsError("OpenCode harness requires a tool surface.");
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
  let root: string | undefined;
  try {
    const mount = runtime.running.agentMount;
    if (!mount)
      throw new EvalsError(`Tool surface "${toolSurface}" does not provide an agent mount.`);
    if (mount.via !== "mcp") {
      throw new EvalsError(
        `OpenCode does not support agent mounts delivered via "${mount.via}" yet.`,
      );
    }
    root = await fsp.mkdtemp(
      path.join(os.tmpdir(), `stagehand-evals-opencode-${toolSurface.replace(/_/g, "-")}-`),
    );
    const cwd = path.join(root, "workspace");
    const configRoot = path.join(root, "config");
    const mounted = buildOpenCodeMcpConfig(mount.mcpServers);
    const config: OpenCodeSessionConfig["config"] = {
      share: "disabled",
      autoupdate: false,
      mcp: mounted.mcp,
      tools: mounted.tools,
      permission: mounted.permission,
    };
    const serverNames = Object.keys(mount.mcpServers);
    const observedToolMatcher = (name: string): boolean =>
      isOpenCodeMountToolName(serverNames, name);
    const recorder = runtime.running.captureEvidence
      ? new ObservationRecorder(runtime.running.captureEvidence)
      : undefined;
    const capturedRoot = root;
    let cleanupPromise: Promise<void> | undefined;
    input.logger.log({
      category: "opencode",
      message: `Initialized ${toolSurface} MCP mount for OpenCode (servers: ${serverNames.join(", ")}).`,
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
      configRoot,
      config,
      enabledTools: mounted.tools,
      promptInstructions: mount.promptInstructions,
      ...(runtime.running.captureEvidence && {
        captureEvidence: boundedCaptureEvidence(runtime.running.captureEvidence),
      }),
      ...(recorder && {
        drainStepObservations: async () => {
          await recorder.settle();
          return recorder.drain();
        },
        onToolResult: (name: string) => {
          if (observedToolMatcher(name)) void recorder.record();
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
            // Cleanup is best-effort, but the isolated OpenCode directory must still be removed.
          } finally {
            await fsp.rm(capturedRoot, { recursive: true, force: true });
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
    if (root) await fsp.rm(root, { recursive: true, force: true });
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
      () => reject(new Error(`OpenCode adapter operation timed out after ${timeoutMs}ms`)),
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
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}
