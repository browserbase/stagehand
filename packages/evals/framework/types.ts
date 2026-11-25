import type { AgentToolMode, AgentInstance, AvailableModel, LogLine, V3 } from "stagehand-v3";
import type { Page, Stagehand } from "@browserbasehq/stagehand";
import type {
  CorePageHandle,
  CoreSession,
  CoreTool,
  StartupProfile,
  ToolStartResult,
  ToolSurface,
} from "../core/contracts/tool.js";
import type { EvalLogger } from "../logger.js";

type V3Page = ReturnType<V3["context"]["pages"]>[number];

export type Tier = "core" | "bench";

export interface TaskMeta {
  name?: string;
  categories?: string[];
  tags?: string[];
}

export interface BenchTaskMeta extends TaskMeta {
  models?: string[];
}

export interface CoreTaskContext {
  page: CorePageHandle;
  tool: CoreSession;
  startupProfile: StartupProfile;
  adapter: {
    name: ToolSurface;
    family: CoreTool["family"];
    surface: CoreTool["surface"];
    metadata: ToolStartResult["metadata"];
  };
  assert: AssertHelpers;
  metrics: MetricsCollector;
  logger: EvalLogger;
}

export interface BenchTaskContext {
  stagehand: Stagehand;
  page: Page;
  logger: EvalLogger;
  input: {
    name: string;
    modelName: AvailableModel;
    params?: Record<string, unknown>;
  };
  modelName: AvailableModel;
  debugUrl: string;
  sessionUrl: string;
}

export interface AgentBenchTaskContext {
  v3: V3;
  agent?: AgentInstance;
  page: V3Page;
  logger: EvalLogger;
  input: {
    name: string;
    modelName: AvailableModel;
    agentMode?: AgentToolMode;
    isCUA?: boolean;
    params?: Record<string, unknown>;
  };
  modelName: AvailableModel;
  debugUrl: string;
  sessionUrl: string;
}

export interface TaskResult {
  _success: boolean;
  logs?: LogLine[];
  debugUrl?: string;
  sessionUrl?: string;
  error?: unknown;
  harnessStatus?: string;
  harnessStopReason?: string;
  [key: string]: unknown;
}

export interface AssertHelpers {
  equals(actual: unknown, expected: unknown, message?: string): void;
  matches(actual: string, pattern: RegExp, message?: string): void;
  includes(haystack: string, needle: string, message?: string): void;
  truthy(value: unknown, message?: string): void;
  falsy(value: unknown, message?: string): void;
  lessThan(actual: number, expected: number, message?: string): void;
  greaterThan(actual: number, expected: number, message?: string): void;
}

export interface MetricsCollector {
  startTimer(name: string): () => number;
  record(name: string, value: number): void;
  getAll(): Record<string, number[]>;
  getSummary(): Record<string, Record<string, number>>;
}

export interface TaskDefinition {
  __taskDefinition: true;
  meta: TaskMeta | BenchTaskMeta;
  fn: (
    ctx: CoreTaskContext | BenchTaskContext | AgentBenchTaskContext,
  ) => Promise<void | TaskResult>;
  tier?: Tier;
}

export interface DiscoveredTask {
  name: string;
  tier: Tier;
  primaryCategory: string;
  categories: string[];
  tags: string[];
  filePath: string;
  isLegacy: boolean;
  models?: string[];
}

export interface TaskRegistry {
  tasks: DiscoveredTask[];
  byName: Map<string, DiscoveredTask>;
  byTier: Map<Tier, DiscoveredTask[]>;
  byCategory: Map<string, DiscoveredTask[]>;
}
