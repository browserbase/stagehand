import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import {
  AGENT_RUN_TOOL_NAME,
  type StartupProfile,
  type ToolSurface,
} from "../core/contracts/tool.js";
import type { ProbeEvidence } from "stagehand-v3";
import { startAgentToolRuntime } from "./agentToolRuntime.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { buildBridgeClientScript, startCodeBridge } from "./codexCodeBridge.js";
import { ObservationRecorder, type StepObservation } from "./observationRecorder.js";
import {
  prepareBrowseCliHarnessAdapter,
  type PreparedBrowseCliHarnessAdapter,
} from "./claudeCodeToolAdapter.js";
import { resolveStartupProfile, resolveToolSurface } from "./harnesses/toolSurfaceResolution.js";

export interface CodexToolAdapterInput {
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}

/** Code-surface variant: same runner-facing fields as the browse_cli shape. */
export interface PreparedCodexCodeAdapter {
  toolSurface: ToolSurface;
  startupProfile: StartupProfile;
  cwd: string;
  env: Record<string, string>;
  promptInstructions: string;
  /** Extra Codex `--config` overrides (e.g. mcp_servers for MCP mounts). */
  codexConfig?: Record<string, unknown>;
  /** Best-effort evidence from the currently running tool surface. */
  captureEvidence?: () => Promise<ProbeEvidence>;
  drainStepObservations?: () => Promise<StepObservation[]>;
  /**
   * Runner calls this on every completed mcp_tool_call event; MCP mounts use
   * it to record per-step observations (their tool calls never pass through
   * the workspace bridge).
   */
  recordObservation?: () => void;
  /** Which normalized tool-call names consume observation indexes. */
  observedToolMatcher?: (name: string) => boolean;
  cleanup: () => Promise<void>;
}

export type PreparedCodexToolAdapter = PreparedBrowseCliHarnessAdapter | PreparedCodexCodeAdapter;

export const CODEX_TOOL_SURFACES: ToolSurface[] = [
  "browse_cli",
  "playwright_code",
  "cdp_code",
  "stagehand_code",
  "playwright_mcp",
  "chrome_devtools_mcp",
  "stagehand_facade",
];

const STAGEHAND_FACADE_MCP_TIMEOUTS = {
  startup_timeout_sec: 60,
  tool_timeout_sec: 300,
} as const;

export function buildCodexMcpServers(
  toolSurface: ToolSurface,
  mcpServers: Record<string, unknown>,
): Record<string, unknown> {
  if (toolSurface !== "stagehand_facade") return mcpServers;

  return Object.fromEntries(
    Object.entries(mcpServers).map(([name, config]) => [
      name,
      {
        ...(typeof config === "object" && config !== null ? config : {}),
        ...STAGEHAND_FACADE_MCP_TIMEOUTS,
      },
    ]),
  );
}

/** Mirrors the claude adapter's bounded, best-effort terminal capture. */
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
      () => reject(new Error(`codex adapter operation timed out after ${timeoutMs}ms`)),
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

