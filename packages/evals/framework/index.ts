/**
 * Framework barrel export.
 *
 * Task authors import from here:
 *   import { defineTask } from "../framework/index.js";
 */
export {
  defineTask,
  defineCoreTask,
  defineBenchTask,
  defineAgentBenchTask,
} from "./defineTask.js";
export { discoverTasks, resolveTarget } from "./discovery.js";
export { runEvals } from "./runner.js";
export { createAssertHelpers, AssertionError } from "./assertions.js";
export { createMetricsCollector } from "./metrics.js";
export { buildCoreContext, buildAgentBenchContext } from "./context.js";
export type {
  AgentBenchContextOptions,
  AgentBenchContextResult,
  CoreContextOptions,
  CoreContextResult,
} from "./context.js";
export type {
  AgentBenchTaskContext,
  BenchTaskContext,
  CoreTaskContext,
  TaskDefinition,
} from "./types.js";
