import type { StartupProfile, ToolSurface } from "../../core/contracts/tool.js";
import { getCoreTool } from "../../core/tools/registry.js";
import { EvalsError } from "../../errors.js";
import type { BenchHarness } from "../benchHarness.js";

export type BenchEnvironment = "LOCAL" | "BROWSERBASE";

function formatList(values: ToolSurface[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return values.join(" or ");
  return `${values.slice(0, -1).join(", ")}, or ${values.at(-1)}`;
}

/** Resolve the tool surface for a row on `harness`. */
export function resolveToolSurface(
  harness: Pick<BenchHarness, "harness" | "supportedToolSurfaces">,
  requested?: ToolSurface,
): ToolSurface | undefined {
  const supported = harness.supportedToolSurfaces;
  if (supported.length === 0) return requested;
  if (requested === undefined) return supported[0];
  if (supported.includes(requested)) return requested;
  throw new EvalsError(
    `Harness "${harness.harness}" supports --tool ${formatList(supported)}; received "${requested}".`,
  );
}

/** Resolve the startup profile for `toolSurface` in `environment`. */
export function resolveStartupProfile(
  toolSurface: ToolSurface,
  environment: BenchEnvironment,
  requested?: StartupProfile,
): StartupProfile {
  if (requested !== undefined) return requested;

  const supported = getCoreTool(toolSurface).supportedStartupProfiles;
  const runnerProvided =
    environment === "BROWSERBASE" ? "runner_provided_browserbase_cdp" : "runner_provided_local_cdp";
  if (supported.includes(runnerProvided)) return runnerProvided;

  const toolOwned = environment === "BROWSERBASE" ? "tool_create_browserbase" : "tool_launch_local";
  if (supported.includes(toolOwned)) return toolOwned;

  throw new EvalsError(`No startup profile default for tool "${toolSurface}" in ${environment}.`);
}

/** Same as resolveStartupProfile but returns undefined when toolSurface is undefined. */
export function resolveOptionalStartupProfile(
  toolSurface: ToolSurface | undefined,
  environment: BenchEnvironment,
  requested?: StartupProfile,
): StartupProfile | undefined {
  if (requested !== undefined) return requested;
  if (toolSurface === undefined) return undefined;
  return resolveStartupProfile(toolSurface, environment);
}
