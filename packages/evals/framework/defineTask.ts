import type {
  AgentBenchTaskContext,
  BenchTaskContext,
  BenchTaskMeta,
  CoreTaskContext,
  TaskDefinition,
  TaskMeta,
  TaskResult,
} from "./types.js";

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

export function defineAgentBenchTask(
  meta: BenchTaskMeta,
  fn: (ctx: AgentBenchTaskContext) => Promise<void | TaskResult>,
): TaskDefinition {
  return {
    __taskDefinition: true,
    meta,
    fn,
  };
}

export function defineTask(
  meta: TaskMeta | BenchTaskMeta,
  fn: (
    ctx: CoreTaskContext | BenchTaskContext | AgentBenchTaskContext,
  ) => Promise<void | TaskResult>,
): TaskDefinition {
  return {
    __taskDefinition: true,
    meta,
    fn,
  };
}
