import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DeepagentsMcpServerConfig } from "@browserbasehq/stagehand-integrations-deepagents-sdk";
import type { ProbeEvidence } from "stagehand-v3";
import type { BrowserSessionLoss, StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import { startAgentToolRuntime } from "./agentToolRuntime.js";
import { BROWSE_CLI_MCP_SERVER_NAME, startBrowseCliMcpBridge } from "./browseCliMcpBridge.js";
import type { BrowserSessionInfo } from "./browserSession.js";
import {
  buildBrowseSkillDocument,
  prepareBrowseCliHarnessAdapter,
} from "./claudeCodeToolAdapter.js";
import {
  DEEPAGENTS_RUN_TOOL_NAME,
  DEEPAGENTS_RUN_TOOL_SERVER,
  rewriteRunToolInstructions,
  startDeepagentsCodeBridge,
} from "./deepagentsCodeBridge.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { resolveStartupProfile, resolveToolSurface } from "./harnesses/toolSurfaceResolution.js";
import { ObservationRecorder, type StepObservation } from "./observationRecorder.js";

export interface DeepagentsToolAdapterInput {
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}

export interface PreparedDeepagentsToolAdapter {
  toolSurface: ToolSurface;
  startupProfile: StartupProfile;
  cwd: string;
  env: Record<string, string>;
  promptInstructions: string;
  /** Browser behind the mounted surface, resolved before the agent starts. */
  browserSession: BrowserSessionInfo;
  mcpServers: Record<string, DeepagentsMcpServerConfig>;
  captureEvidence?: () => Promise<ProbeEvidence>;
  /** Set once the mounted browser is gone for the rest of the run. */
  browserSessionLoss?: () => BrowserSessionLoss | undefined;
  drainStepObservations?: () => Promise<StepObservation[]>;
  recordObservation?: () => void;
  observedToolMatcher: (name: string) => boolean;
  cleanup: () => Promise<void>;
}

export const DEEPAGENTS_TOOL_SURFACES: ToolSurface[] = [
  "browse_cli",
  "stagehand_code",
  "stagehand_facade",
  "stagehand_facade_legacy",
  "playwright_mcp",
  "chrome_devtools_mcp",
];

export function normalizeDeepagentsMcpServers(
  mcpServers: Record<string, unknown>,
): Record<string, DeepagentsMcpServerConfig> {
  const normalized: Record<string, DeepagentsMcpServerConfig> = {};
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

export async function prepareDeepagentsToolAdapter(
  input: DeepagentsToolAdapterInput,
): Promise<PreparedDeepagentsToolAdapter> {
  const toolSurface = resolveToolSurface(
    { harness: "deepagents", supportedToolSurfaces: DEEPAGENTS_TOOL_SURFACES },
    input.toolSurface,
  );
  if (toolSurface === undefined) {
    throw new EvalsError("Deep Agents harness requires a tool surface.");
  }
  const startupProfile = resolveStartupProfile(
    toolSurface,
    input.environment,
    input.startupProfile,
  );
  // browse_cli owns its own daemon rather than a CoreTool agent mount, so it
  // never reaches startAgentToolRuntime — same shape as the Claude Code and
  // Codex adapters.
  if (toolSurface === "browse_cli") {
    return prepareDeepagentsBrowseCliAdapter({ ...input, toolSurface, startupProfile });
  }
  const runtime = await startAgentToolRuntime({
    toolSurface,
    startupProfile,
    environment: input.environment,
    logger: input.logger,
  });

  let cwd: string | undefined;
  let bridge: Awaited<ReturnType<typeof startDeepagentsCodeBridge>> | undefined;
  try {
    const mount = runtime.running.agentMount;
    if (!mount)
      throw new EvalsError(`Tool surface "${toolSurface}" does not provide an agent mount.`);
    if (mount.via === "mcp") {
      const mcpServers = normalizeDeepagentsMcpServers(mount.mcpServers);
      const recorder = runtime.running.captureEvidence
        ? new ObservationRecorder(runtime.running.captureEvidence)
        : undefined;
      cwd = await fsp.mkdtemp(
        path.join(os.tmpdir(), `stagehand-evals-deepagents-${toolSurface.replace(/_/g, "-")}-`),
      );
      const capturedCwd = cwd;
      const serverNames = Object.keys(mcpServers);
      let cleanupPromise: Promise<void> | undefined;

      input.logger.log({
        category: "deepagents",
        message: `Initialized ${toolSurface} MCP mount for Deep Agents (servers: ${serverNames.join(", ")}).`,
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
        env: { ...process.env } as Record<string, string>,
        promptInstructions: mount.promptInstructions,
        browserSession: runtime.browserSession,
        mcpServers,
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
    }
    if (mount.via !== "handles") {
      throw new EvalsError(
        `Deep Agents does not support agent mounts delivered via "${mount.via}" yet.`,
      );
    }
    // Handle mounts are live in-process objects, so the snippet has to execute
    // here while the Python runner authors it. Same split codex makes, with the
    // harness run tool on an MCP bridge instead of a workspace client script.
    const recorder = runtime.running.captureEvidence
      ? new ObservationRecorder(runtime.running.captureEvidence)
      : undefined;
    bridge = await startDeepagentsCodeBridge({
      mount,
      plan: input.plan,
      logger: input.logger,
      ...(recorder && { onRunExecuted: () => recorder.record() }),
    });
    cwd = await fsp.mkdtemp(
      path.join(os.tmpdir(), `stagehand-evals-deepagents-${toolSurface.replace(/_/g, "-")}-`),
    );
    const capturedBridge = bridge;
    const capturedCwd = cwd;
    const runToolName = `${DEEPAGENTS_RUN_TOOL_SERVER}.${DEEPAGENTS_RUN_TOOL_NAME}`;
    let cleanupPromise: Promise<void> | undefined;

    input.logger.log({
      category: "deepagents",
      message: `Initialized ${toolSurface} code bridge for Deep Agents (port ${bridge.port}).`,
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
      env: { ...process.env } as Record<string, string>,
      promptInstructions: rewriteRunToolInstructions(mount.promptInstructions),
      browserSession: runtime.browserSession,
      mcpServers: { [DEEPAGENTS_RUN_TOOL_SERVER]: capturedBridge.mcpServerSpec },
      ...(runtime.running.browserSessionLoss && {
        browserSessionLoss: runtime.running.browserSessionLoss,
      }),
      ...(runtime.running.captureEvidence && {
        captureEvidence: boundedCaptureEvidence(runtime.running.captureEvidence),
      }),
      // No recordObservation: unlike an MCP mount, the bridge owns the run tool
      // and probes on execution, so recording from the runner's tool_result
      // stream as well would double-count every step.
      ...(recorder && {
        drainStepObservations: async () => {
          await recorder.settle();
          return recorder.drain();
        },
      }),
      observedToolMatcher: (name) => name === runToolName,
      cleanup: async () => {
        cleanupPromise ??= (async () => {
          try {
            await capturedBridge.close();
          } catch {
            // best-effort only
          }
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
    await bridge?.close().catch((): undefined => undefined);
    await withCaptureTimeout(
      runtime.cleanup(),
      readCapturePositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
    ).catch((): undefined => undefined);
    if (cwd) await fsp.rm(cwd, { recursive: true, force: true });
    throw error;
  }
}

/**
 * browse_cli for Deep Agents.
 *
 * The shell harnesses hand the agent a pinned `browse` wrapper on PATH and let
 * it shell out. The Deep Agents runner is a separate Python process whose only
 * tool channel is stdio MCP, so the same wrapper is fronted by the browse_cli
 * MCP bridge: one `browse` tool, one command per call, same allowlist. The
 * browse skill has no Skill tool to load it here, so it is inlined into the
 * prompt instructions instead.
 */
async function prepareDeepagentsBrowseCliAdapter(
  input: DeepagentsToolAdapterInput & {
    toolSurface: "browse_cli";
    startupProfile: StartupProfile;
  },
): Promise<PreparedDeepagentsToolAdapter> {
  const browse = await prepareBrowseCliHarnessAdapter({
    startupProfile: input.startupProfile,
    environment: input.environment,
    plan: input.plan,
    logger: input.logger,
    logCategory: "deepagents",
  });

  try {
    const bridge = await startBrowseCliMcpBridge({
      wrapperPath: browse.wrapperPath,
      cwd: browse.cwd,
      env: browse.env,
      logger: input.logger,
      logCategory: "deepagents",
    });
    const promptInstructions = [
      buildDeepagentsBrowseCliInstructions(),
      await buildBrowseSkillDocument(DEEPAGENTS_BROWSE_INVOCATION_RULES),
    ].join("\n\n");

    input.logger.log({
      category: "deepagents",
      message: `Initialized browse_cli MCP bridge for Deep Agents on 127.0.0.1:${bridge.port}.`,
      level: 2,
      auxiliary: {
        startupProfile: { value: input.startupProfile, type: "string" },
        environment: { value: input.environment, type: "string" },
      },
    });

    let cleanupPromise: Promise<void> | undefined;
    return {
      toolSurface: browse.toolSurface,
      startupProfile: browse.startupProfile,
      cwd: browse.cwd,
      env: browse.env,
      promptInstructions,
      browserSession: browse.browserSession,
      mcpServers: { [BROWSE_CLI_MCP_SERVER_NAME]: bridge.mcpServerSpec },
      observedToolMatcher: (name) => name.startsWith(`${BROWSE_CLI_MCP_SERVER_NAME}.`),
      cleanup: async () => {
        cleanupPromise ??= (async () => {
          try {
            await bridge.close();
          } finally {
            await browse.cleanup();
          }
        })();
        await cleanupPromise;
      },
    };
  } catch (error) {
    await browse.cleanup().catch((): undefined => undefined);
    throw error;
  }
}

/** Deep Agents reaches the same CLI through one MCP tool instead of a shell. */
const DEEPAGENTS_BROWSE_INVOCATION_RULES = `- Call the \`browse\` tool once per command and put the whole command line in
  its \`command\` field, including the leading \`browse\` (for example
  \`browse open https://example.com\`). There is no shell: shell operators
  (\`|\`, \`&&\`, \`;\`, backticks, \`$()\`, and redirection) are rejected by the
  harness, so chained or piped commands will fail.`;

function buildDeepagentsBrowseCliInstructions(): string {
  return [
    "Browser tool surface: browse_cli.",
    `Drive the browser only through the \`${BROWSE_CLI_MCP_SERVER_NAME}\` MCP tool; it runs one browse CLI command per call against the session pinned to this eval.`,
    "The browse CLI reference follows. Read it before your first command, and prefer batching page work into a single browse command over many small ones.",
    "The benchmark start URL is provided above.",
  ].join("\n");
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
      () => reject(new Error(`deepagents adapter operation timed out after ${timeoutMs}ms`)),
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
  return new EvalsError(`Invalid Deep Agents MCP server "${name}": ${message}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}
