import {
  GeminiCuaExecutor,
  type CuaFacadeTools,
  type GeminiToolExecutor,
} from "@browserbasehq/stagehand-integrations-gemini-cua-sdk";
import type { ProbeEvidence } from "stagehand-v3";
import type { BrowserSessionLoss, StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import { bridgeCuaFacadeTools, cuaCleanup } from "./cuaToolAdapter.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import type { BrowserSessionInfo } from "./browserSession.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { startAgentToolRuntime } from "./agentToolRuntime.js";
import { resolveStartupProfile, resolveToolSurface } from "./harnesses/toolSurfaceResolution.js";

export const GEMINI_CUA_TOOL_INSTRUCTIONS =
  "Browser tool surface: Gemini Computer Use.\nUse the computer-use actions supplied by the API to control the existing browser. Action coordinates use the normalized 0–999 range on a 1288×711 viewport. Each action response includes the current URL and a fresh screenshot when available. Use the supplied action schemas for their exact arguments.";

export const GEMINI_CUA_TOOL_SURFACES: ToolSurface[] = ["google_computer_use"];
export interface PreparedGeminiCuaToolAdapter {
  toolSurface: ToolSurface;
  startupProfile: StartupProfile;
  promptInstructions: string;
  browserSession: BrowserSessionInfo;
  executor: GeminiToolExecutor;
  facade: CuaFacadeTools;
  captureEvidence?: () => Promise<ProbeEvidence>;
  browserSessionLoss?: () => BrowserSessionLoss | undefined;
  observedToolMatcher: (name: string) => boolean;
  cleanup: () => Promise<void>;
}

export async function prepareGeminiCuaToolAdapter(input: {
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}): Promise<PreparedGeminiCuaToolAdapter> {
  const toolSurface = resolveToolSurface(
    { harness: "gemini_cua", supportedToolSurfaces: GEMINI_CUA_TOOL_SURFACES },
    input.toolSurface,
  );
  if (!toolSurface) throw new EvalsError("gemini_cua harness requires a tool surface.");
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
    if (!callTool || !mount)
      throw new EvalsError(`Tool surface "${toolSurface}" does not expose runner-side tool calls.`);
    const facade = bridgeCuaFacadeTools(callTool);
    const executor = new GeminiCuaExecutor(facade, input.logger);
    return {
      toolSurface,
      startupProfile,
      promptInstructions: GEMINI_CUA_TOOL_INSTRUCTIONS,
      browserSession: runtime.browserSession,
      executor,
      facade,
      ...(runtime.running.captureEvidence && { captureEvidence: runtime.running.captureEvidence }),
      ...(runtime.running.browserSessionLoss && {
        browserSessionLoss: runtime.running.browserSessionLoss,
      }),
      observedToolMatcher: () => true,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
