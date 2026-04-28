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
import type { DiscoveredTask } from "./types.js";
import type { BenchMatrixRow, BenchTaskKind, Harness } from "./benchTypes.js";

type Page = ReturnType<V3["context"]["pages"]>[number];

export interface BenchHarnessStartInput {
  task: DiscoveredTask;
  input: EvalInput;
  row: BenchMatrixRow;
  logger: EvalLogger;
  verbose?: boolean;
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
    const createAgent = isAgentTask(task);

    if (row.useApi) {
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
        agentMode: input.agentMode,
        isCUA: input.isCUA,
        verbose,
        configOverrides: { env: row.environment },
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
        agentMode: input.agentMode,
        isCUA: input.isCUA,
        verbose,
        configOverrides: { env: row.environment },
      });
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
        await endBrowserbaseSession(v3Result?.v3);
      },
    };
  },
};

const harnessRegistry = new Map<Harness, BenchHarness>([
  ["stagehand", stagehandHarness],
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
