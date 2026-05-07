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

function isInternalStagehandV4PageUrl(url: string | undefined): boolean {
  return (
    url == null ||
    url === "about:blank" ||
    /^chrome(?:-[a-z]+)?:\/\//u.test(url)
  );
}

type StagehandV4PageState = {
  targetId?: string;
  title: string;
  url: string;
  loadState?: StagehandV4LoadState;
  frames: StagehandV4FrameState[];
};

type StagehandV4FrameState = {
  frameId: string;
  targetId?: string;
  url?: string;
};

type StagehandV4HistoryEntry = {
  method: string;
  parameters: unknown;
  result: unknown;
  timestamp: string;
};

const STAGEHAND_V4_PAGE_STATE = Symbol("stagehand_v4_page_state");

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
        input.modelName,
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
  modelName: string,
): Promise<Record<string, unknown>> {
  const pageState: StagehandV4PageState = {
    frames: [],
    title: "",
    url: "about:blank",
  };
  const history: StagehandV4HistoryEntry[] = [];
  const recordHistory = (
    method: string,
    parameters: unknown,
    result: unknown,
  ): void => {
    history.push({
      method,
      parameters,
      result,
      timestamp: new Date().toISOString(),
    });
  };
  const pageCache = new Map<string, Record<string | symbol, unknown>>();
  const pageOrder: string[] = [];

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
    if (info.loadState != null)
      pageState.loadState = normalizeStagehandV4LoadState(info.loadState);
    await refreshFrameStates(stagehandV4, pageState).catch(() => {});
  };

  const refreshPages = async (): Promise<Record<string, unknown>[]> => {
    const rawPages = unwrapStagehandV4Result(
      await stagehandV4.cdp.Stagehand.BrowserRequestTabList({}),
    );
    const pages = Array.isArray(rawPages)
      ? rawPages.filter((page): page is Record<string, unknown> =>
          isRecord(page),
        )
      : [];
    for (const pageInfo of pages) {
      const targetId =
        typeof pageInfo.targetId === "string" ? pageInfo.targetId : null;
      if (targetId == null) continue;
      if (!pageOrder.includes(targetId)) pageOrder.push(targetId);
      let facade = pageCache.get(targetId);
      if (facade == null) {
        const state: StagehandV4PageState = {
          frames: [],
          targetId,
          title: "",
          url: "about:blank",
        };
        facade = createStagehandV4PageFacade(
          stagehandV4,
          state,
          async () => {
            await refreshSinglePageInfo(stagehandV4, state);
          },
          recordHistory,
        );
        pageCache.set(targetId, facade);
      }
      const state = facade[STAGEHAND_V4_PAGE_STATE];
      if (!isStagehandV4PageState(state)) continue;
      state.targetId = targetId;
      state.title =
        typeof pageInfo.title === "string" ? pageInfo.title : state.title;
      state.url = typeof pageInfo.url === "string" ? pageInfo.url : state.url;
      await refreshFrameStates(stagehandV4, state).catch(() => {});
    }
    return pageOrder
      .map((targetId) => pageCache.get(targetId))
      .filter((page): page is Record<string, unknown> => page != null);
  };

  await refreshPageInfo().catch(() => {});
  await refreshPages().catch(() => {});

  const page = createStagehandV4PageFacade(
    stagehandV4,
    pageState,
    refreshPageInfo,
    recordHistory,
  );
  if (pageState.targetId != null) {
    if (!pageOrder.includes(pageState.targetId))
      pageOrder.push(pageState.targetId);
    pageCache.set(pageState.targetId, page);
  }
  const pages = (): Record<string, unknown>[] => {
    const cached = pageOrder
      .map((targetId) => pageCache.get(targetId))
      .filter((entry): entry is Record<string, unknown> => entry != null);
    return cached.length > 0 ? cached : [page];
  };

  const context = v3.context as unknown as Record<string, unknown>;
  context.pages = pages;
  context.awaitActivePage = async () => {
    await refreshPages().catch(() => {});
    const activePage = unwrapStagehandV4Result(
      await stagehandV4.cdp.Stagehand.BrowserRequestActivePage({}),
    );
    if (isRecord(activePage) && typeof activePage.targetId === "string") {
      const cached = pageCache.get(activePage.targetId);
      if (cached != null) return cached;
    }
    await refreshPageInfo();
    return page;
  };
  Object.defineProperty(v3, "history", {
    configurable: true,
    get: () => Promise.resolve([...history]),
  });

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
      ...workflowOptionsParam(options, modelName),
    });
    const observed = unwrapStagehandV4Result(result);
    const output = Array.isArray(observed) ? observed : [];
    recordHistory("observe", { instruction, options }, output);
    return output;
  }) as V3["observe"];

  v3.act = (async (
    input: string | Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => {
    const workflowOptions = workflowOptionsParam(options, modelName);
    const result = await stagehandV4.cdp.Stagehand.AIAct(
      typeof input === "string"
        ? {
            instruction: input,
            ...selectorParam(options),
            ...workflowOptions,
          }
        : {
            action: normalizeV4Action(input),
            ...selectorParam(options),
            ...workflowOptions,
            options: {
              ...(isRecord(workflowOptions.options)
                ? workflowOptions.options
                : {}),
              selfHeal: true,
            },
          },
    );
    const unwrapped = unwrapStagehandV4Result(result);
    await refreshPageInfo().catch(() => {});
    await refreshPages().catch(() => {});
    recordHistory(
      "act",
      typeof input === "string"
        ? { instruction: input, options }
        : { action: input, options },
      unwrapped,
    );
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
    if (instruction == null && schema == null) {
      const summary = unwrapStagehandV4Result(
        await stagehandV4.cdp.Stagehand.BrowserPageDOMSummary({
          ...selectorParam(options),
        }),
      );
      const pageText =
        isRecord(summary) && typeof summary.pageText === "string"
          ? summary.pageText
          : "";
      return { pageText, extraction: pageText };
    }
    const result = await stagehandV4.cdp.Stagehand.AIExtract({
      ...(instruction != null ? { instruction } : {}),
      ...(schema != null ? { schema: schema as Record<string, unknown> } : {}),
      ...selectorParam(options),
      ...workflowOptionsParam(options, modelName),
    });
    const extracted = unwrapStagehandV4Result(result);
    recordHistory("extract", { instruction, schema, options }, extracted);
    return extracted;
  }) as V3["extract"];

  return page;
}

