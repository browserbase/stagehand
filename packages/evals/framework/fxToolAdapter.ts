import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProbeEvidence } from "stagehand-v3";
import type { StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import { startAgentToolRuntime } from "./agentToolRuntime.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { ObservationRecorder, type StepObservation } from "./observationRecorder.js";

export interface FxToolAdapterInput {
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
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

const FX_MCP_SURFACES = new Set<ToolSurface>([
  "stagehand_facade",
  "playwright_mcp",
  "chrome_devtools_mcp",
]);

export function resolveFxToolSurface(requested?: ToolSurface): ToolSurface {
  if (!requested) return "stagehand_facade";
  if (FX_MCP_SURFACES.has(requested)) return requested;
  throw new EvalsError(
    `fx harness supports --tool stagehand_facade, playwright_mcp, or chrome_devtools_mcp; received "${requested}".`,
  );
}

export function resolveFxStartupProfile(
  toolSurface: ToolSurface,
  environment: "LOCAL" | "BROWSERBASE",
  requested?: StartupProfile,
): StartupProfile {
  if (requested) return requested;
  if (toolSurface === "stagehand_facade") {
    return environment === "BROWSERBASE" ? "tool_create_browserbase" : "tool_launch_local";
  }
  if (toolSurface === "playwright_mcp" || toolSurface === "chrome_devtools_mcp") {
    return environment === "BROWSERBASE"
      ? "runner_provided_browserbase_cdp"
      : "runner_provided_local_cdp";
  }
  throw new EvalsError(
    `No fx startup profile default for tool "${toolSurface}" in ${environment}.`,
  );
}

export function buildFxMcpConfig(
  mcpServers: Record<string, unknown>,
  options: { home: string; pathEnv: string },
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
      environment: { PATH: options.pathEnv, HOME: options.home, ...extraEnv },
      required: true,
    };
  }
  return { mcp };
}

export function buildFxSettings(
  _serverNames: string[],
  toolSurface: ToolSurface,
): { permission: Record<string, "allow" | "deny"> } {
  return {
    permission: {
      run_command: "deny",
      terminal: "deny",
      write_file: "deny",
      edit_file: "deny",
      ...(toolSurface === "stagehand_facade" && {
        mcp_stagehand_run: "allow",
        mcp_stagehand_snapshot: "allow",
        mcp_stagehand_screenshot: "allow",
      }),
    },
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
    "Never invent tool names. Do not use the shell and do not edit files.",
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
  const toolSurface = resolveFxToolSurface(input.toolSurface);
  const startupProfile = resolveFxStartupProfile(
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
    const agentsMarkdown = buildFxAgentsMarkdown(mount.promptInstructions, serverNames);
    await Promise.all([
      writeJson(
        path.join(fxHome, "mcp.json"),
        buildFxMcpConfig(mount.mcpServers, { home, pathEnv }),
      ),
      writeJson(path.join(fxHome, "settings.json"), buildFxSettings(serverNames, toolSurface)),
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
          await withTimeout(
            runtime.cleanup(),
            readPositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
            "fx adapter cleanup",
          ).catch((): undefined => undefined);
          await fsp.rm(capturedRoot, { recursive: true, force: true });
        })();
        await cleanupPromise;
      },
    };
  } catch (error) {
    await withTimeout(
      runtime.cleanup(),
      readPositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
      "fx adapter cleanup",
    ).catch((): undefined => undefined);
    if (root) await fsp.rm(root, { recursive: true, force: true });
    throw error;
  }
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
