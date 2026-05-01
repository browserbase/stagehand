import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import type { StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import {
  prepareBrowseCliHarnessAdapter,
  type PreparedBrowseCliHarnessAdapter,
} from "./claudeCodeToolAdapter.js";

export interface CodexToolAdapterInput {
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}

export type PreparedCodexToolAdapter = PreparedBrowseCliHarnessAdapter;

export async function prepareCodexToolAdapter(
  input: CodexToolAdapterInput,
): Promise<PreparedCodexToolAdapter> {
  const toolSurface = resolveCodexToolSurface(input.toolSurface);
  const startupProfile = resolveCodexStartupProfile(
    toolSurface,
    input.environment,
    input.startupProfile,
  );

  return prepareBrowseCliHarnessAdapter({
    startupProfile,
    environment: input.environment,
    plan: input.plan,
    logger: input.logger,
    logCategory: "codex",
  });
}

export function resolveCodexToolSurface(requested?: ToolSurface): ToolSurface {
  if (!requested) return "browse_cli";
  if (requested === "browse_cli") return requested;
  throw new EvalsError(
    `Codex harness supports --tool browse_cli for execution right now; received "${requested}".`,
  );
}

export function resolveCodexStartupProfile(
  toolSurface: ToolSurface,
  environment: "LOCAL" | "BROWSERBASE",
  requested?: StartupProfile,
): StartupProfile {
  if (requested) return requested;

  if (toolSurface === "browse_cli") {
    return environment === "BROWSERBASE"
      ? "tool_create_browserbase"
      : "tool_launch_local";
  }

  throw new EvalsError(
    `No Codex startup profile default for tool "${toolSurface}" in ${environment}.`,
  );
}
