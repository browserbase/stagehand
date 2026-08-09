import type { StartupProfile, ToolStartResult, ToolSurface } from "../core/contracts/tool.js";
import { prepareCoreBrowserTarget } from "../core/targets/index.js";
import { getCoreTool } from "../core/tools/registry.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";

export interface AgentToolRuntimeInput {
  toolSurface: ToolSurface;
  startupProfile: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  logger: EvalLogger;
}

export interface StartedAgentToolRuntime {
  running: ToolStartResult;
  /** Closes the tool-owned runtime, then the runner-owned browser target. */
  cleanup: () => Promise<void>;
}

/**
 * Starts a CoreTool for an external agent harness without interpreting its
 * agent mount. Harness adapters own delivery; this function owns the shared
 * tool/target lifecycle and makes cleanup idempotent.
 */
export async function startAgentToolRuntime(
  input: AgentToolRuntimeInput,
): Promise<StartedAgentToolRuntime> {
  const tool = getCoreTool(input.toolSurface);
  if (!tool.supportedStartupProfiles.includes(input.startupProfile)) {
    throw new EvalsError(
      `Tool surface "${input.toolSurface}" does not support startup profile "${input.startupProfile}".`,
    );
  }

  const target = await prepareCoreBrowserTarget(input);
  let running: ToolStartResult;
  try {
    running = await tool.start({
      logger: input.logger,
      environment: input.environment,
      startupProfile: input.startupProfile,
      providedEndpoint: target.providedEndpoint,
    });
  } catch (error) {
    await target.cleanup().catch((): undefined => undefined);
    throw error;
  }

  let cleanupPromise: Promise<void> | undefined;
  return {
    running,
    cleanup: async () => {
      cleanupPromise ??= (async () => {
        try {
          await running.cleanup();
        } finally {
          await target.cleanup();
        }
      })();
      await cleanupPromise;
    },
  };
}
