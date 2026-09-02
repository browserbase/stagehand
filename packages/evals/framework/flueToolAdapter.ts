import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  defineFlueJsonTool,
  type FlueToolDefinition,
} from "@browserbasehq/stagehand-integrations-flue-sdk";
import type { ProbeEvidence } from "stagehand-v3";
import type { StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import { startAgentToolRuntime } from "./agentToolRuntime.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { resolveStartupProfile, resolveToolSurface } from "./harnesses/toolSurfaceResolution.js";
import { ObservationRecorder, type StepObservation } from "./observationRecorder.js";

export const FLUE_TOOL_SURFACES: ToolSurface[] = [
  "stagehand_facade",
  "playwright_mcp",
  "chrome_devtools_mcp",
];

export interface FlueToolAdapterInput {
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
  connectMcpServer?: (name: string, spec: McpServerSpec) => Promise<ConnectedMcpServer>;
}

export interface PreparedFlueToolAdapter {
  toolSurface: ToolSurface;
  startupProfile: StartupProfile;
  cwd: string;
  tools: FlueToolDefinition[];
  promptInstructions: string;
  captureEvidence?: () => Promise<ProbeEvidence>;
  drainStepObservations?: () => Promise<StepObservation[]>;
  onToolResult?: (toolName: string) => void;
  observedToolMatcher: (toolName: string) => boolean;
  cleanup: () => Promise<void>;
}

export interface McpServerSpec {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface ConnectedMcpServer {
  tools: Array<{ name: string; description?: string }>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export function flueMcpToolName(server: string, tool: string): string {
  const clean = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, "_");
  return `mcp__${clean(server)}__${clean(tool)}`;
}

export async function prepareFlueToolAdapter(
  input: FlueToolAdapterInput,
): Promise<PreparedFlueToolAdapter> {
  const toolSurface = resolveToolSurface(
    { harness: "flue", supportedToolSurfaces: FLUE_TOOL_SURFACES },
    input.toolSurface,
  );
  if (toolSurface === undefined) throw new EvalsError("Flue harness requires a tool surface.");
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
  const connections: ConnectedMcpServer[] = [];
  let cwd: string | undefined;
  try {
    const mount = runtime.running.agentMount;
    if (!mount)
      throw new EvalsError(`Tool surface "${toolSurface}" does not provide an agent mount.`);
    if (mount.via !== "mcp") {
      throw new EvalsError(`Flue does not support agent mounts delivered via "${mount.via}" yet.`);
    }
    cwd = await fsp.mkdtemp(
      path.join(os.tmpdir(), `stagehand-evals-flue-${toolSurface.replace(/_/g, "-")}-`),
    );
    const connect = input.connectMcpServer ?? connectFlueMcpServer;
    const tools: FlueToolDefinition[] = [];
    const mountedNames = new Set<string>();
    for (const [serverName, rawSpec] of Object.entries(mount.mcpServers)) {
      const spec = normalizeMcpSpec(serverName, rawSpec);
      const connection = await connect(serverName, spec);
      connections.push(connection);
      for (const tool of connection.tools) {
        const name = flueMcpToolName(serverName, tool.name);
        mountedNames.add(name);
        tools.push(
          defineFlueJsonTool({
            name,
            description: tool.description ?? `${tool.name} from ${serverName}`,
            execute: (args) => connection.callTool(tool.name, args),
          }),
        );
      }
    }
    if (tools.length === 0) throw new EvalsError("Flue MCP mount exposed no tools.");
    const recorder = runtime.running.captureEvidence
      ? new ObservationRecorder(runtime.running.captureEvidence)
      : undefined;
    const observedToolMatcher = (name: string): boolean => mountedNames.has(name);
    const capturedCwd = cwd;
    let cleanupPromise: Promise<void> | undefined;
    input.logger.log({
      category: "flue",
      message: `Initialized ${toolSurface} MCP mount for Flue (${tools.length} tools).`,
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
      tools,
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
            await Promise.allSettled(connections.map((connection) => connection.close()));
            await withTimeout(
              runtime.cleanup(),
              readPositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
            );
          } catch {
            // Cleanup is best-effort, but the isolated workspace must still be removed.
          } finally {
            await fsp.rm(capturedCwd, { recursive: true, force: true });
          }
        })();
        await cleanupPromise;
      },
    };
  } catch (error) {
    await Promise.allSettled(connections.map((connection) => connection.close()));
    await withTimeout(
      runtime.cleanup(),
      readPositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
    ).catch((): undefined => undefined);
    if (cwd) await fsp.rm(cwd, { recursive: true, force: true });
    throw error;
  }
}

async function connectFlueMcpServer(
  serverName: string,
  spec: McpServerSpec,
): Promise<ConnectedMcpServer> {
  const client = new Client({ name: `stagehand-evals-flue-${serverName}`, version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: spec.command,
    args: spec.args ?? [],
    env: stringEnv({ ...process.env, ...spec.env }),
  });
  try {
    await client.connect(transport);
    const response = await client.listTools();
    return {
      tools: response.tools.map((tool) => ({
        name: tool.name,
        ...(tool.description && { description: tool.description }),
      })),
      callTool: (name, args) => client.callTool({ name, arguments: args }),
      close: () => client.close(),
    };
  } catch (error) {
    await client.close().catch((): undefined => undefined);
    throw error;
  }
}

function normalizeMcpSpec(serverName: string, value: unknown): McpServerSpec {
  if (!isRecord(value) || typeof value.command !== "string") {
    throw new EvalsError(`Flue MCP server "${serverName}" requires a string command.`);
  }
  return {
    command: value.command,
    ...(Array.isArray(value.args) && {
      args: value.args.filter((entry): entry is string => typeof entry === "string"),
    }),
    ...(isStringRecord(value.env) && { env: value.env }),
  };
}

function stringEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
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
      () => reject(new Error(`Flue adapter operation timed out after ${timeoutMs}ms`)),
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
