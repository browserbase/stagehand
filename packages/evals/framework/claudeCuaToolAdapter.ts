import {
  isBrowserToolsetMember,
  StagehandCuaExecutor,
  type CuaToolExecutor,
} from "@browserbasehq/stagehand-integrations-claude-cua-sdk";
import type { ProbeEvidence } from "stagehand-v3";
import type { BrowserSessionLoss, StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import { bridgeCuaFacadeTools, captureCuaEvidence, cuaCleanup } from "./cuaToolAdapter.js";
export { bridgeCuaFacadeTools } from "./cuaToolAdapter.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import { startAgentToolRuntime } from "./agentToolRuntime.js";
import type { BrowserSessionInfo } from "./browserSession.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { harnessObservationsEnabled } from "./observationRecorder.js";
import { resolveStartupProfile, resolveToolSurface } from "./harnesses/toolSurfaceResolution.js";

/**
 * The only surface claude_cua mounts. The agent sees Anthropic's Browser Use
 * toolset; the SDK executor runs each member against the facade browser, here
 * reached through the runner-owned bridge instead of an in-process Stagehand.
 */
export const CLAUDE_CUA_TOOL_INSTRUCTIONS =
  "Browser tool surface: Anthropic Browser Use.\nUse the Browser Use toolset members to control the existing browser. Open URLs with navigate, inspect the page with read_page or find, and act with the supplied browser member names. References returned by read_page and find can be used in ref targets; read the page again when a reference becomes stale. Use screenshot when visual state matters. Use the member schemas for their exact arguments.";

export const CLAUDE_CUA_TOOL_SURFACES: ToolSurface[] = ["anthropic_browser_toolset"];

export interface ClaudeCuaToolAdapterInput {
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}

export interface PreparedClaudeCuaToolAdapter {
  toolSurface: ToolSurface;
  startupProfile: StartupProfile;
  promptInstructions: string;
  browserSession: BrowserSessionInfo;
  executor: CuaToolExecutor;
  captureEvidence?: () => Promise<ProbeEvidence>;
  browserSessionLoss?: () => BrowserSessionLoss | undefined;
  /** Every toolset member counts as a browser-surface call. */
  observedToolMatcher: (toolName: string) => boolean;
  /** Page state observed after each mutating member, keyed by tool_use id. */
  drainObservationsByToolUse: () => Map<string, ProbeEvidence>;
  cleanup: () => Promise<void>;
}

export async function prepareClaudeCuaToolAdapter(
  input: ClaudeCuaToolAdapterInput,
): Promise<PreparedClaudeCuaToolAdapter> {
  const toolSurface = resolveToolSurface(
    { harness: "claude_cua", supportedToolSurfaces: CLAUDE_CUA_TOOL_SURFACES },
    input.toolSurface,
  );
  if (toolSurface === undefined)
    throw new EvalsError("claude_cua harness requires a tool surface.");
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
  const cleanup = cuaCleanup(runtime.cleanup);
  try {
    const callTool = runtime.running.callTool;
    const mount = runtime.running.agentMount;
    if (!callTool || !mount) {
      throw new EvalsError(`Tool surface "${toolSurface}" does not expose runner-side tool calls.`);
    }
    const observations = new Map<string, ProbeEvidence>();
    const executor = new StagehandCuaExecutor({
      tools: bridgeCuaFacadeTools(
        callTool,
        readPositiveIntEnv("EVAL_CLAUDE_CUA_TOOL_TIMEOUT_MS", 90_000),
      ),
      logger: input.logger,
      ...(harnessObservationsEnabled() && {
        onMutation: async (toolUseId: string) => {
          const evidence = await captureCuaEvidence(callTool);
          if (evidence.screenshot || evidence.url) observations.set(toolUseId, evidence);
        },
      }),
    });
    input.logger.log({
      category: "claude_cua",
      message: `Initialized ${toolSurface} on the facade browser for claude_cua.`,
      level: 2,
      auxiliary: {
        startupProfile: { value: startupProfile, type: "string" },
        environment: { value: input.environment, type: "string" },
      },
    });
    return {
      toolSurface,
      startupProfile,
      promptInstructions: CLAUDE_CUA_TOOL_INSTRUCTIONS,
      browserSession: runtime.browserSession,
      executor,
      ...(runtime.running.captureEvidence && { captureEvidence: runtime.running.captureEvidence }),
      ...(runtime.running.browserSessionLoss && {
        browserSessionLoss: runtime.running.browserSessionLoss,
      }),
      observedToolMatcher: (name) => isBrowserToolsetMember(name),
      drainObservationsByToolUse: () => {
        const drained = new Map(observations);
        observations.clear();
        return drained;
      },
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

function readPositiveIntEnv(key: string, fallback: number): number {
  const parsed = Number(process.env[key] ?? "");
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
