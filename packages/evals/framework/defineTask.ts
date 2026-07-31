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
