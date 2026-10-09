/**
 * Shared execution semantics for `via: "handles"` agent mounts.
 *
 * Every harness that exposes a handle binding runs the agent's snippet the same
 * way — inside an async function whose arguments are the mount's handle names
 * plus `startUrl`, `task`, and `console` — and only the log category differs.
 * claude_code owned the original copy and pi carried a duplicate marked
 * "consolidate when a third harness needs it"; deepagents is the third, so it
 * lives here.
 *
 * Harness mechanics (which tool hosts the snippet, timeouts, observation
 * recording) stay with each adapter; this module owns only the scope contract.
 */
import type { AgentRunToolSpec } from "../core/contracts/tool.js";
import type { EvalLogger } from "../logger.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";

export interface CodeExposureSnippetInput {
  code: string;
  handles: Record<string, unknown>;
  runToolSpec: AgentRunToolSpec;
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
  /** Log category for the snippet's console output, e.g. "claude_code". */
  logCategory: string;
}

export async function executeCodeExposureSnippet(
  input: CodeExposureSnippetInput,
): Promise<unknown> {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<unknown>;
  // Snippet scope = the exposure's handle names plus startUrl/task/console.
  // Object.keys/Object.values over the same object are guaranteed to align,
  // so names — not positions — bind the values.
  const fn = new AsyncFunction(
    ...Object.keys(input.handles),
    "startUrl",
    "task",
    "console",
    input.code,
  );
  return fn(
    ...Object.values(input.handles),
    input.plan.startUrl,
    {
      dataset: input.plan.dataset,
      id: input.plan.taskId,
      startUrl: input.plan.startUrl,
      instruction: input.plan.instruction,
    },
    buildRunToolConsole(input.logger, input.logCategory),
  );
}

export function buildRunToolConsole(
  logger: EvalLogger,
  logCategory: string,
): Pick<Console, "log" | "warn" | "error"> {
  const write = (level: "log" | "warn" | "error", values: unknown[]) => {
    logger.log({
      category: logCategory,
      message: `run console.${level}: ${values.map(stringifyToolResult).join(" ")}`,
      level: 1,
    });
  };
  return {
    log: (...values: unknown[]) => write("log", values),
    warn: (...values: unknown[]) => write("warn", values),
    error: (...values: unknown[]) => write("error", values),
  };
}

export function stringifyToolResult(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function clipToolResult(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
