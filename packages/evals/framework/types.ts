/**
 * Core types for the eval framework.
 *
 * The framework supports two tiers:
 *   - "core"  — deterministic, no-LLM performance tests (CLI functions)
 *   - "bench" — agent benchmark evals with LLM evaluators
 *
 * A third tier ("interpret") is planned but not yet implemented.
 */
import type {
  AgentToolMode,
  AgentInstance,
  AvailableModel,
  LogLine,
  V3,
} from "@browserbasehq/stagehand";
import type {
  CorePageHandle,
  CoreSession,
  CoreTool,
  StartupProfile,
  ToolStartResult,
  ToolSurface,
} from "../core/contracts/tool.js";
import type { EvalLogger } from "../logger.js";

/** Page type inferred from V3.context.pages()[0] */
type Page = ReturnType<V3["context"]["pages"]>[number];

export type Tier = "core" | "bench";

export interface TaskMeta {
  /** Human-readable task name (e.g., "snapshot", "dropdown"). Inferred from filename if omitted. */
  name?: string;
  /** Additional categories beyond the directory (for cross-cutting tags like "regression"). */
  categories?: string[];
  /** Freeform tags for filtering (e.g., ["flaky", "slow"]). */
  tags?: string[];
}

export interface BenchTaskMeta extends TaskMeta {
  /** Override the default model list for this specific task. */
  models?: string[];
}

/** Context provided to core (tier 1) tasks. */
export interface CoreTaskContext {
  /** Portable page handle for the selected core tool surface. */
  page: CorePageHandle;
  /** Core tool session backing this task run. */
  tool: CoreSession;
  /** Selected startup profile for this run. */
  startupProfile: StartupProfile;
  /** Tool surface metadata for reporting and conditional behavior. */
  adapter: {
    name: ToolSurface;
    family: CoreTool["family"];
    surface: CoreTool["surface"];
    metadata: ToolStartResult["metadata"];
  };
  /** Assertion helpers. Throws on failure. */
  assert: AssertHelpers;
  /** Performance metrics collector. */
  metrics: MetricsCollector;
  /** Eval logger for structured logging. */
  logger: EvalLogger;
}

/** Context provided to bench (tier 3) tasks — matches existing EvalFunction input. */
export interface BenchTaskContext {
  /** Stagehand V3 instance. */
  v3: V3;
  /** Agent instance (created when the task lives under agent/). */
  agent?: AgentInstance;
  /** Playwright page (convenience — same as v3.context.pages()[0]). */
  page: Page;
  /** Eval logger. */
  logger: EvalLogger;
  /** Full eval input (name, modelName, agent mode, params). */
  input: {
    name: string;
    modelName: AvailableModel;
    agentMode?: AgentToolMode;
    isCUA?: boolean;
    params?: Record<string, unknown>;
  };
  /** Model used for this run. */
  modelName: AvailableModel;
  /** Debug URL (Browserbase). */
  debugUrl: string;
  /** Session URL (Browserbase). */
  sessionUrl: string;
}

export interface TaskResult {
  _success: boolean;
  logs?: LogLine[];
  debugUrl?: string;
  sessionUrl?: string;
  error?: unknown;
  [key: string]: unknown;
}

export interface AssertHelpers {
  /** Deep equality check. */
  equals(actual: unknown, expected: unknown, message?: string): void;
  /** Regex match on a string. */
  matches(actual: string, pattern: RegExp, message?: string): void;
  /** Substring inclusion check. */
  includes(haystack: string, needle: string, message?: string): void;
  /** Truthy check. */
  truthy(value: unknown, message?: string): void;
  /** Falsy check. */
  falsy(value: unknown, message?: string): void;
  /** Numeric comparison. */
  lessThan(actual: number, expected: number, message?: string): void;
  greaterThan(actual: number, expected: number, message?: string): void;
}

export interface MetricsCollector {
  /** Start a named timer. Returns a stop function that records the duration. */
  startTimer(name: string): () => number;
  /** Record a named metric value directly. */
  record(name: string, value: number): void;
  /** Get all recorded metrics. */
  getAll(): Record<string, number[]>;
  /** Get summary stats. Single measurements emit { value, count }; multiple emit full stats. */
  getSummary(): Record<string, Record<string, number>>;
}

export interface TaskDefinition {
  /** Marker to identify defineTask outputs during discovery. */
  __taskDefinition: true;
  /** User-provided metadata. */
  meta: TaskMeta | BenchTaskMeta;
  /** The task function. */
  fn: (ctx: CoreTaskContext | BenchTaskContext) => Promise<void | TaskResult>;
  /** Which tier this task was defined for (set during discovery from directory). */
  tier?: Tier;
}

export interface DiscoveredTask {
  /** Unique task identifier (e.g., "snapshot" or "agent/gaia"). */
  name: string;
  /** Tier derived from directory. */
  tier: Tier;
  /** Primary category derived from subdirectory. */
  primaryCategory: string;
  /** All categories (primary + meta.categories). */
  categories: string[];
  /** Freeform tags. */
  tags: string[];
  /** File path to the task module. */
  filePath: string;
  /** Whether this uses the new defineTask API or legacy EvalFunction export. */
  isLegacy: boolean;
  /** Model overrides (bench tier only). */
  models?: string[];
}

export interface TaskRegistry {
  /** All discovered tasks. */
  tasks: DiscoveredTask[];
  /** Lookup by name. */
  byName: Map<string, DiscoveredTask>;
  /** Lookup by tier. */
  byTier: Map<Tier, DiscoveredTask[]>;
  /** Lookup by category. */
  byCategory: Map<string, DiscoveredTask[]>;
}
