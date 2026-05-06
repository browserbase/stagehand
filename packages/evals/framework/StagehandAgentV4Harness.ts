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
type StagehandV4LoadState =
  | "init"
  | "domcontentloaded"
  | "loaded"
  | "networkidle2"
  | "networkidle";

const STAGEHAND_V4_LOAD_STATE_ORDER: Record<StagehandV4LoadState, number> = {
  init: 0,
  domcontentloaded: 1,
  loaded: 2,
  networkidle2: 3,
  networkidle: 4,
};

type StagehandV4PageState = {
  targetId?: string;
  title: string;
  url: string;
  loadState?: StagehandV4LoadState;
};

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
  const pageState: StagehandV4PageState = {
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
    updatePageStateFromStagehandV4Event(pageState, event);
  };
  const updatePageStateFromNavigationEvent = (event: unknown): void => {
    updatePageStateFromStagehandV4Event(pageState, event);
    pageState.loadState = "init";
  };
  stagehandV4.cdp.on(
    "Stagehand.BrowserPageNavigated",
    updatePageStateFromNavigationEvent,
  );
  stagehandV4.cdp.on(
    "Stagehand.BrowserPageLoadStateChanged",
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
    if (schema == null) {
      const summary = unwrapStagehandV4Result(
        await stagehandV4.cdp.Stagehand.BrowserPageDOMSummary({
          ...selectorParam(options),
        }),
      );
      const pageText =
        isRecord(summary) && typeof summary.pageText === "string"
          ? summary.pageText
          : "";
      return { extraction: pageText, pageText };
    }
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
  pageState: StagehandV4PageState,
  refreshPageInfo: () => Promise<void>,
): Record<string, unknown> {
  return {
    async goto(url: string, options?: unknown) {
      pageState.loadState = "init";
      const loaded = waitForStagehandV4LoadState(
        stagehandV4,
        pageState,
        isRecord(options) && "waitUntil" in options
          ? options.waitUntil
          : undefined,
        loadStateTimeoutMs(options),
        false,
      );
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
    async waitForLoadState(state?: unknown, options?: unknown) {
      await waitForStagehandV4LoadState(
        stagehandV4,
        pageState,
        state,
        loadStateTimeoutMs(options),
        true,
      );
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
    locator(selector: unknown) {
      return createStagehandV4LocatorFacade(stagehandV4, pageState, selector);
    },
    frameLocator(selector: unknown) {
      return createStagehandV4FrameLocatorFacade(stagehandV4, pageState, [
        selector,
      ]);
    },
  };
}

function createStagehandV4FrameLocatorFacade(
  stagehandV4: UnderstudyV4NativeRuntime,
  pageState: StagehandV4PageState,
  frameSelectors: unknown[],
): Record<string, unknown> {
  return {
    frameLocator(selector: unknown) {
      return createStagehandV4FrameLocatorFacade(stagehandV4, pageState, [
        ...frameSelectors,
        selector,
      ]);
    },
    locator(selector: unknown) {
      return createStagehandV4LocatorFacade(stagehandV4, pageState, selector);
    },
    async evaluate(expressionOrFn: unknown, arg?: unknown) {
      const expression =
        typeof expressionOrFn === "function"
          ? `(${expressionOrFn.toString()})(...${JSON.stringify(arg === undefined ? [] : [arg])})`
          : String(expressionOrFn);
      if (frameSelectors.length > 0) {
        throw new Error(
          "stagehand_v4 frameLocator.evaluate is not implemented by the v4 protocol-backed eval facade yet.",
        );
      }
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
  };
}

function createStagehandV4LocatorFacade(
  stagehandV4: UnderstudyV4NativeRuntime,
  pageState: StagehandV4PageState,
  selector: unknown,
): Record<string, unknown> {
  const read = async () =>
    await requestStagehandV4ElementInfo(stagehandV4, pageState, selector);
  return {
    first() {
      return createStagehandV4LocatorFacade(stagehandV4, pageState, selector);
    },
    async inputValue() {
      return (await read()).inputValue ?? "";
    },
    async isChecked() {
      return Boolean((await read()).checked);
    },
    async textContent() {
      return (await read()).textContent ?? null;
    },
    async innerText() {
      const info = await read();
      return info.innerText ?? info.textContent ?? "";
    },
    async innerHtml() {
      return (await read()).innerHTML ?? "";
    },
    async innerHTML() {
      return (await read()).innerHTML ?? "";
    },
    async click() {
      await stagehandV4.cdp.Stagehand.BrowserPageClick({
        selector: stagehandV4SelectorFor(pageState, selector),
      });
    },
    async backendNodeId() {
      return (await read()).backendNodeId;
    },
  };
}

async function requestStagehandV4ElementInfo(
  stagehandV4: UnderstudyV4NativeRuntime,
  pageState: StagehandV4PageState,
  selector: unknown,
): Promise<{
  backendNodeId: number;
  checked?: boolean | null;
  innerHTML?: string | null;
  innerText?: string | null;
  inputValue?: string | null;
  textContent?: string | null;
}> {
  const result = unwrapStagehandV4Result(
    await stagehandV4.cdp.Stagehand.BrowserPageRequestElementInfo({
      selector: stagehandV4SelectorFor(pageState, selector),
    }),
  );
  if (isRecord(result) && typeof result.backendNodeId === "number") {
    return result as {
      backendNodeId: number;
      checked?: boolean | null;
      innerHTML?: string | null;
      innerText?: string | null;
      inputValue?: string | null;
      textContent?: string | null;
    };
  }
  throw new Error("stagehand_v4 locator could not resolve element info.");
}

function stagehandV4SelectorFor(
  pageState: StagehandV4PageState,
  selector: unknown,
): Record<string, unknown> {
  return {
    ...normalizeV4Selector(selector),
    ...(pageState.targetId != null ? { targetId: pageState.targetId } : {}),
  };
}

async function waitForStagehandV4LoadState(
  stagehandV4: UnderstudyV4NativeRuntime,
  pageState: StagehandV4PageState,
  state: unknown,
  timeoutMs: number,
  acceptCurrentState: boolean,
): Promise<void> {
  const expectedState = normalizeStagehandV4LoadState(state);
  if (
    acceptCurrentState &&
    pageState.loadState != null &&
    STAGEHAND_V4_LOAD_STATE_ORDER[pageState.loadState] >=
      STAGEHAND_V4_LOAD_STATE_ORDER[expectedState]
  ) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onLoadStateChanged = (event: unknown): void => {
      const eventTargetId = targetIdFromStagehandV4Event(event);
      if (
        eventTargetId != null &&
        pageState.targetId != null &&
        eventTargetId !== pageState.targetId
      ) {
        return;
      }
      updatePageStateFromStagehandV4Event(pageState, event);
      if (
        pageState.loadState != null &&
        STAGEHAND_V4_LOAD_STATE_ORDER[pageState.loadState] >=
          STAGEHAND_V4_LOAD_STATE_ORDER[expectedState]
      ) {
        clearTimeout(timer);
        stagehandV4.cdp.off(
          "Stagehand.BrowserPageLoadStateChanged",
          onLoadStateChanged,
        );
        resolve();
      }
    };
    const timer = setTimeout(() => {
      stagehandV4.cdp.off(
        "Stagehand.BrowserPageLoadStateChanged",
        onLoadStateChanged,
      );
      reject(
        new Error(
          `Timed out waiting for Stagehand.BrowserPageLoadStateChanged(${expectedState}).`,
        ),
      );
    }, timeoutMs);
    stagehandV4.cdp.on(
      "Stagehand.BrowserPageLoadStateChanged",
      onLoadStateChanged,
    );
  });
}

function updatePageStateFromStagehandV4Event(
  pageState: StagehandV4PageState,
  event: unknown,
): void {
  if (!isRecord(event)) return;
  const targetId = targetIdFromStagehandV4Event(event);
  if (targetId != null) pageState.targetId = targetId;
  if (typeof event.url === "string") pageState.url = event.url;
  if (isRecord(event.selector) && typeof event.selector.url === "string") {
    pageState.url = event.selector.url;
  }
  if (isStagehandV4LoadState(event.loadState)) {
    pageState.loadState = event.loadState;
  }
}

function targetIdFromStagehandV4Event(event: unknown): string | undefined {
  if (!isRecord(event)) return undefined;
  if (typeof event.targetId === "string") return event.targetId;
  if (isRecord(event.selector) && typeof event.selector.targetId === "string") {
    return event.selector.targetId;
  }
  return undefined;
}

function normalizeStagehandV4LoadState(state: unknown): StagehandV4LoadState {
  if (state == null || state === "load" || state === "loaded") return "loaded";
  if (isStagehandV4LoadState(state)) return state;
  throw new Error(`Unsupported stagehand_v4 waitForLoadState state: ${state}`);
}

function isStagehandV4LoadState(value: unknown): value is StagehandV4LoadState {
  return (
    value === "init" ||
    value === "domcontentloaded" ||
    value === "loaded" ||
    value === "networkidle2" ||
    value === "networkidle"
  );
}

function loadStateTimeoutMs(options: unknown): number {
  if (!isRecord(options)) return 30_000;
  const timeout = options.timeoutMs ?? options.timeout;
  return typeof timeout === "number" && Number.isFinite(timeout)
    ? Math.max(0, timeout)
    : 30_000;
}

function normalizeV4Action(
  action: Record<string, unknown>,
): Record<string, unknown> {
  const method =
    typeof action.method === "string"
      ? normalizeV4ActionMethod(action.method)
      : null;
  const selector = normalizeV4Selector(action.selector);
  let args: Record<string, unknown> = {};
  if (isRecord(action.arguments)) {
    args = action.arguments;
  } else if (Array.isArray(action.arguments)) {
    const positional = action.arguments.filter(
      (value): value is string => typeof value === "string",
    );
    const first = positional[0];
    if (method === "type") {
      args = { text: first ?? "" };
    } else if (method === "keys") {
      args = { key: first ?? "", method: "press" };
    } else if (method === "goto") {
      args = { url: first ?? "" };
    } else if (method === "wait") {
      const ms = Number(first);
      args = { ms: Number.isFinite(ms) ? ms : 1000 };
    } else if (method === "scroll" || method === "scrollTo") {
      const numberValue = first?.endsWith("%")
        ? Number.parseFloat(first)
        : Number(first);
      args = first?.includes("%")
        ? { percent: first }
        : method === "scroll"
          ? { deltaY: Number.isFinite(numberValue) ? numberValue : 0 }
          : { y: Number.isFinite(numberValue) ? numberValue : 0 };
    } else if (method === "dragAndDrop") {
      args = {
        from: selector,
        to: normalizeV4Selector(first) ?? selector,
      };
    }
  }
  return {
    ...action,
    selector,
    method,
    arguments: args,
  };
}

function normalizeV4ActionMethod(method: string): string {
  return method === "press" ? "keys" : method;
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
