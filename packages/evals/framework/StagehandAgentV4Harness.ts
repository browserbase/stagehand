import {
  getAISDKLanguageModel,
  type AgentInstance,
  type LLMClient,
  type LocalBrowserLaunchOptions,
  type V3,
} from "@browserbasehq/stagehand";
import { z } from "zod";
import { AISdkClientWrapped } from "../lib/AISdkClientWrapped.js";
import { endBrowserbaseSession } from "../browserbaseCleanup.js";
import { EvalsError } from "../errors.js";
import type { V3InitResult } from "../initV3.js";
import {
  startUnderstudyV4Tools,
  type UnderstudyV4NativeRuntime,
} from "./UnderstudyV4Tools.js";
import type {
  BenchHarness,
  BenchHarnessStartInput,
  BenchHarnessContext,
  StartedBenchHarness,
} from "./benchHarness.js";

type Page = ReturnType<V3["context"]["pages"]>[number];

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

    // This is intentionally still the v3 agent loop. The v4 part is the SDK
    // launcher/tool catalog/dispatch surface that replaces the v3 agent tools.
    const createAgent = isAgentTask(task);
    const understudyV4Tools = await startUnderstudyV4Tools({
      environment: row.config.environment,
      logger,
    });
    let v3Result: V3InitResult | undefined;
    let printedV4BusLogTree = false;
    const printV4BusLogTree = async (): Promise<void> => {
      if (!verbose || printedV4BusLogTree) return;
      printedV4BusLogTree = true;
      try {
        const result = (await understudyV4Tools.stagehandV4.cdp.Mod.evaluate({
          expression: `async () => {
            const readLogTree = globalThis.__stagehandBusLogTree;
            if (typeof readLogTree !== "function") {
              return { error: "globalThis.__stagehandBusLogTree is not available" };
            }
            return await readLogTree(params.stagehand_session_id);
          }`,
          params: {
            stagehand_session_id: understudyV4Tools.stagehand_session_id,
          },
        })) as { error?: unknown; logTree?: unknown };
        logger.log({
          category: "understudy_v4_code",
          message:
            typeof result.logTree === "string"
              ? `v4 bus.logTree()\n${result.logTree}`
              : `v4 bus.logTree() unavailable: ${String(
                  result.error ?? "Mod.evaluate did not return logTree.",
                )}`,
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

      const localBrowserLaunchOptions = {
        cdpUrl: understudyV4Tools.cdpUrl,
      } satisfies Partial<LocalBrowserLaunchOptions>;
      const { initV3 } = await import("../initV3.js");
      v3Result = await initV3({
        logger,
        llmClient,
        modelName: input.modelName,
        createAgent: false,
        agentMode: row.config.agentMode ?? input.agentMode,
        isCUA: row.config.isCUA ?? input.isCUA,
        verbose,
        configOverrides: {
          env: "LOCAL",
          localBrowserLaunchOptions,
          experimental: true,
        },
      });
      const closeV3 = v3Result.v3.close.bind(v3Result.v3);
      v3Result.v3.close = async () => {
        await printV4BusLogTree();
        return await closeV3();
      };
      const v4Page = await installStagehandV4BenchFacade(
        v3Result.v3,
        understudyV4Tools.stagehandV4,
      );

      if (createAgent) {
        v3Result.agent = v3Result.v3.agent({
          model: input.modelName,
          mode: "dom",
          tools: understudyV4Tools.tools,
          systemPrompt: buildStagehandAgentV4SystemPrompt(
            understudyV4Tools.toolCatalog,
          ),
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
        sessionUrl: v3Result.sessionUrl ?? "",
      };

      return {
        ctx,
        cleanup: async () => {
          await printV4BusLogTree();
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
      if (v3Result?.v3) await v3Result.v3.close().catch(() => {});
      await understudyV4Tools.cleanup().catch(() => {});
      throw error;
    }
  },
};

function buildStagehandAgentV4SystemPrompt(
  toolCatalog: Record<string, unknown>[],
): string {
  return [
    "You are using Stagehand v4 protocol tools through the existing Stagehand agent loop.",
    "The callable tool schemas are the source of truth. They are v4 event payload schemas, not the older v3 agent wrapper schemas.",
    "",
    "Selector rules:",
    "- Selectors are partial hints. You may pass only elementId, only xpath, only css, only text, only coordinates, or any useful subset.",
    "- The browser hydrates selectors before use, so do not invent missing selector fields.",
    "- Prefer elementId from the page summary tree when it is available. Coordinates are valid when they are the clearest available selector.",
    "- Deep XPath can pierce frames and shadow roots, for example /body/div[3]/iframe[2]/body/iframe[2]/button.",
    "",
    "Page context:",
    "- Use the derived page summary tool to get current DOM/accessibility context and element ids.",
    "- Use the derived screenshot tool when visual confirmation or coordinates are needed.",
    "- When you already have a selector and a concrete operation, prefer the direct browser action tool for that operation.",
    "- If you use act with an action object, follow the action schema exactly.",
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

async function installStagehandV4BenchFacade(
  v3: V3,
  stagehandV4: UnderstudyV4NativeRuntime,
): Promise<Record<string, unknown>> {
  const pageState: {
    targetId?: string;
    title: string;
    url: string;
  } = {
    title: "",
    url: "about:blank",
  };

  const refreshPageInfo = async (): Promise<void> => {
    const info = unwrapStagehandV4Result(
      await stagehandV4.cdp.Stagehand.BrowserPageRequestInfo({
        ...(pageState.targetId != null ? { targetId: pageState.targetId } : {}),
      }),
    );
    if (!isRecord(info)) return;
    if (typeof info.targetId === "string") pageState.targetId = info.targetId;
    if (typeof info.title === "string") pageState.title = info.title;
    if (typeof info.url === "string") pageState.url = info.url;
  };

  await refreshPageInfo().catch(() => {});

  const updatePageStateFromBrowserEvent = (event: unknown): void => {
    if (!isRecord(event)) return;
    if (typeof event.targetId === "string") pageState.targetId = event.targetId;
    if (typeof event.url === "string") pageState.url = event.url;
  };
  stagehandV4.cdp.on(
    "Stagehand.BrowserPageNavigated",
    updatePageStateFromBrowserEvent,
  );
  stagehandV4.cdp.on(
    "Stagehand.BrowserPageLoaded",
    updatePageStateFromBrowserEvent,
  );

  const page = createStagehandV4PageFacade(
    stagehandV4,
    pageState,
    refreshPageInfo,
  );
  const pages = (): Record<string, unknown>[] => [page];

  const context = v3.context as unknown as Record<string, unknown>;
  context.pages = pages;
  context.awaitActivePage = async () => {
    await refreshPageInfo();
    return page;
  };

  v3.observe = (async (
    a?: string | Record<string, unknown>,
    b?: Record<string, unknown>,
  ) => {
    const instruction = typeof a === "string" ? a : undefined;
    const options = (typeof a === "string" ? b : a) as
      | Record<string, unknown>
      | undefined;
    const result = await stagehandV4.cdp.Stagehand.AIObserve({
      ...(instruction != null ? { instruction } : {}),
      ...selectorParam(options),
      ...workflowOptionsParam(options),
    });
    const observed = unwrapStagehandV4Result(result);
    return Array.isArray(observed) ? observed : [];
  }) as V3["observe"];

  v3.act = (async (
    input: string | Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => {
    const result = await stagehandV4.cdp.Stagehand.AIAct(
      typeof input === "string"
        ? {
            instruction: input,
            ...workflowOptionsParam(options),
          }
        : {
            action: normalizeV4Action(input),
            ...workflowOptionsParam(options),
          },
    );
    const unwrapped = unwrapStagehandV4Result(result);
    await refreshPageInfo().catch(() => {});
    return unwrapped;
  }) as V3["act"];

  v3.extract = (async (
    a?: string | Record<string, unknown>,
    b?: z.ZodType | Record<string, unknown>,
    c?: Record<string, unknown>,
  ) => {
    const instruction = typeof a === "string" ? a : undefined;
    const schema = isZodSchema(b) ? z.toJSONSchema(b) : undefined;
    const options = (typeof a === "string" ? (isZodSchema(b) ? c : b) : a) as
      | Record<string, unknown>
      | undefined;
    const result = await stagehandV4.cdp.Stagehand.AIExtract({
      ...(instruction != null ? { instruction } : {}),
      ...(schema != null ? { schema: schema as Record<string, unknown> } : {}),
      ...selectorParam(options),
      ...workflowOptionsParam(options),
    });
    return unwrapStagehandV4Result(result);
  }) as V3["extract"];

  return page;
}

function createStagehandV4PageFacade(
  stagehandV4: UnderstudyV4NativeRuntime,
  pageState: {
    targetId?: string;
    title: string;
    url: string;
  },
  refreshPageInfo: () => Promise<void>,
): Record<string, unknown> {
  return {
    async goto(url: string) {
      let timer: ReturnType<typeof setTimeout>;
      const loaded = new Promise<void>((resolve, reject) => {
        const onLoaded = (): void => {
          clearTimeout(timer);
          stagehandV4.cdp.off("Stagehand.BrowserPageLoaded", onLoaded);
          resolve();
        };
        timer = setTimeout(() => {
          stagehandV4.cdp.off("Stagehand.BrowserPageLoaded", onLoaded);
          reject(
            new Error("Timed out waiting for Stagehand.BrowserPageLoaded."),
          );
        }, 30_000);
        stagehandV4.cdp.on("Stagehand.BrowserPageLoaded", onLoaded);
      });
      const [rawResult] = await Promise.all([
        stagehandV4.cdp.Stagehand.BrowserPageGoto({
          url,
          selector:
            pageState.targetId != null
              ? { targetId: pageState.targetId }
              : { active: true },
        }),
        loaded,
      ]);
      const result = unwrapStagehandV4Result(rawResult);
      if (isRecord(result)) {
        if (typeof result.targetId === "string")
          pageState.targetId = result.targetId;
        if (typeof result.url === "string") pageState.url = result.url;
      }
      await refreshPageInfo();
      return {
        ok: () => true,
        status: () => 200,
        url: () => pageState.url,
      };
    },
    url() {
      return pageState.url;
    },
    async title() {
      await refreshPageInfo();
      return pageState.title;
    },
    async waitForLoadState() {
      await new Promise<void>((resolve, reject) => {
        const onLoaded = (): void => {
          clearTimeout(timer);
          stagehandV4.cdp.off("Stagehand.BrowserPageLoaded", onLoaded);
          resolve();
        };
        const timer = setTimeout(() => {
          stagehandV4.cdp.off("Stagehand.BrowserPageLoaded", onLoaded);
          reject(
            new Error("Timed out waiting for Stagehand.BrowserPageLoaded."),
          );
        }, 30_000);
        stagehandV4.cdp.on("Stagehand.BrowserPageLoaded", onLoaded);
      });
      await refreshPageInfo();
    },
    async evaluate(expressionOrFn: unknown, arg?: unknown) {
      const expression =
        typeof expressionOrFn === "function"
          ? `(${expressionOrFn.toString()})(...${JSON.stringify(arg === undefined ? [] : [arg])})`
          : String(expressionOrFn);
      const result = unwrapStagehandV4Result(
        await stagehandV4.cdp.Stagehand.BrowserPageEvaluate({
          ...(pageState.targetId != null
            ? { targetId: pageState.targetId }
            : {}),
          arg: isJsonValue(arg) ? arg : undefined,
          awaitPromise: true,
          expression,
          returnByValue: true,
        }),
      );
      return isRecord(result) && "value" in result ? result.value : result;
    },
    locator() {
      throw new Error(
        "stagehand_v4 evals must use v4 protocol actions instead of v3 page.locator().",
      );
    },
  };
}

function normalizeV4Action(
  action: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...action,
    selector: normalizeV4Selector(action.selector),
    method: typeof action.method === "string" ? action.method : null,
    arguments: Array.isArray(action.arguments) ? action.arguments : null,
  };
}

function selectorParam(
  options: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const selector = normalizeV4Selector(options?.selector);
  return selector == null ? {} : { selector };
}

function normalizeV4Selector(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value == null) return undefined;
  if (isRecord(value)) return value;
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (value.startsWith("xpath="))
    return { xpath: value.slice("xpath=".length) };
  if (value.startsWith("/") || value.startsWith("(")) return { xpath: value };
  return { css: value };
}

function workflowOptionsParam(
  options: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!options) return {};
  const workflowOptions: Record<string, unknown> = {};
  if (typeof options.timeout === "number")
    workflowOptions.timeout = options.timeout;
  if (isJsonValue(options.variables))
    workflowOptions.variables = options.variables;
  return Object.keys(workflowOptions).length === 0
    ? {}
    : { options: workflowOptions };
}

function unwrapStagehandV4Result(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (isRecord(value.event_results)) {
    for (const entry of Object.values(value.event_results)) {
      if (!isRecord(entry)) continue;
      if ("result" in entry) return entry.result;
    }
  }
  if ("result" in value) return value.result;
  return value;
}

function isZodSchema(value: unknown): value is z.ZodType {
  return isRecord(value) && typeof value.safeParse === "function";
}

function isJsonValue(value: unknown): boolean {
  if (value == null) return true;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
