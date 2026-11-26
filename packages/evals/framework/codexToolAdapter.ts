import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isolatedCodexEnv } from "@browserbasehq/stagehand-integrations-codex";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import {
  AGENT_RUN_TOOL_NAME,
  type BrowserSessionLoss,
  type StartupProfile,
  type ToolSurface,
} from "../core/contracts/tool.js";
import type { ProbeEvidence } from "stagehand-v3";
import { startAgentToolRuntime } from "./agentToolRuntime.js";
import type { BrowserSessionInfo } from "./browserSession.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { buildBridgeClientScript, startCodeBridge } from "./codexCodeBridge.js";
import { validateCodexReasoningEffort } from "./codexRunner.js";
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

export interface PreparedCodexCodeAdapter {
  toolSurface: ToolSurface;
  startupProfile: StartupProfile;
  cwd: string;
  env: Record<string, string>;
  promptInstructions: string;
  browserSession: BrowserSessionInfo;
  codexConfig?: Record<string, unknown>;
  captureEvidence?: () => Promise<ProbeEvidence>;
  browserSessionLoss?: () => BrowserSessionLoss | undefined;
  drainStepObservations?: () => Promise<StepObservation[]>;
  recordObservation?: (item: Record<string, unknown>) => Promise<void>;
  allowedMcpServers?: string[];
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
  "stagehand_facade_legacy",
];

const STAGEHAND_FACADE_MCP_TIMEOUTS = {
  startup_timeout_sec: 60,
  tool_timeout_sec: 300,
} as const;

/**
 * Codex treats MCP tools without a `readOnlyHint` annotation as needing
 * approval under the read-only sandbox. Headless runs have no reviewer, so the
 * request is dropped and the call fails as "user cancelled MCP tool call"
 * (verified against codex 0.147). The runner owns every mounted server, so
 * pre-approving its tools is safe and keeps the filesystem sandbox read-only.
 */
export const CODEX_MCP_TOOLS_APPROVAL_MODE = "approve";

export const CODEX_HOME_DIRNAME = path.join("home", ".codex");

export function buildCodexMcpServers(
  toolSurface: ToolSurface,
  mcpServers: Record<string, unknown>,
): Record<string, unknown> {
  const facade = toolSurface === "stagehand_facade" || toolSurface === "stagehand_facade_legacy";
  return Object.fromEntries(
    Object.entries(mcpServers).map(([name, config]) => [
      name,
      {
        ...(typeof config === "object" && config !== null ? config : {}),
        default_tools_approval_mode: CODEX_MCP_TOOLS_APPROVAL_MODE,
        ...(facade && STAGEHAND_FACADE_MCP_TIMEOUTS),
      },
    ]),
  );
}

async function createIsolatedCodexEnvironment(cwd: string): Promise<Record<string, string>> {
  const env = await isolatedCodexEnv(cwd);
  await fsp.writeFile(
    path.join(env.CODEX_HOME, "config.toml"),
    "# Per-run Codex home created by stagehand-evals; intentionally empty.\n",
  );
  return env;
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
  validateCodexReasoningEffort(process.env.EVAL_CODEX_REASONING_EFFORT);
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
      const recorder = runtime.running.captureEvidence
        ? new ObservationRecorder(runtime.running.captureEvidence)
        : undefined;
      cwd = await fsp.mkdtemp(
        path.join(os.tmpdir(), `stagehand-evals-codex-${toolSurface.replace(/_/g, "-")}-`),
      );
      const capturedCwd = cwd;
      const env = await createIsolatedCodexEnvironment(cwd);
      const serverNames = Object.keys(mount.mcpServers);
      const codexMcpServers = buildCodexMcpServers(toolSurface, mount.mcpServers);

      input.logger.log({
        category: "codex",
        message: `Initialized ${toolSurface} MCP mount for Codex (servers: ${serverNames.join(", ")}).`,
        level: 2,
        auxiliary: {
          startupProfile: { value: startupProfile, type: "string" },
          environment: { value: input.environment, type: "string" },
        },
      });

      return {
        toolSurface,
        startupProfile,
        cwd,
        env,
        promptInstructions: mount.promptInstructions,
        browserSession: runtime.browserSession,
        codexConfig: { mcp_servers: codexMcpServers },
        allowedMcpServers: serverNames,
        ...(runtime.running.browserSessionLoss && {
          browserSessionLoss: runtime.running.browserSessionLoss,
        }),
        ...(runtime.running.captureEvidence && {
          captureEvidence: boundedCaptureEvidence(runtime.running.captureEvidence),
        }),
        ...(recorder && {
          drainStepObservations: async () => {
            await recorder.settle();
            return recorder.drain();
          },
          recordObservation: async (item: Record<string, unknown>) => {
            if (serverNames.includes(String(item.server))) {
              await recorder.record(typeof item.id === "string" ? item.id : undefined);
            }
          },
        }),
        observedToolMatcher: (name: string) =>
          serverNames.some((server) => name.startsWith(`${server}.`)),
        cleanup: async () => {
          try {
            await runtime.cleanup();
          } catch {}
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
    await fsp.writeFile(
      path.join(cwd, "browser_run.mjs"),
      buildBridgeClientScript(bridge.port, bridge.token),
    );
    const env = await createIsolatedCodexEnvironment(cwd);

    input.logger.log({
      category: "codex",
      message: `Initialized ${toolSurface} bridge runtime for Codex (port ${bridge.port}).`,
      level: 2,
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
      env,
      promptInstructions: buildCodexCodePromptInstructions(mount, toolSurface),
      browserSession: runtime.browserSession,
      ...(runtime.running.browserSessionLoss && {
        browserSessionLoss: runtime.running.browserSessionLoss,
      }),
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
        } catch {}
        try {
          await runtime.cleanup();
        } catch {}
        await fsp.rm(capturedCwd, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await bridge?.close().catch((): undefined => undefined);
    await withCaptureTimeout(
      runtime.cleanup(),
      readCapturePositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
    ).catch((): undefined => undefined);
    if (cwd) await fsp.rm(cwd, { recursive: true, force: true });
    throw error;
  }
}

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
