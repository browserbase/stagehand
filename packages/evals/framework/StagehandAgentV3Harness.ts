import {
  AgentProvider,
  getAISDKLanguageModel,
  loadApiKeyFromEnv,
  type AvailableModel,
  type LLMClient,
  type LogLine,
} from "@browserbasehq/stagehand";
import { AISdkClientWrapped } from "../lib/AISdkClientWrapped.js";
import { endBrowserbaseSession } from "../browserbaseCleanup.js";
import { EvalsError } from "../errors.js";
import type { V3InitResult } from "../initV3.js";
import { installStagehandV3FlowLoggerBraintrustReporting } from "./StagehandV3FlowLoggerBraintrust.js";
import { StagehandV4BraintrustReporter } from "./StagehandV4BraintrustReporter.js";
import type {
  BenchHarness,
  BenchHarnessStartInput,
  StartedBenchHarness,
} from "./benchHarness.js";
import type { DiscoveredTask } from "./types.js";

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

export const StagehandAgentV3Harness: BenchHarness = {
  harness: "stagehand_v3",
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
    let stopV3FlowLoggerBraintrustReporting: (() => void) | undefined;
    const braintrustReporter = new StagehandV4BraintrustReporter([]);
    const createAgent = isAgentTask(task);
    if (row.config.harness !== "stagehand_v3") {
      throw new EvalsError(
        `Expected stagehand_v3 harness config, received "${row.config.harness}".`,
      );
    }
    const config = row.config;
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
        modelName: input.modelName,
        modelClientOptions: { apiKey },
        createAgent,
        agentMode,
        isCUA,
        verbose,
        configOverrides: { env: config.environment },
      });
    } else {
      let llmClient: LLMClient | undefined;
      if (input.modelName.includes("/")) {
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
        modelName: input.modelName,
        createAgent,
        agentMode,
        isCUA,
        verbose,
        configOverrides: { env: config.environment },
      });
    }
    stopV3FlowLoggerBraintrustReporting =
      installStagehandV3FlowLoggerBraintrustReporting({
        braintrustReporter,
        category: "stagehand_v3",
        logger,
        v3: v3Result.v3,
        verbose,
      });

    return {
      ctx: {
        harness: "stagehand_v3",
        row,
        logger,
        v3: v3Result.v3,
        agent: v3Result.agent,
        page: v3Result.v3.context.pages()[0],
        debugUrl: v3Result.debugUrl ?? "",
        onTaskStart: async () => {
          await braintrustReporter.attachCurrentSpan();
        },
        sessionUrl: v3Result.sessionUrl ?? "",
      },
      cleanup: async () => {
        stopV3FlowLoggerBraintrustReporting?.();
        stopV3FlowLoggerBraintrustReporting = undefined;
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
        await endBrowserbaseSession(v3Result?.v3);
      },
    };
  },
};
