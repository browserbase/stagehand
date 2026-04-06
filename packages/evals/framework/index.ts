/**
 * Framework barrel export.
 *
 * Task authors import from here:
 *   import { defineTask } from "../framework/index.js";
 */

export { defineTask, defineCoreTask, defineBenchTask } from "./defineTask.js";
export { discoverTasks, resolveTarget } from "./discovery.js";
export { runEvals } from "./runner.js";
export { createAssertHelpers, AssertionError } from "./assertions.js";
export { createMetricsCollector } from "./metrics.js";
export { buildCoreContext, buildBenchContext } from "./context.js";

export type {
  Tier,
  TaskMeta,
  BenchTaskMeta,
  CoreTaskContext,
  BenchTaskContext,
  TaskResult,
  TaskDefinition,
  DiscoveredTask,
  TaskRegistry,
  AssertHelpers,
  MetricsCollector,
} from "./types.js";

export type { RunOptions, RunResult, ProgressEvent } from "./runner.js";
