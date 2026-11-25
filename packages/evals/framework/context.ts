import type { AvailableModel, ClientOptions, LLMClient } from "stagehand-v3";
import { type V3InitResult, initV3 } from "../initV3.js";
import type { StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import { coreFixtureRoutes } from "../core/fixtures/index.js";
import { prepareCoreBrowserTarget } from "../core/targets/index.js";
import {
  getCoreTool,
  isAgentMountOnlyToolSurface,
  listCoreRunnableTools,
} from "../core/tools/registry.js";
import { ensureCoreFixtureServer } from "../core/fixtures/server.js";
import { EvalsError } from "../errors.js";
import { EvalLogger } from "../logger.js";
import { createAssertHelpers } from "./assertions.js";
import { createMetricsCollector } from "./metrics.js";
import type { AgentBenchTaskContext, CoreTaskContext } from "./types.js";
import { resolveStartupProfile } from "./harnesses/toolSurfaceResolution.js";
import { formatBenchHarnessFlags, listBenchHarnessesForToolSurface } from "./benchHarness.js";

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
  rejectAgentMountOnlyCoreTool(toolSurface);
  return resolveStartupProfile(toolSurface, environment);
}

export function rejectAgentMountOnlyCoreTool(toolSurface: ToolSurface): void {
  if (!isAgentMountOnlyToolSurface(toolSurface)) return;
  const harnesses = listBenchHarnessesForToolSurface(toolSurface);
  const guidance = harnesses.length
    ? `Use ${formatBenchHarnessFlags(harnesses)} with --tool ${toolSurface}`
    : "No registered harness mounts this surface";
  throw new EvalsError(
    `Tool surface "${toolSurface}" is available only as an agent harness mount and cannot run under evals core. ${guidance}, or choose one of: ${listCoreRunnableTools().join(", ")}.`,
  );
}

export async function buildCoreContext(
  options: CoreContextOptions = {},
): Promise<CoreContextResult> {
  const logger = options.logger ?? new EvalLogger();
  const environment = options.environment ?? "LOCAL";
  const toolSurface = options.toolSurface ?? "understudy_code";
  rejectAgentMountOnlyCoreTool(toolSurface);
  const tool = getCoreTool(toolSurface);
  const startupProfile =
    options.startupProfile ?? resolveDefaultCoreStartupProfile(toolSurface, environment);

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
        ...targetResult.metadata,
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

export interface AgentBenchContextOptions {
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

export interface AgentBenchContextResult {
  ctx: AgentBenchTaskContext;
  v3Result: V3InitResult;
}

export async function buildAgentBenchContext(
  options: AgentBenchContextOptions,
): Promise<AgentBenchContextResult> {
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
  const ctx: AgentBenchTaskContext = {
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
