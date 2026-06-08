import {
  getAISDKLanguageModel,
  type AgentInstance,
  type LLMClient,
  type V3,
} from "@browserbasehq/stagehand";
import { AISdkClientWrapped } from "../lib/AISdkClientWrapped.js";
import { endBrowserbaseSession } from "../browserbaseCleanup.js";
import { EvalsError } from "../errors.js";
import type { V3InitResult } from "../initV3.js";
import { installStagehandV3FlowLoggerBraintrustReporting } from "./StagehandV3FlowLoggerBraintrust.js";
import { StagehandV4BraintrustReporter } from "./StagehandV4BraintrustReporter.js";
import { StagehandV4SideChannel } from "./StagehandV4SideChannel.js";
import {
  startUnderstudyV4Tools,
  type UnderstudyV4NativeRuntime,
  type UnderstudyV4ToolDefinition,
} from "./UnderstudyV4Tools.js";
import type {
  BenchHarness,
  BenchHarnessContext,
  BenchHarnessStartInput,
  StartedBenchHarness,
} from "./benchHarness.js";

type Page = ReturnType<V3["context"]["pages"]>[number];
type AgentOptions = NonNullable<Parameters<V3["agent"]>[0]>;

const V3_DEFAULT_AGENT_TOOL_NAMES = [
  "act",
  "ariaTree",
  "click",
  "clickAndHold",
  "dragAndDrop",
  "extract",
  "fillForm",
  "fillFormVision",
  "goto",
  "keys",
  "navback",
  "screenshot",
  "scroll",
  "search",
  "think",
  "type",
  "wait",
] as const;

function isAgentTask(task: BenchHarnessStartInput["task"]): boolean {
  return (
    task.primaryCategory === "agent" ||
    task.categories.includes("agent") ||
    task.categories.includes("external_agent_benchmarks")
  );
}

export const StagehandAgentV4Harness: BenchHarness = {
  harness: "stagehand_v4",
  supportedTaskKinds: [
    "act",
    "extract",
    "observe",
    "agent",
    "combination",
    "suite",
  ],
  supportsApi: false,
  async start({
    task,
    input,
    row,
    logger,
    verbose,
  }: BenchHarnessStartInput): Promise<StartedBenchHarness> {
    if (row.config.harness !== "stagehand_v4") {
      throw new EvalsError(
        `Expected stagehand_v4 harness config, received "${row.config.harness}".`,
      );
    }
    if (row.config.toolSurface !== "understudy_v4_code") {
      throw new EvalsError(
        `StagehandAgentV4Harness requires --tool understudy_v4_code; received "${row.config.toolSurface ?? "default"}".`,
      );
    }
    if (row.config.useApi) {
      throw new EvalsError(
        "stagehand_v4 must run locally so the v3 agent loop can call the live v4 SDK protocol tools.",
      );
    }

    const createAgent = isAgentTask(task);
    const understudyV4Tools = await startUnderstudyV4Tools({
      environment: row.config.environment,
      logger,
    });
    let v3Result: V3InitResult | undefined;
    let stopV3FlowLoggerBraintrustReporting: (() => void) | undefined;
    let printedV4BusLogTree = false;
    const braintrustReporter = new StagehandV4BraintrustReporter(
      understudyV4Tools.toolCatalog,
    );
    const sideChannel = new StagehandV4SideChannel({
      stagehandV4: understudyV4Tools.stagehandV4,
      onRecord: async (record) => {
        const loggedCount = await braintrustReporter.handle(record);
        if (loggedCount > 0 && verbose) {
          logger.log({
            category: "understudy_v4_code",
            message: `Logged ${loggedCount} new v4 event bus span to Braintrust`,
            level: 1,
          });
        }
      },
      warn: (message) => {
        logger.warn({
          category: "understudy_v4_code",
          message,
          level: 1,
        });
      },
    });
    const stopSideChannel = async (): Promise<void> => {
      await sideChannel.stop();
      if (
        braintrustReporter.enabled &&
        braintrustReporter.loggedCount > 0 &&
        verbose
      ) {
        logger.log({
          category: "understudy_v4_code",
          message: `Logged ${braintrustReporter.loggedCount} total v4 event bus spans to Braintrust`,
          level: 1,
        });
      }
    };
    const printV4BusLogTree = async (): Promise<void> => {
      if (!verbose || printedV4BusLogTree) return;
      printedV4BusLogTree = true;
      try {
        const logTree = await understudyV4Tools.stagehandV4.busLogTree({
          past: true,
          future: false,
        });
        logger.log({
          category: "understudy_v4_code",
          message: `v4 bus.logTree()\n${logTree}`,
          level: 1,
        });
      } catch (dashboardError) {
        logger.warn({
          category: "understudy_v4_code",
          message: `Unable to print v4 bus.logTree(): ${
            dashboardError instanceof Error
              ? dashboardError.message
              : String(dashboardError)
          }`,
          level: 1,
        });
      }
    };

    try {
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
        createAgent: false,
        agentMode: "dom",
        isCUA: false,
        verbose,
        configOverrides: {
          env: "LOCAL",
          localBrowserLaunchOptions: {
            cdpUrl: understudyV4Tools.cdpUrl,
          },
          experimental: true,
        },
      });
      stopV3FlowLoggerBraintrustReporting =
        installStagehandV3FlowLoggerBraintrustReporting({
          braintrustReporter,
          category: "understudy_v4_code",
          logger,
          v3: v3Result.v3,
          verbose,
        });
      const closeV3 = v3Result.v3.close.bind(v3Result.v3);
      v3Result.v3.close = async () => {
        stopV3FlowLoggerBraintrustReporting?.();
        stopV3FlowLoggerBraintrustReporting = undefined;
        await stopSideChannel();
        await printV4BusLogTree();
        return await closeV3();
      };

      await understudyV4Tools.stagehandV4.connect({
        cdp_url: understudyV4Tools.cdpUrl,
      });
      const v4Page = await activeStagehandV4Page(understudyV4Tools.stagehandV4);
      installStagehandV4Context(
        v3Result.v3,
        understudyV4Tools.stagehandV4,
        v4Page,
      );
      installStagehandV4AgentFactory(v3Result.v3, understudyV4Tools);

      if (createAgent) {
        v3Result.agent = v3Result.v3.agent({
          model: input.modelName,
        }) as AgentInstance;
      }

      const ctx: BenchHarnessContext = {
        harness: "stagehand_v4",
        row,
        logger,
        v3: v3Result.v3,
        v4: understudyV4Tools.stagehandV4,
        agent: v3Result.agent,
        page: v4Page as unknown as Page,
        debugUrl: v3Result.debugUrl ?? "",
        onTaskStart: async () => {
          await braintrustReporter.attachCurrentSpan();
          await sideChannel.start();
        },
        sessionUrl: v3Result.sessionUrl ?? "",
      };

      return {
        ctx,
        cleanup: async () => {
          await stopSideChannel();
          await printV4BusLogTree();
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
          await understudyV4Tools.cleanup();
        },
      };
    } catch (error) {
      stopV3FlowLoggerBraintrustReporting?.();
      await stopSideChannel();
      if (v3Result?.v3) await v3Result.v3.close().catch(() => {});
      await understudyV4Tools.cleanup().catch(() => {});
      throw error;
    }
  },
};

