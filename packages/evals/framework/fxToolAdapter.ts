import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sanitizeErrorMessage } from "@browserbasehq/stagehand-integrations/harness";
import { connectToMCPServer, type ProbeEvidence } from "stagehand-v3";
import type { StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import { startAgentToolRuntime } from "./agentToolRuntime.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { resolveStartupProfile, resolveToolSurface } from "./harnesses/toolSurfaceResolution.js";
import { ObservationRecorder, type StepObservation } from "./observationRecorder.js";

export interface FxToolAdapterInput {
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
  listMcpToolNames?: (
    serverName: string,
    spec: { command: string; args: string[]; env: Record<string, string> },
  ) => Promise<string[]>;
}

export interface PreparedFxToolAdapter {
  toolSurface: ToolSurface;
  startupProfile: StartupProfile;
  cwd: string;
  home: string;
  env: Record<string, string>;
  promptInstructions: string;
  mcpServerNames: string[];
  captureEvidence?: () => Promise<ProbeEvidence>;
  drainStepObservations?: () => Promise<StepObservation[]>;
  recordObservation?: () => void;
  observedToolMatcher?: (name: string) => boolean;
  cleanup: () => Promise<void>;
}

type FxMcpServerSpec = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export const FX_TOOL_SURFACES: ToolSurface[] = [
  "stagehand_facade",
  "playwright_mcp",
  "chrome_devtools_mcp",
];

export const FX_DENIED_TOOLS = [
  "*",
  "run_command",
  "terminal",
  "write_file",
  "edit_file",
  "read_file",
  "list_files",
  "glob_files",
  "grep_files",
  "open_file",
  "file_info",
  "semantic_search",
  "create_folder",
  "install_skill",
  "vision",
  "ask_user_question",
  "read_tool_result",
  "copy_file",
  "delete_file",
  "rename_file",
  "background_command",
  "web_search",
  "web_fetch",
  "skill",
  "subagent",
  "memory",
] as const;

const MCP_CHILD_ENV_KEYS = [
  "PNPM_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
  "npm_config_cache",
  "npm_config_store_dir",
  "npm_config_prefix",
  "NPM_CONFIG_CACHE",
  "NPM_CONFIG_STORE_DIR",
  "COREPACK_HOME",
  "TMPDIR",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const;

type FxMcpOptions = {
  home: string;
  pathEnv: string;
  parentEnv: Record<string, string | undefined>;
};

export function buildFxMcpChildEnv(
  specEnv: Record<string, string>,
  options: FxMcpOptions,
): Record<string, string> {
  const env: Record<string, string> = {
    PATH: options.pathEnv,
    HOME: options.parentEnv.HOME ?? options.home,
  };
  for (const key of MCP_CHILD_ENV_KEYS) {
    const value = options.parentEnv[key];
    if (typeof value === "string") env[key] = value;
  }
  return { ...env, ...specEnv };
}

export function buildFxMcpConfig(
  mcpServers: Record<string, unknown>,
  options: FxMcpOptions & { startupTimeoutMs: number },
): { mcp: Record<string, unknown> } {
  const mcp: Record<string, unknown> = {};
  for (const [serverName, rawSpec] of Object.entries(mcpServers)) {
    if (!/^[A-Za-z0-9_-]+$/u.test(serverName)) {
      throw new EvalsError(`Invalid fx MCP server name "${serverName}".`);
    }
    if (!isRecord(rawSpec) || typeof rawSpec.command !== "string") {
      throw new EvalsError(`Invalid fx MCP launch spec for server "${serverName}".`);
    }
    const spec = rawSpec as FxMcpServerSpec;
    const args = Array.isArray(spec.args)
      ? spec.args.filter((arg): arg is string => typeof arg === "string")
      : [];
    const extraEnv = isStringRecord(spec.env) ? spec.env : {};
    mcp[serverName] = {
      type: "stdio",
      command: [spec.command, ...args],
      environment: buildFxMcpChildEnv(extraEnv, options),
      required: true,
      startup_timeout_ms: options.startupTimeoutMs,
    };
  }
  return { mcp };
}

export function buildFxSettings(mcpToolNames: Record<string, string[]>): {
  permission: Record<string, "allow" | "deny">;
} {
  const permission: Record<string, "allow" | "deny"> = Object.fromEntries(
    FX_DENIED_TOOLS.map((name) => [name, "deny" as const]),
  );
  for (const [serverName, toolNames] of Object.entries(mcpToolNames)) {
    permission[`mcp_${serverName}_*`] = "allow";
    if (serverName.includes("-")) {
      permission[`mcp_${serverName.replace(/-/gu, "_")}_*`] = "allow";
    }
    for (const toolName of toolNames) {
      permission[`mcp_${serverName}_${toolName}`] = "allow";
      if (serverName.includes("-")) {
        permission[`mcp_${serverName.replace(/-/gu, "_")}_${toolName}`] = "allow";
      }
    }
  }
  return {
    permission,
  };
}

export function buildFxAgentsMarkdown(promptInstructions: string, serverNames: string[]): string {
  const prefixes = serverNames.map((server) => `mcp_${server}_<tool>`).join(", ");
  const stagehandGuidance = serverNames.includes("stagehand")
    ? "The Stagehand tools are exactly mcp_stagehand_run, mcp_stagehand_snapshot, and mcp_stagehand_screenshot."
    : undefined;
  return [
    "# Browser tool instructions for fx",
    "",
    `MCP tools use the fx name mcp_<server>_<tool> (configured servers: ${serverNames.join(", ")}; patterns: ${prefixes}).`,
    "Select tools with mcp_select_tool using their exact name. mcp_search_tools may return nothing.",
    "Never invent tool names. Do not use the shell, web search/fetch, or file tools.",
    stagehandGuidance,
    "",
    promptInstructions,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

export async function prepareFxToolAdapter(
  input: FxToolAdapterInput,
): Promise<PreparedFxToolAdapter> {
  const toolSurface = resolveToolSurface(
    { harness: "fx", supportedToolSurfaces: FX_TOOL_SURFACES },
    input.toolSurface,
  );
  if (toolSurface === undefined) {
    throw new EvalsError("fx harness requires a tool surface.");
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
  let root: string | undefined;

  try {
    const mount = runtime.running.agentMount;
    if (!mount) {
      throw new EvalsError(`Tool surface "${toolSurface}" does not provide an agent mount.`);
    }
    if (mount.via !== "mcp") {
      throw new EvalsError(
        `fx does not support agent mounts delivered via "${mount.via}"; it can only host MCP servers.`,
      );
    }

    root = await fsp.mkdtemp(
      path.join(os.tmpdir(), `stagehand-evals-fx-${toolSurface.replace(/_/gu, "-")}-`),
    );
    const home = path.join(root, "home");
    const workspace = path.join(root, "workspace");
    const fxHome = path.join(home, ".fx");
    await Promise.all([
      fsp.mkdir(fxHome, { recursive: true }),
      fsp.mkdir(workspace, { recursive: true }),
    ]);

    const serverNames = Object.keys(mount.mcpServers);
    const pathEnv = process.env.PATH ?? "";
    const mcpOptions: FxMcpOptions = { home, pathEnv, parentEnv: process.env };
    const mcpToolNames: Record<string, string[]> = {};
    if (toolSurface === "stagehand_facade") {
      mcpToolNames.stagehand = ["run", "snapshot", "screenshot"];
    } else {
      const listMcpToolNames = input.listMcpToolNames ?? defaultListMcpToolNames;
      for (const [serverName, rawSpec] of Object.entries(mount.mcpServers)) {
        const spec = normalizeFxMcpServerSpec(serverName, rawSpec);
        const childSpec = {
          command: spec.command,
          args: spec.args,
          env: buildFxMcpChildEnv(spec.env, mcpOptions),
        };
        try {
          const toolNames = await withTimeout(
            listMcpToolNames(serverName, childSpec),
            readPositiveIntEnv("EVAL_FX_MCP_PROBE_TIMEOUT_MS", 60_000),
            "fx MCP tool discovery",
          );
          mcpToolNames[serverName] = toolNames;
          input.logger.log({
            category: "fx",
            message: `Discovered ${toolNames.length} MCP tools for fx server ${serverName}.`,
            level: 1,
          });
        } catch (error) {
          const message = sanitizeErrorMessage(stringifyUnknown(error));
          mcpToolNames[serverName] = [];
          input.logger.warn({
            category: "fx",
            message: `fx MCP tool discovery failed for ${serverName}: ${message}`,
            level: 0,
            auxiliary: { error: { value: message, type: "string" } },
          });
        }
      }
    }
    const agentsMarkdown = buildFxAgentsMarkdown(mount.promptInstructions, serverNames);
    await Promise.all([
      writeJson(
        path.join(fxHome, "mcp.json"),
        buildFxMcpConfig(mount.mcpServers, {
          ...mcpOptions,
          startupTimeoutMs: readPositiveIntEnv("EVAL_FX_MCP_STARTUP_TIMEOUT_MS", 120_000),
        }),
      ),
      writeJson(path.join(fxHome, "settings.json"), buildFxSettings(mcpToolNames)),
      writeJson(path.join(workspace, ".fx.json"), {
        max_agent_steps: readFxMaxAgentSteps(),
        max_tool_result_bytes: 262_144,
      }),
      fsp.writeFile(path.join(workspace, "AGENTS.md"), agentsMarkdown),
    ]);

    const recorder = runtime.running.captureEvidence
      ? new ObservationRecorder(runtime.running.captureEvidence)
      : undefined;
    const capturedRoot = root;
    let cleanupPromise: Promise<void> | undefined;
    input.logger.log({
      category: "fx",
      message: `Initialized ${toolSurface} MCP mount for fx (servers: ${serverNames.join(", ")}).`,
      level: 1,
      auxiliary: {
        startupProfile: { value: startupProfile, type: "string" },
        environment: { value: input.environment, type: "string" },
      },
    });

    return {
      toolSurface,
      startupProfile,
      cwd: workspace,
      home,
      env: definedProcessEnv({ HOME: home }),
      promptInstructions: agentsMarkdown,
      mcpServerNames: serverNames,
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
      observedToolMatcher: (name: string) =>
        serverNames.some(
          (server) =>
            name.startsWith(`mcp_${server}_`) ||
            name.startsWith(`mcp_${server.replace(/-/gu, "_")}_`),
        ),
      cleanup: async () => {
        cleanupPromise ??= (async () => {
          try {
            await cleanupFxRuntime(() => runtime.cleanup(), input.logger);
          } finally {
            await fsp.rm(capturedRoot, { recursive: true, force: true });
          }
        })();
        await cleanupPromise;
      },
    };
  } catch (error) {
    try {
      await cleanupFxRuntime(() => runtime.cleanup(), input.logger);
    } finally {
      if (root) await fsp.rm(root, { recursive: true, force: true });
    }
    throw error;
  }
}

async function defaultListMcpToolNames(
  _serverName: string,
  spec: { command: string; args: string[]; env: Record<string, string> },
): Promise<string[]> {
  const client = await connectToMCPServer(spec);
  try {
    const listed = await client.listTools();
    return listed.tools.map((tool) => tool.name);
  } finally {
    await client.close();
  }
}

function normalizeFxMcpServerSpec(
  serverName: string,
  rawSpec: unknown,
): { command: string; args: string[]; env: Record<string, string> } {
  if (!isRecord(rawSpec) || typeof rawSpec.command !== "string") {
    throw new EvalsError(`Invalid fx MCP launch spec for server "${serverName}".`);
  }
  return {
    command: rawSpec.command,
    args: Array.isArray(rawSpec.args)
      ? rawSpec.args.filter((arg): arg is string => typeof arg === "string")
      : [],
    env: isStringRecord(rawSpec.env) ? rawSpec.env : {},
  };
}

export async function cleanupFxRuntime(
  cleanup: () => Promise<void>,
  logger: EvalLogger,
): Promise<void> {
  try {
    await withTimeout(
      cleanup(),
      readPositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
      "fx adapter cleanup",
    );
  } catch (error) {
    const message = sanitizeErrorMessage(stringifyUnknown(error)).replace(
      /\b((?:apiKey|api_key|token|key)=)[^&\s"']+/giu,
      "$1[redacted]",
    );
    logger.warn({
      category: "fx",
      message: `fx adapter cleanup failed: ${message}`,
      level: 0,
      auxiliary: { error: { value: message, type: "string" } },
    });
  }
}

function stringifyUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function readFxMaxAgentSteps(): number {
  for (const key of ["EVAL_FX_MAX_STEPS", "AGENT_EVAL_MAX_STEPS"]) {
    const parsed = Number.parseInt(process.env[key] ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 60;
}

function boundedCaptureEvidence(
  capture: () => Promise<ProbeEvidence>,
): () => Promise<ProbeEvidence> {
  return async () => {
    try {
      return await withTimeout(
        capture(),
        readPositiveIntEnv("EVAL_CAPTURE_EVIDENCE_TIMEOUT_MS", 15_000),
        "fx evidence capture",
      );
    } catch {
      return {};
    }
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
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

function readPositiveIntEnv(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function definedProcessEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...overrides })) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}
