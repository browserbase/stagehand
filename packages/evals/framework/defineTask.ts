/**
 * defineTask — the thin wrapper API for defining eval tasks.
 *
 * Usage (core tier):
 *   export default defineTask({ name: "snapshot" }, async ({ page, assert }) => {
 *     await page.goto("https://example.com");
 *     const title = await page.title();
 *     assert.equals(title, "Example Domain");
 *   });
 *
 * Usage (bench tier):
 *   export default defineTask({ name: "dropdown" }, async ({ v3, logger }) => {
 *     const page = v3.context.pages()[0];
 *     await page.goto("https://example.com");
 *     await v3.act("click the dropdown");
 *     return { _success: true, logs: logger.getLogs() };
 *   });
 *
 * The tier is NOT specified by the user — it's inferred from the directory
 * the file lives in during auto-discovery.
 */

import type {
  TaskMeta,
  BenchTaskMeta,
  CoreTaskContext,
  BenchTaskContext,
  TaskResult,
  TaskDefinition,
} from "./types.js";

// Separate functions for each tier to preserve type inference on the callback.

/**
 * Define a core tier task (deterministic, no LLM).
 * Core tasks receive { page, assert, metrics, logger } and throw on failure.
 */
export function defineCoreTask(
  meta: TaskMeta,
  fn: (ctx: CoreTaskContext) => Promise<void>,
): TaskDefinition {
  return {
    __taskDefinition: true,
    meta,
    fn: fn as TaskDefinition["fn"],
  };
}

/**
 * Define a bench tier task (with LLM and evaluator).
 * Bench tasks receive { v3, agent, page, logger, input, ... } and return TaskResult.
 */
export function defineBenchTask(
  meta: BenchTaskMeta,
  fn: (ctx: BenchTaskContext) => Promise<TaskResult>,
): TaskDefinition {
  return {
    __taskDefinition: true,
    meta,
    fn: fn as TaskDefinition["fn"],
  };
}

/**
 * Generic defineTask — for cases where the tier is ambiguous at definition time.
 * Prefer defineCoreTask / defineBenchTask for better type inference.
 */
export function defineTask(
  meta: TaskMeta | BenchTaskMeta,
  fn: ((ctx: CoreTaskContext) => Promise<void>) | ((ctx: BenchTaskContext) => Promise<TaskResult>),
): TaskDefinition {
  return {
    __taskDefinition: true,
    meta,
    fn: fn as TaskDefinition["fn"],
  };
}
