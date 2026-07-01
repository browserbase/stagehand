import type { DriverCommandName } from "../driver/commands/types.js";
import { runDriverCommandWithTarget } from "../driver/runtime.js";
import type { ConnectionTarget } from "../driver/types.js";
import { loadMacro } from "./store.js";
import type { BrowseMacro } from "./types.js";

export interface ReplayMacroOptions {
  delayMs: number;
  name: string;
  session: string;
  target: ConnectionTarget;
}

export interface ReplayMacroResult {
  macro: BrowseMacro;
  results: unknown[];
}

export async function replayMacro(
  options: ReplayMacroOptions,
): Promise<ReplayMacroResult> {
  const macro = await loadMacro(options.name);
  const results: unknown[] = [];

  for (const step of macro.steps) {
    const result = await runDriverCommandWithTarget(
      options.session,
      options.target,
      step.command as DriverCommandName,
      step.params,
    );
    results.push(result);

    if (options.delayMs > 0) {
      await sleep(options.delayMs);
    }
  }

  return { macro, results };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
