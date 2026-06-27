import {
  AgentProvider,
  getAISDKLanguageModel,
  loadApiKeyFromEnv,
  type AgentInstance,
  type AvailableModel,
  type LLMClient,
  type LogLine,
  type V3,
} from "@browserbasehq/stagehand";
import { AISdkClientWrapped } from "../lib/AISdkClientWrapped.js";
import { endBrowserbaseSession } from "../browserbaseCleanup.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import type { V3InitResult } from "../initV3.js";
import type { EvalInput } from "../types/evals.js";
import { runClaudeCodeAgent } from "./claudeCodeRunner.js";
import { prepareClaudeCodeToolAdapter } from "./claudeCodeToolAdapter.js";
import { runCodexAgent } from "./codexRunner.js";
import { prepareCodexToolAdapter } from "./codexToolAdapter.js";
import { buildExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { prepareClawBenchRuntime } from "../clawbench/runtime.js";
import { loadClawBenchModelConfig } from "../clawbench/modelConfig.js";
import { getClawBenchLanguageModel } from "../clawbench/languageModel.js";
import type { ClawBenchRunParams } from "../clawbench/types.js";
import type { DiscoveredTask, TaskResult } from "./types.js";
import type { BenchMatrixRow, BenchTaskKind, Harness } from "./benchTypes.js";

type Page = ReturnType<V3["context"]["pages"]>[number];

export interface BenchHarnessStartInput {
  task: DiscoveredTask;
  input: EvalInput;
  row: BenchMatrixRow;
  logger: EvalLogger;
  verbose?: boolean;
}

export interface BenchHarnessExecuteInput extends BenchHarnessStartInput {
  signal?: AbortSignal;
}

export interface BenchHarnessContext {
  harness: Harness;
  row: BenchMatrixRow;
  logger: EvalLogger;
  v3?: V3;
  agent?: AgentInstance;
  page?: Page;
  debugUrl: string;
  sessionUrl: string;
}

export interface StartedBenchHarness {
  ctx: BenchHarnessContext;
  cleanup: () => Promise<void>;
}

export interface BenchHarness {
  harness: Harness;
  supportedTaskKinds: BenchTaskKind[];
  supportsApi: boolean;
  execute?(input: BenchHarnessExecuteInput): Promise<TaskResult>;
  start(input: BenchHarnessStartInput): Promise<StartedBenchHarness>;
}

function isAgentTask(task: DiscoveredTask): boolean {
  return (
    task.primaryCategory === "agent" ||
    task.categories.includes("agent") ||
    task.categories.includes("external_agent_benchmarks")
  );
}

function resolveProvider(modelName: AvailableModel): string | undefined {
  if (modelName.includes("/")) {
    return modelName.split("/")[0];
  }

  try {
    return AgentProvider.getAgentProvider(modelName);
  } catch {
    return undefined;
  }
}

function createClawBenchLlmClient(modelName: string): LLMClient {
  const modelConfig = loadClawBenchModelConfig(modelName);

  return new AISdkClientWrapped({
    model: getClawBenchLanguageModel(modelConfig),
    clientOptions: {
      apiKey: modelConfig.api_key,
      baseURL: modelConfig.base_url,
      reasoningEffort: modelConfig.thinking_level,
      temperature: modelConfig.temperature,
    },
  });
}

export const stagehandHarness: BenchHarness = {
  harness: "stagehand",
  supportedTaskKinds: [
    "act",
    "extract",
    "observe",
    "agent",
    "combination",
    "suite",
  ],
  supportsApi: true,
  async start({
    task,
    input,
    row,
    logger,
    verbose,
  }: BenchHarnessStartInput): Promise<StartedBenchHarness> {
    let v3Result: V3InitResult | undefined;
    const isClawBenchTask = task.name === "agent/clawbench";
    const createAgent = isAgentTask(task) && !isClawBenchTask;
    if (row.config.harness !== "stagehand") {
      throw new EvalsError(
        `Harness "${row.config.harness}" is not implemented yet. Use --harness stagehand for the current unified runner.`,
      );
    }
    const config = row.config;
    if (isClawBenchTask && config.environment !== "LOCAL") {
      throw new EvalsError(
        "ClawBench native runs currently support LOCAL only. Use --env local.",
      );
    }
    if (isClawBenchTask && config.useApi) {
      throw new EvalsError(
        "ClawBench native runs do not support --api; they require local Chrome with the ClawBench recorder extension.",
      );
    }

    let clawbenchRuntime:
      | Awaited<ReturnType<typeof prepareClawBenchRuntime>>
      | undefined;

    try {
      clawbenchRuntime = isClawBenchTask
        ? await prepareClawBenchRuntime(
            input.params as unknown as ClawBenchRunParams,
          )
        : undefined;
      if (clawbenchRuntime && input.params) {
        (input.params as Record<string, unknown>)._clawbenchRuntime =
          clawbenchRuntime;
      }
      const clawbenchLlmClient = isClawBenchTask
        ? createClawBenchLlmClient(String(input.modelName))
        : undefined;
      const initModelName = input.modelName;
      const agentMode = config.agentMode ?? input.agentMode;
      const isCUA = config.isCUA ?? input.isCUA;

      if (config.useApi) {
        const provider = resolveProvider(input.modelName);
        const logFn = (line: LogLine) => logger.log(line);
        const apiKey = loadApiKeyFromEnv(provider, logFn);
        if (!apiKey) {
          throw new EvalsError(
            `USE_API=true but no API key found for provider "${provider}".`,
          );
        }
        const { initV3 } = await import("../initV3.js");
        v3Result = await initV3({
          logger,
          modelName: initModelName,
          modelClientOptions: { apiKey },
          createAgent,
          agentMode,
          isCUA,
          verbose,
          configOverrides: { env: config.environment },
        });
      } else {
        let llmClient: LLMClient | undefined = clawbenchLlmClient;
        if (!llmClient && input.modelName.includes("/")) {
          const firstSlashIndex = input.modelName.indexOf("/");
          llmClient = new AISdkClientWrapped({
            model: getAISDKLanguageModel(
              input.modelName.substring(0, firstSlashIndex),
              input.modelName.substring(firstSlashIndex + 1),
            ),
          });
        }
        const { initV3 } = await import("../initV3.js");
        v3Result = await initV3({
          logger,
          llmClient,
          modelName: initModelName,
          createAgent,
          agentMode,
          isCUA,
          verbose,
          configOverrides: {
            env: config.environment,
            localBrowserLaunchOptions: clawbenchRuntime?.launchOptions,
            experimental: Boolean(clawbenchRuntime),
          },
        });
      }

      if (clawbenchRuntime) {
        await clawbenchRuntime.startCdpInterceptor();
      }

      return {
        ctx: {
          harness: "stagehand",
          row,
          logger,
          v3: v3Result.v3,
          agent: v3Result.agent,
          page: v3Result.v3.context.pages()[0],
          debugUrl: v3Result.debugUrl ?? "",
          sessionUrl: v3Result.sessionUrl ?? "",
        },
        cleanup: async () => {
          if (v3Result?.v3) {
            try {
              await v3Result.v3.close();
            } catch (closeError) {
              console.error(
                `Warning: Error closing V3 instance for ${input.name}:`,
                closeError,
              );
            }
          }
          await clawbenchRuntime?.stop();
          await endBrowserbaseSession(v3Result?.v3);
        },
      };
    } catch (error) {
      await clawbenchRuntime?.stop();
      throw error;
    }
  },
};

export const claudeCodeHarness: BenchHarness = {
  harness: "claude_code",
  supportedTaskKinds: ["agent", "suite"],
  supportsApi: false,
  async execute({
    input,
    row,
    logger,
    signal,
  }: BenchHarnessExecuteInput): Promise<TaskResult> {
    const plan = buildExternalHarnessTaskPlan(input);
    if (row.config.harness !== "claude_code") {
      throw new EvalsError(
        `Expected claude_code harness config, received "${row.config.harness}".`,
      );
    }
    const toolAdapter = await prepareClaudeCodeToolAdapter({
      toolSurface: row.config.toolSurface,
      startupProfile: row.config.startupProfile,
      environment: row.config.environment,
      plan,
      logger,
    });
    try {
      return await runClaudeCodeAgent({
        plan,
        model: input.modelName,
        logger,
        toolAdapter,
        signal,
      });
    } finally {
      await toolAdapter.cleanup();
    }
  },
  async start(): Promise<StartedBenchHarness> {
    throw new EvalsError(
      "Claude Code harness execution uses the external harness execute path. Use --dry-run to inspect its bench matrix, or run with --harness claude_code.",
    );
  },
};

export const codexHarness: BenchHarness = {
  harness: "codex",
  supportedTaskKinds: ["agent", "suite"],
  supportsApi: false,
  async execute({
    input,
    row,
    logger,
    signal,
  }: BenchHarnessExecuteInput): Promise<TaskResult> {
    const plan = buildExternalHarnessTaskPlan(input);
    if (row.config.harness !== "codex") {
      throw new EvalsError(
        `Expected codex harness config, received "${row.config.harness}".`,
      );
    }
    const toolAdapter = await prepareCodexToolAdapter({
      toolSurface: row.config.toolSurface,
      startupProfile: row.config.startupProfile,
      environment: row.config.environment,
      plan,
      logger,
    });
    try {
      return await runCodexAgent({
        plan,
        model: input.modelName,
        logger,
        toolAdapter,
        signal,
      });
    } finally {
      await toolAdapter.cleanup();
    }
  },
  async start(): Promise<StartedBenchHarness> {
    throw new EvalsError(
      "Codex harness execution uses the external harness execute path. Use --dry-run to inspect its bench matrix, or run with --harness codex.",
    );
  },
};

const harnessRegistry = new Map<Harness, BenchHarness>([
  ["stagehand", stagehandHarness],
  ["claude_code", claudeCodeHarness],
  ["codex", codexHarness],
]);

export function getBenchHarness(harness: Harness): BenchHarness {
  const implementation = harnessRegistry.get(harness);
  if (!implementation) {
    throw new EvalsError(
      `Harness "${harness}" is not implemented yet. Use --harness stagehand for the current unified runner.`,
    );
  }
  return implementation;
}
