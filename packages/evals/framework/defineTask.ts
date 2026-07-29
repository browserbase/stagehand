/**
 * defineTask — the thin wrapper API for defining eval tasks.
 *
 * The tier is NOT specified by the user — it's inferred from the directory
 * the file lives in during auto-discovery.
 */
import type {
  BenchTaskContext,
  BenchTaskMeta,
  CoreTaskContext,
  TaskDefinition,
  TaskMeta,
  TaskResult,
} from "./types.js";
import type { BenchTaskContext } from "./types.js";

/**
 * Define a core tier task (deterministic, no LLM).
 * Core tasks receive { page, assert, metrics, logger } and throw on failure.
 */
export function defineCoreTask(
  meta: TaskMeta,
  fn: (ctx: CoreTaskContext) => Promise<void | TaskResult>,
): TaskDefinition {
  return {
    __taskDefinition: true,
    meta,
    fn,
  };
}

/**
 * Define a bench tier task (with LLM and evaluator).
 * Bench tasks receive { v3, agent, page, logger, input, ... } and return TaskResult.
 */
export function defineBenchTask(
  meta: BenchTaskMeta,
  fn: (ctx: BenchTaskContext) => Promise<void | TaskResult>,
): TaskDefinition {
  return {
    __taskDefinition: true,
    meta,
    fn,
  };
}

/**
 * Define a bench tier task ported to the Stagehand v4 SDK.
 * v4 bench tasks receive { stagehand, page, logger, input, ... } and return
 * TaskResult. They live under tasks/bench/ and are selected via --sdk v4.
 */
export function defineBenchTask(
  meta: BenchTaskMeta,
  fn: (ctx: BenchTaskContext) => Promise<void | TaskResult>,
): TaskDefinition {
  return {
    __taskDefinition: true,
    meta,
    // Fail fast with a clear message if a v3-context runner invokes a v4
    // task — the v4 init/dispatch path lands with the harness change.
    fn: (ctx) => {
      if (!("stagehand" in ctx) || ctx.stagehand === undefined) {
        throw new Error(
          `Task "${meta.name}" requires the v4 harness (--sdk v4); it was invoked with a v3 context.`,
        );
      }
      return fn(ctx as unknown as BenchTaskContext);
    },
  };
}

/**
 * Generic defineTask — for cases where the tier is ambiguous at definition time.
 * Prefer defineCoreTask / defineBenchTask for better type inference.
 */
export function defineTask(
  meta: TaskMeta | BenchTaskMeta,
  fn: (ctx: CoreTaskContext | BenchTaskContext) => Promise<void | TaskResult>,
): TaskDefinition {
  return {
    __taskDefinition: true,
    meta,
    fn,
  };
}