function createStagehandV4PageFacade(
  stagehandV4: UnderstudyV4NativeRuntime,
  pageState: StagehandV4PageState,
  refreshPageInfo: () => Promise<void>,
  recordHistory?: (
    method: string,
    parameters: unknown,
    result: unknown,
  ) => void,
): Record<string, unknown> {
  return {
    [STAGEHAND_V4_PAGE_STATE]: pageState,
    async goto(url: string, options?: unknown) {
      pageState.loadState = "init";
      const selector =
        pageState.targetId != null
          ? { targetId: pageState.targetId }
          : { active: true };
      if (!("targetId" in selector)) {
        delete pageState.targetId;
      }
      const waitUntil =
        isRecord(options) && "waitUntil" in options
          ? options.waitUntil
          : undefined;
      const rawResult = await stagehandV4.cdp.Stagehand.BrowserPageGoto({
        url,
        selector,
        waitUntil: normalizeStagehandV4LoadState(waitUntil),
      });
      const result = unwrapStagehandV4Result(rawResult);
      if (isRecord(result)) {
        if (typeof result.targetId === "string")
          pageState.targetId = result.targetId;
        if (typeof result.url === "string") pageState.url = result.url;
      }
      await refreshPageInfo();
      const response = {
        ok: () => true,
        status: () => 200,
        url: () => pageState.url,
      };
      recordHistory?.("navigate", { url, options }, result);
      return response;
    },
    url() {
      return pageState.url;
    },
    async title() {
      await refreshPageInfo();
      return pageState.title;
    },
    frames() {
      return pageState.frames.map((frameState) =>
        createStagehandV4FrameFacade(stagehandV4, frameState),
      );
    },
    async waitForLoadState(state?: unknown, options?: unknown) {
      await waitForStagehandV4LoadState(
        stagehandV4,
        pageState,
        state,
        loadStateTimeoutMs(options),
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

function createStagehandV4FrameFacade(
  stagehandV4: UnderstudyV4NativeRuntime,
  frameState: StagehandV4FrameState,
): Record<string, unknown> {
  return {
    async evaluate(expressionOrFn: unknown, arg?: unknown) {
      const expression =
        typeof expressionOrFn === "function"
          ? `(${expressionOrFn.toString()})(...${JSON.stringify(arg === undefined ? [] : [arg])})`
          : String(expressionOrFn);
      const result = unwrapStagehandV4Result(
        await stagehandV4.cdp.Stagehand.BrowserPageEvaluate({
          ...(frameState.targetId != null
            ? { targetId: frameState.targetId }
            : {}),
          arg: isJsonValue(arg) ? arg : undefined,
          awaitPromise: true,
          expression,
          frameId: frameState.frameId,
          returnByValue: true,
        }),
      );
      return isRecord(result) && "value" in result ? result.value : result;
    },
    url() {
      return frameState.url ?? "about:blank";
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
      const frameId = await resolveStagehandV4FrameLocator(
        stagehandV4,
        pageState,
        frameSelectors,
      );
      const result = unwrapStagehandV4Result(
        await stagehandV4.cdp.Stagehand.BrowserPageEvaluate({
          ...(pageState.targetId != null
            ? { targetId: pageState.targetId }
            : {}),
          arg: isJsonValue(arg) ? arg : undefined,
          awaitPromise: true,
          expression,
          ...(frameId != null ? { frameId } : {}),
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
  frameSelectors: unknown[] = [],
): Record<string, unknown> {
  const read = async () =>
    await requestStagehandV4ElementInfo(
      stagehandV4,
      pageState,
      selector,
      frameSelectors,
    );
  return {
    first() {
      return createStagehandV4LocatorFacade(
        stagehandV4,
        pageState,
        selector,
        frameSelectors,
      );
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
        selector: await stagehandV4SelectorFor(
          stagehandV4,
          pageState,
          selector,
          frameSelectors,
        ),
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
  frameSelectors: unknown[] = [],
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
      selector: await stagehandV4SelectorFor(
        stagehandV4,
        pageState,
        selector,
        frameSelectors,
      ),
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

async function refreshSinglePageInfo(
  stagehandV4: UnderstudyV4NativeRuntime,
  pageState: StagehandV4PageState,
): Promise<void> {
  const info = unwrapStagehandV4Result(
    await stagehandV4.cdp.Stagehand.BrowserPageRequestInfo({
      ...(pageState.targetId != null ? { targetId: pageState.targetId } : {}),
    }),
  );
  if (!isRecord(info)) return;
  if (typeof info.targetId === "string") pageState.targetId = info.targetId;
  if (typeof info.title === "string") pageState.title = info.title;
  if (typeof info.url === "string") pageState.url = info.url;
  if (info.loadState != null)
    pageState.loadState = normalizeStagehandV4LoadState(info.loadState);
  await refreshFrameStates(stagehandV4, pageState);
}

async function refreshFrameStates(
  stagehandV4: UnderstudyV4NativeRuntime,
  pageState: StagehandV4PageState,
): Promise<void> {
  if (pageState.targetId == null || isInternalStagehandV4PageUrl(pageState.url))
    return;
  const rawFrameTree = unwrapStagehandV4Result(
    await stagehandV4.cdp.Stagehand.BrowserPageRequestFullFrameTree({
      targetId: pageState.targetId,
    }),
  );
  if (!isRecord(rawFrameTree) || !isRecord(rawFrameTree.frameTree)) return;
  const frames: StagehandV4FrameState[] = [];
  collectStagehandV4Frames(rawFrameTree.frameTree, pageState.targetId, frames);
  pageState.frames = frames;
}

function collectStagehandV4Frames(
  frameTree: Record<string, unknown>,
  targetId: string,
  frames: StagehandV4FrameState[],
): void {
  const frame = isRecord(frameTree.frame) ? frameTree.frame : null;
  if (frame != null && typeof frame.id === "string") {
    frames.push({
      frameId: frame.id,
      targetId,
      url: typeof frame.url === "string" ? frame.url : undefined,
    });
  }
  const childFrames = Array.isArray(frameTree.childFrames)
    ? frameTree.childFrames
    : [];
  for (const childFrame of childFrames) {
    if (isRecord(childFrame)) {
      collectStagehandV4Frames(childFrame, targetId, frames);
    }
  }
}

async function stagehandV4SelectorFor(
  stagehandV4: UnderstudyV4NativeRuntime,
  pageState: StagehandV4PageState,
  selector: unknown,
  frameSelectors: unknown[] = [],
): Promise<Record<string, unknown>> {
  if (pageState.targetId == null) {
    await refreshSinglePageInfo(stagehandV4, pageState).catch(() => {});
  }
  const frameId = await resolveStagehandV4FrameLocator(
    stagehandV4,
    pageState,
    frameSelectors,
  );
  return {
    ...normalizeV4Selector(selector),
    ...(pageState.targetId != null ? { targetId: pageState.targetId } : {}),
    ...(frameId != null ? { frameId } : {}),
  };
}

async function resolveStagehandV4FrameLocator(
  stagehandV4: UnderstudyV4NativeRuntime,
  pageState: StagehandV4PageState,
  frameSelectors: unknown[],
): Promise<string | undefined> {
  if (frameSelectors.length === 0) return undefined;
  if (pageState.targetId == null) {
    await refreshSinglePageInfo(stagehandV4, pageState).catch(() => {});
  }
  let frameId: string | undefined;
  for (const frameSelector of frameSelectors) {
    const selector = {
      ...normalizeV4Selector(frameSelector),
      ...(pageState.targetId != null ? { targetId: pageState.targetId } : {}),
      ...(frameId != null ? { frameId } : {}),
    };
    const located = unwrapStagehandV4Result(
      await stagehandV4.cdp.Stagehand.BrowserPageLocate({ selector }).catch(
        (error: unknown): never => {
          throw new Error(
            `stagehand_v4 frameLocator could not locate ${JSON.stringify(selector)}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        },
      ),
    );
    if (!isRecord(located)) {
      throw new Error(
        "stagehand_v4 frameLocator could not resolve iframe selector.",
      );
    }
    const summary = unwrapStagehandV4Result(
      await stagehandV4.cdp.Stagehand.BrowserPageDOMSummary({
        hydrate: { ax: false },
        selector: {
          ...(pageState.targetId != null
            ? { targetId: pageState.targetId }
            : {}),
        },
      }),
    );
    frameId = childFrameIdForLocatedFrameOwner(summary, located);
  }
  return frameId;
}

function childFrameIdForLocatedFrameOwner(
  summary: unknown,
  located: Record<string, unknown>,
): string {
  const frameGraph = isRecord(summary) ? summary.frameGraph : null;
  if (!isRecord(frameGraph) || !isRecord(frameGraph.ownerChainByFrameId)) {
    throw new Error(
      "stagehand_v4 frameLocator could not read the frame graph.",
    );
  }
  const backendNodeId =
    typeof located.backendNodeId === "number" ? located.backendNodeId : null;
  const ownerFrameId =
    typeof located.frameId === "string" ? located.frameId : null;
  if (backendNodeId == null || ownerFrameId == null) {
    throw new Error(
      "stagehand_v4 frameLocator resolved selector without a frame owner.",
    );
  }
  for (const [candidateFrameId, chain] of Object.entries(
    frameGraph.ownerChainByFrameId,
  )) {
    if (!Array.isArray(chain)) continue;
    const owner = chain.at(-1);
    if (
      isRecord(owner) &&
      owner.backendNodeId === backendNodeId &&
      owner.frameId === ownerFrameId
    ) {
      return candidateFrameId;
    }
  }
  throw new Error("stagehand_v4 frameLocator could not find a child frame.");
}

async function waitForStagehandV4LoadState(
  stagehandV4: UnderstudyV4NativeRuntime,
  pageState: StagehandV4PageState,
  state: unknown,
  timeoutMs: number,
): Promise<void> {
  const expectedState = normalizeStagehandV4LoadState(state);
  const deadline = Date.now() + timeoutMs;
  while (true) {
    await refreshSinglePageInfo(stagehandV4, pageState).catch(() => {});
    if (
      pageState.loadState != null &&
      STAGEHAND_V4_LOAD_STATE_ORDER[pageState.loadState] >=
        STAGEHAND_V4_LOAD_STATE_ORDER[expectedState]
    ) {
      return;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        `Timed out waiting for stagehand_v4 page loadState=${expectedState}.`,
      );
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(100, remainingMs)),
    );
  }
}

function normalizeStagehandV4LoadState(state: unknown): StagehandV4LoadState {
  if (state == null || state === "load" || state === "loaded") return "loaded";
  if (state === "networkalmostidle") return "networkidle2";
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
    if (method === "fill") {
      args = { value: first ?? "" };
    } else if (method === "type") {
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
  const pageSelector = stagehandV4PageSelector(options?.page);
  const selector = normalizeV4Selector(options?.selector);
  const mergedSelector =
    pageSelector == null && selector == null
      ? undefined
      : {
          ...(pageSelector ?? {}),
          ...(selector ?? {}),
        };
  return mergedSelector == null ? {} : { selector: mergedSelector };
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
  return {
    css: value
      .split(/\s*>>\s*/u)
      .filter(Boolean)
      .join(" "),
  };
}

function stagehandV4PageSelector(
  page: unknown,
): Record<string, unknown> | undefined {
  if (page == null) return undefined;
  const state = (page as Record<symbol, unknown>)[STAGEHAND_V4_PAGE_STATE];
  if (!isStagehandV4PageState(state) || state.targetId == null)
    return undefined;
  return { targetId: state.targetId };
}

function isStagehandV4PageState(value: unknown): value is StagehandV4PageState {
  return (
    isRecord(value) &&
    Array.isArray(value.frames) &&
    typeof value.title === "string" &&
    typeof value.url === "string"
  );
}

function workflowOptionsParam(
  options: Record<string, unknown> | undefined,
  modelName: string,
): Record<string, unknown> {
  const workflowOptions: Record<string, unknown> = { model: modelName };
  if (typeof options?.timeout === "number")
    workflowOptions.timeout = options.timeout;
  if (options != null && isJsonValue(options.variables))
    workflowOptions.variables = options.variables;
  if (isRecord(options?.model)) workflowOptions.model = options.model;
  if (typeof options?.model === "string") workflowOptions.model = options.model;
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
