import {
  boundedCaptureEvidence,
  normalizeStdioMcpServers,
  readCapturePositiveIntEnv,
  withCaptureTimeout,
} from "./mcpToolAdapterUtils.js";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DeepagentsMcpServerConfig } from "@browserbasehq/stagehand-integrations-deepagents-sdk";
import type { ProbeEvidence } from "stagehand-v3";
import type { BrowserSessionLoss, StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import { startAgentToolRuntime } from "./agentToolRuntime.js";
import type { BrowserSessionInfo } from "./browserSession.js";
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
  "stagehand_facade",
  "stagehand_facade_legacy",
  "playwright_mcp",
  "chrome_devtools_mcp",
];

export function normalizeDeepagentsMcpServers(
  mcpServers: Record<string, unknown>,
): Record<string, DeepagentsMcpServerConfig> {
  return normalizeStdioMcpServers(mcpServers, "Deep Agents");
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
        `Deep Agents does not support agent mounts delivered via "${mount.via}" yet.`,
      );
    }
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
  } catch (error) {
    await withCaptureTimeout(
      runtime.cleanup(),
      readCapturePositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
    ).catch((): undefined => undefined);
    if (cwd) await fsp.rm(cwd, { recursive: true, force: true });
    throw error;
  }
}
