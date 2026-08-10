/**
 * Context builders for each tier.
 *
 * - buildCoreContext(): starts a core tool surface, provides page + tool + assert + metrics
 * - buildBenchContext(): full V3 init with model/agent support (wraps existing initV3)
 */
import type {
  AvailableModel,
  ClientOptions,
  LLMClient,
} from "@browserbasehq/stagehand";
import { type V3InitResult, initV3 } from "../initV3.js";
import type { StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import { coreFixtureRoutes } from "../core/fixtures/index.js";
import { prepareCoreBrowserTarget } from "../core/targets/index.js";
import { getCoreTool } from "../core/tools/registry.js";
import { ensureCoreFixtureServer } from "../core/fixtures/server.js";
import { EvalLogger } from "../logger.js";
import { createAssertHelpers } from "./assertions.js";
import { createMetricsCollector } from "./metrics.js";
import type { BenchTaskContext, CoreTaskContext } from "./types.js";

export interface CoreContextOptions {
  logger?: EvalLogger;
  environment?: "LOCAL" | "BROWSERBASE";
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
}

export interface CoreContextResult {
  ctx: CoreTaskContext;
  cleanup: () => Promise<void>;
}

export function resolveDefaultCoreStartupProfile(
  toolSurface: ToolSurface,
  environment: "LOCAL" | "BROWSERBASE",
): StartupProfile {
  switch (toolSurface) {
    case "browse_cli":
      return environment === "BROWSERBASE"
        ? "tool_create_browserbase"
        : "tool_launch_local";
    case "understudy_code":
    case "playwright_code":
    case "cdp_code":
    case "playwright_mcp":
    case "chrome_devtools_mcp":
      return environment === "BROWSERBASE"
        ? "runner_provided_browserbase_cdp"
        : "runner_provided_local_cdp";
    default:
      break;
  }

  throw new Error(
    `No default startup profile for tool "${toolSurface}" in environment "${environment}"`,
  );
}

/**
 * Build a CoreTaskContext for deterministic (tier 1) tasks.
 *
 * Starts the selected core tool surface but does NOT wire up an LLM —
 * core tasks should never call act/extract/observe.
 */
export async function buildCoreContext(
  options: CoreContextOptions = {},
): Promise<CoreContextResult> {
  const logger = options.logger ?? new EvalLogger();
  const environment = options.environment ?? "LOCAL";
  const toolSurface = options.toolSurface ?? "understudy_code";
  const tool = getCoreTool(toolSurface);
  const startupProfile =
    options.startupProfile ??
    resolveDefaultCoreStartupProfile(toolSurface, environment);

  if (!tool.supportedStartupProfiles.includes(startupProfile)) {
    throw new Error(
      `Tool surface "${toolSurface}" does not support startup profile "${startupProfile}".`,
    );
  }

  if (environment === "LOCAL") {
    await ensureCoreFixtureServer([...coreFixtureRoutes]);
  }

  const targetResult = await prepareCoreBrowserTarget({
    environment,
    toolSurface,
    startupProfile,
  });

  const toolResult = await tool.start({
    logger,
    environment,
    startupProfile,
    providedEndpoint: targetResult.providedEndpoint,
  });

  const page = await toolResult.session.activePage();
  const ctx: CoreTaskContext = {
    page,
    tool: toolResult.session,
    startupProfile,
    adapter: {
      name: tool.id,
      family: tool.family,
      surface: tool.surface,
      metadata: {
        ...toolResult.metadata,
        ...(targetResult.metadata ?? {}),
      },
    },
    assert: createAssertHelpers(),
    metrics: createMetricsCollector(),
    logger,
  };

  return {
    ctx,
    cleanup: async () => {
      try {
        await toolResult.cleanup();
      } finally {
        await targetResult.cleanup();
      }
    },
  };
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
