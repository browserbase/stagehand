/**
 * Context builders for each tier.
 *
 * - buildCoreContext(): starts a browser via V3 (headless), provides page + assert + metrics
 * - buildBenchContext(): full V3 init with model/agent support (wraps existing initV3)
 */
import type {
  AvailableModel,
  ClientOptions,
  LLMClient,
} from "@browserbasehq/stagehand";
import { type V3InitResult, initV3 } from "../initV3.js";
import { EvalLogger } from "../logger.js";
import { createAssertHelpers } from "./assertions.js";
import { createMetricsCollector } from "./metrics.js";
import type { BenchTaskContext, CoreTaskContext } from "./types.js";

export interface CoreContextOptions {
  logger?: EvalLogger;
}

export interface CoreContextResult {
  ctx: CoreTaskContext;
  /** The V3 instance — caller is responsible for closing it. */
  v3Result: V3InitResult;
}

/**
 * Build a CoreTaskContext for deterministic (tier 1) tasks.
 *
 * Uses V3 to get a browser page but does NOT wire up an LLM —
 * core tasks should never call act/extract/observe.
 */
export async function buildCoreContext(
  options: CoreContextOptions = {},
): Promise<CoreContextResult> {
  const logger = options.logger ?? new EvalLogger();

  // Use a cheap model placeholder — core tasks don't invoke the LLM.
  // V3 still requires a model to be specified at init time.
  const v3Result = await initV3({
    logger,
    modelName: "openai/gpt-4.1-mini",
    configOverrides: {
      localBrowserLaunchOptions: { headless: true },
    },
  });

  const page = v3Result.v3.context.pages()[0];
  const ctx: CoreTaskContext = {
    page,
    assert: createAssertHelpers(),
    metrics: createMetricsCollector(),
    logger,
  };

  return { ctx, v3Result };
}

export interface BenchContextOptions {
  modelName: AvailableModel;
  logger?: EvalLogger;
  llmClient?: LLMClient;
  modelClientOptions?: ClientOptions;
  createAgent?: boolean;
  isCUA?: boolean;
  input: {
    name: string;
    modelName: AvailableModel;
    isCUA?: boolean;
    params?: Record<string, unknown>;
  };
}

export interface BenchContextResult {
  ctx: BenchTaskContext;
  /** The V3 instance — caller is responsible for closing it. */
  v3Result: V3InitResult;
}

/**
 * Build a BenchTaskContext for agent benchmark (tier 3) tasks.
 *
 * Wraps the existing initV3 logic, providing the same shape that
 * legacy EvalFunction tasks expect.
 */
export async function buildBenchContext(
  options: BenchContextOptions,
): Promise<BenchContextResult> {
  const logger = options.logger ?? new EvalLogger();
  const v3Result = await initV3({
    logger,
    modelName: options.modelName,
    llmClient: options.llmClient,
    modelClientOptions: options.modelClientOptions,
    createAgent: options.createAgent,
    isCUA: options.isCUA,
  });

  const page = v3Result.v3.context.pages()[0];
  const ctx: BenchTaskContext = {
    v3: v3Result.v3,
    agent: v3Result.agent,
    page,
    logger,
    input: options.input,
    modelName: options.modelName,
    debugUrl: v3Result.debugUrl ?? "",
    sessionUrl: v3Result.sessionUrl ?? "",
  };

  return { ctx, v3Result };
}