export async function prepareCodexToolAdapter(
  input: CodexToolAdapterInput,
): Promise<PreparedCodexToolAdapter> {
  const toolSurface = resolveToolSurface(
    { harness: "codex", supportedToolSurfaces: CODEX_TOOL_SURFACES },
    input.toolSurface,
  );
  if (toolSurface === undefined) {
    throw new EvalsError("Codex harness requires a tool surface.");
  }
  const startupProfile = resolveStartupProfile(
    toolSurface,
    input.environment,
    input.startupProfile,
  );

  if (toolSurface === "browse_cli") {
    return prepareBrowseCliHarnessAdapter({
      startupProfile,
      environment: input.environment,
      plan: input.plan,
      logger: input.logger,
      logCategory: "codex",
    });
  }

  const runtime = await startAgentToolRuntime({
    toolSurface,
    startupProfile,
    environment: input.environment,
    logger: input.logger,
  });

  let cwd: string | undefined;
  let bridge: Awaited<ReturnType<typeof startCodeBridge>> | undefined;
  try {
    const mount = runtime.running.agentMount;
    if (!mount) {
      throw new EvalsError(`Tool surface "${toolSurface}" does not provide an agent mount.`);
    }
    if (mount.via === "mcp") {
      // MCP mounts skip the workspace bridge entirely: the agent gets its own
      // server instance via Codex mcp_servers config, and per-step
      // observations are triggered from the runner's mcp_tool_call events.
      const recorder = runtime.running.captureEvidence
        ? new ObservationRecorder(runtime.running.captureEvidence)
        : undefined;
      cwd = await fsp.mkdtemp(
        path.join(os.tmpdir(), `stagehand-evals-codex-${toolSurface.replace(/_/g, "-")}-`),
      );
      const capturedCwd = cwd;
      const serverNames = Object.keys(mount.mcpServers);
      const codexMcpServers = buildCodexMcpServers(toolSurface, mount.mcpServers);

      input.logger.log({
        category: "codex",
        message: `Initialized ${toolSurface} MCP mount for Codex (servers: ${serverNames.join(", ")}).`,
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
        codexConfig: { mcp_servers: codexMcpServers },
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
          serverNames.some((server) => name.startsWith(`${server}.`)),
        cleanup: async () => {
          try {
            await runtime.cleanup();
          } catch {
            // best-effort only
          }
          await fsp.rm(capturedCwd, { recursive: true, force: true });
        },
      };
    }
    if (mount.via !== "handles") {
      throw new EvalsError(`Codex does not support agent mounts delivered via "${mount.via}" yet.`);
    }
    const recorder = runtime.running.captureEvidence
      ? new ObservationRecorder(runtime.running.captureEvidence)
      : undefined;
    bridge = await startCodeBridge({
      mount,
      plan: input.plan,
      logger: input.logger,
      onRunExecuted: recorder ? () => recorder.record() : undefined,
    });
    cwd = await fsp.mkdtemp(
      path.join(os.tmpdir(), `stagehand-evals-codex-${toolSurface.replace(/_/g, "-")}-`),
    );
    await fsp.writeFile(path.join(cwd, "browser_run.mjs"), buildBridgeClientScript(bridge.port));

    input.logger.log({
      category: "codex",
      message: `Initialized ${toolSurface} bridge runtime for Codex (port ${bridge.port}).`,
      level: 1,
      auxiliary: {
        startupProfile: { value: startupProfile, type: "string" },
        environment: { value: input.environment, type: "string" },
      },
    });

    const capturedBridge = bridge;
    const capturedCwd = cwd;
    return {
      toolSurface,
      startupProfile,
      cwd,
      env: { ...process.env } as Record<string, string>,
      promptInstructions: buildCodexCodePromptInstructions(mount, toolSurface),
      ...(runtime.running.captureEvidence && {
        captureEvidence: boundedCaptureEvidence(runtime.running.captureEvidence),
      }),
      ...(recorder && {
        drainStepObservations: async () => {
          await recorder.settle();
          return recorder.drain();
        },
      }),
      cleanup: async () => {
        try {
          await capturedBridge.close();
        } catch {
          // best-effort only
        }
        try {
          await runtime.cleanup();
        } catch {
          // best-effort only
        }
        await fsp.rm(capturedCwd, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await bridge?.close().catch((): undefined => undefined);
    // Same bound as normal teardown — a hung cleanup must not wedge the row
    // on the setup-failure path either.
    await withCaptureTimeout(
      runtime.cleanup(),
      readCapturePositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
    ).catch((): undefined => undefined);
    if (cwd) await fsp.rm(cwd, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Codex has no MCP run tool — snippets go through the workspace bridge
 * client. Reuse the surface's own API guidance, rewriting the claude-style
 * run-tool reference to the codex invocation.
 */
function buildCodexCodePromptInstructions(
  mount: { promptInstructions: string; handles: Record<string, unknown> },
  toolSurface: ToolSurface,
): string {
  const scopeNames = [...Object.keys(mount.handles), "startUrl", "task", "console"].join(", ");
  const surfaceGuidance = mount.promptInstructions.replaceAll(
    AGENT_RUN_TOOL_NAME,
    "browser_run.mjs",
  );
  return [
    `Browser automation for this task runs through a snippet bridge, not a browser you launch.`,
    `Write a JavaScript snippet to a file (e.g. snippet.js), then execute it with: node browser_run.mjs snippet.js`,
    `The snippet runs inside an async function with ${scopeNames} in scope. Use await directly; return a JSON-serializable value to inspect it.`,
    `Never launch your own browser process; browser_run.mjs is the only browser access.`,
    surfaceGuidance,
    `Surface: ${toolSurface}.`,
  ].join("\n");
}