function installStagehandV4AgentFactory(
  v3: V3,
  understudyV4Tools: {
    toolCatalog: UnderstudyV4ToolDefinition[];
    tools: Record<string, unknown>;
  },
): void {
  const createAgent = v3.agent.bind(v3);
  v3.agent = ((options?: AgentOptions) => {
    const agent = createAgent({
      ...(options ?? {}),
      mode: "dom",
      tools: understudyV4Tools.tools,
      systemPrompt: joinPromptParts(
        typeof options?.systemPrompt === "string"
          ? options.systemPrompt
          : undefined,
        buildStagehandAgentV4SystemPrompt(understudyV4Tools.toolCatalog),
      ),
    } as AgentOptions) as AgentInstance;
    return wrapStagehandV4OnlyAgent(agent);
  }) as V3["agent"];
}

function wrapStagehandV4OnlyAgent(agent: AgentInstance): AgentInstance {
  const execute = agent.execute.bind(agent);
  agent.execute = (async (options: unknown) =>
    await execute(
      withV4OnlyExecuteOptions(options),
    )) as AgentInstance["execute"];
  return agent;
}

function withV4OnlyExecuteOptions(options: unknown): unknown {
  const excludeTools = [...V3_DEFAULT_AGENT_TOOL_NAMES];
  if (typeof options === "string") {
    return {
      instruction: options,
      excludeTools,
    };
  }
  if (isRecord(options)) {
    return {
      ...options,
      excludeTools: [
        ...new Set([...excludeTools, ...readStringArray(options.excludeTools)]),
      ],
    };
  }
  return {
    instruction: "",
    excludeTools,
  };
}

function buildStagehandAgentV4SystemPrompt(
  toolCatalog: UnderstudyV4ToolDefinition[],
): string {
  return [
    "You are using Stagehand v4 SDK browser tools through the existing v3 agent loop.",
    "The callable tool schemas and tool descriptions are the source of truth. Use the v4 inputs and outputs as-is.",
    "Do not assume older v3 selector, DOM summary, action, or extraction shapes.",
    "",
    "Available v4 tools:",
    ...toolCatalog.map((definition) => {
      const name =
        typeof definition.name === "string" ? definition.name : "unknown";
      const description =
        typeof definition.description === "string"
          ? definition.description
          : name;
      return `- ${name}: ${description}`;
    }),
  ].join("\n");
}

function installStagehandV4Context(
  v3: V3,
  stagehandV4: UnderstudyV4NativeRuntime,
  initialPage: Record<string, unknown>,
): void {
  let pages = [initialPage];
  const context = v3.context as unknown as Record<string, unknown>;
  context.pages = () => pages;
  context.awaitActivePage = async () => {
    const page = await activeStagehandV4Page(stagehandV4);
    pages = [page];
    return page;
  };
}

async function activeStagehandV4Page(
  stagehandV4: UnderstudyV4NativeRuntime,
): Promise<Record<string, unknown>> {
  const active = await stagehandV4.browser
    .activePage({})
    .catch((): null => null);
  if (isRecord(active) && !isInternalPage(active)) return active;

  const pages = await stagehandV4.browser
    .pages({})
    .catch((): Record<string, unknown>[] => []);
  const page =
    pages.find((candidate) => !isInternalPage(candidate)) ?? pages[0];
  if (isRecord(page)) return page;
  return (await stagehandV4.browser.newPage({})) as Record<string, unknown>;
}

function isInternalPage(page: Record<string, unknown>): boolean {
  const url = typeof page.url === "string" ? page.url : undefined;
  return (
    url == null ||
    url === "about:blank" ||
    /^chrome(?:-[a-z]+)?:\/\//u.test(url)
  );
}

function joinPromptParts(...parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
