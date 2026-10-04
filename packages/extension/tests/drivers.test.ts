import { trace } from "@opentelemetry/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, LLMGenerateResult } from "@browserbasehq/stagehand-protocol/types";
import type { CacheClient } from "../clients/cacheClient.js";
import {
  performUnderstudyMethod,
  waitForDomNetworkQuiet,
} from "../handlers/handlerUtils/actHandlerUtils.js";
import { StagehandLogger } from "../logger.js";
import * as actService from "../services/actService.js";
import {
  actOrFail,
  actWithFallback,
  extractOrFail,
  extractWithFallback,
  observeOrFail,
  observeWithFallback,
} from "../services/drivers/fallback.js";
import { decisionDrivers, llmDrivers } from "../services/drivers/index.js";
import type {
  ActDriver,
  ActHandoff,
  ActRequest,
  ActResolution,
  ExtractDriver,
  ExtractRequest,
  ObserveDriver,
  ObserveRequest,
} from "../services/drivers/types.js";
import * as extractService from "../services/extractService.js";
import * as observeService from "../services/observeService.js";
import type { Page } from "../understudy/page.js";

vi.mock("../handlers/handlerUtils/actHandlerUtils.js", () => ({
  performUnderstudyMethod: vi.fn(),
  waitForDomNetworkQuiet: vi.fn(),
}));

const performAction = vi.mocked(performUnderstudyMethod);
const waitForQuiet = vi.mocked(waitForDomNetworkQuiet);

// The services take any driver. These tests use hand-written ones: nothing here knows about
// language models or decision models, which is the point of the seam.

const OPEN: Action = {
  selector: "xpath=/menu",
  description: "menu",
  method: "click",
  arguments: [],
};
const PICK: Action = {
  selector: "xpath=/item",
  description: "item",
  method: "click",
  arguments: [],
};

function done(action: Action, extra: Partial<Extract<ActResolution, { kind: "resolved" }>> = {}) {
  return {
    kind: "resolved" as const,
    result: {
      success: true,
      message: "ok",
      actionDescription: action.description,
      actions: [action],
    },
    path: "fake",
    cacheable: true,
    ...extra,
  };
}

function abstain(reason: string, handoff: Partial<ActHandoff> = {}) {
  return {
    kind: "abstained" as const,
    reason,
    handoff: { priorActions: [], cacheable: true, ...handoff },
  };
}

function actDriver(
  name: string,
  resolve: ActDriver["resolve"],
  extra: Partial<ActDriver> = {},
): ActDriver & { resolve: ReturnType<typeof vi.fn<ActDriver["resolve"]>> } {
  return { name, startsBeforeSettle: false, ...extra, resolve: vi.fn(resolve) };
}

describe("act driver chains", () => {
  const request = {
    instruction: "open the menu and pick an item",
    logger: testLogger(),
  } as ActRequest;

  it("does not consult the fallback when the first driver resolves", async () => {
    const first = actDriver("first", async () => done(OPEN, { path: "first" }));
    const second = actDriver("second", async () => done(PICK));

    const resolution = await actWithFallback(first, second).resolve(request);

    expect(resolution).toMatchObject({ kind: "resolved", path: "first" });
    expect(second.resolve).not.toHaveBeenCalled();
  });

  it("hands over what the first driver did and keeps it in the result", async () => {
    const focus = (tree: string) => tree.slice(0, 4);
    const first = actDriver("first", async () =>
      abstain("not sure which item", { priorActions: [OPEN], cacheable: false, focus }),
    );
    const second = actDriver("second", async () => done(PICK, { path: "second" }));

    const chain = actWithFallback(first, second);
    const resolution = await chain.resolve(request);

    expect(chain.name).toBe("first+second");
    expect(second.resolve).toHaveBeenCalledWith(request, {
      priorActions: [OPEN],
      cacheable: false,
      focus,
    });
    expect(resolution).toMatchObject({
      kind: "resolved",
      path: "first+second",
      // The first driver proved something must not be cached; the chain keeps that.
      cacheable: false,
      result: { success: true, actions: [OPEN, PICK] },
    });
  });

  it("starts early and warms up exactly as its first driver does", () => {
    const prepare = vi.fn();
    const eager = actDriver("eager", async () => done(OPEN), { startsBeforeSettle: true, prepare });
    const lazy = actDriver("lazy", async () => done(PICK), { prepare: vi.fn() });

    const chain = actWithFallback(eager, lazy);
    chain.prepare?.(request);

    expect(chain.startsBeforeSettle).toBe(true);
    expect(actWithFallback(lazy, eager).startsBeforeSettle).toBe(false);
    expect(prepare).toHaveBeenCalledExactlyOnceWith(request);
    expect(lazy.prepare).not.toHaveBeenCalled();
  });

  it("counts each driver's actions once through nested chains", async () => {
    const third: Action = { ...PICK, selector: "xpath=/confirm", description: "confirm" };
    const a = actDriver("a", async () => abstain("a", { priorActions: [OPEN] }));
    const b = actDriver("b", async () => abstain("b", { priorActions: [PICK], cacheable: false }));
    const c = actDriver("c", async () => done(third, { path: "c" }));

    const resolution = await actWithFallback(a, actWithFallback(b, c)).resolve(request);

    expect(c.resolve.mock.calls[0]?.[1]?.priorActions).toStrictEqual([OPEN, PICK]);
    expect(resolution).toMatchObject({
      kind: "resolved",
      path: "a+b+c",
      cacheable: false,
      result: { actions: [OPEN, PICK, third] },
    });
  });

  it("stays an abstention when every driver abstains, carrying all prior actions", async () => {
    const a = actDriver("a", async () => abstain("a", { priorActions: [OPEN] }));
    const b = actDriver("b", async () => abstain("b gave up", { priorActions: [PICK] }));

    const resolution = await actWithFallback(a, b).resolve(request);

    expect(resolution).toStrictEqual({
      kind: "abstained",
      reason: "b gave up",
      handoff: { priorActions: [OPEN, PICK], cacheable: true, focus: undefined },
    });
  });

  it("reports each driver's actions once when a nested chain abstains throughout", async () => {
    const third: Action = { ...PICK, selector: "xpath=/confirm", description: "confirm" };
    const a = actDriver("a", async () => abstain("a", { priorActions: [OPEN] }));
    const b = actDriver("b", async () => abstain("b", { priorActions: [PICK] }));
    const c = actDriver("c", async () => abstain("c", { priorActions: [third] }));

    const resolution = await actOrFail(actWithFallback(a, actWithFallback(b, c))).resolve(request);

    expect(resolution).toMatchObject({
      kind: "resolved",
      result: { success: false, actions: [OPEN, PICK, third] },
    });
  });

  it("turns a lone driver's abstention into a failed act that keeps what already ran", async () => {
    const only = actDriver("only", async () =>
      abstain("no such control", { priorActions: [OPEN] }),
    );

    const resolution = await actOrFail(only).resolve(request);

    expect(resolution).toStrictEqual({
      kind: "resolved",
      result: {
        success: false,
        message: "Failed to perform act: the only driver abstained (no such control)",
        actionDescription: request.instruction,
        actions: [OPEN],
      },
      path: "only",
      cacheable: false,
    });
  });
});

describe("observe and extract driver chains", () => {
  const observeRequest = { logger: testLogger() } as ObserveRequest;
  const extractRequest = { logger: testLogger(), instruction: "the price" } as ExtractRequest;

  it("falls back for observe, or fails loudly without a fallback", async () => {
    const unsure: ObserveDriver = {
      name: "unsure",
      resolve: async () => ({ kind: "abstained", reason: "too many candidates" }),
    };
    const sure: ObserveDriver = {
      name: "sure",
      resolve: vi.fn(async () => ({ kind: "resolved" as const, actions: [PICK] })),
    };

    await expect(observeWithFallback(unsure, sure).resolve(observeRequest)).resolves.toStrictEqual({
      kind: "resolved",
      actions: [PICK],
    });
    await expect(observeWithFallback(sure, unsure).resolve(observeRequest)).resolves.toMatchObject({
      kind: "resolved",
    });
    // An abstention must not read as "nothing on the page".
    await expect(observeOrFail(unsure).resolve(observeRequest)).rejects.toThrow(
      "observe() failed: the unsure driver abstained (too many candidates)",
    );
  });

  it("falls back for extract, or fails loudly without a fallback", async () => {
    const unsure: ExtractDriver = {
      name: "unsure",
      resolve: async () => ({ kind: "abstained", reason: "schema_mismatch" }),
    };
    const sure: ExtractDriver = {
      name: "sure",
      resolve: async () => ({ kind: "resolved", data: { price: 12 } }),
    };

    await expect(extractWithFallback(unsure, sure).resolve(extractRequest)).resolves.toStrictEqual({
      kind: "resolved",
      data: { price: 12 },
    });
    await expect(extractOrFail(unsure).resolve(extractRequest)).rejects.toThrow(
      "extract() failed: the unsure driver abstained (schema_mismatch)",
    );
  });
});

describe("services with an injected driver", () => {
  beforeEach(() => {
    performAction.mockReset().mockResolvedValue();
    waitForQuiet.mockReset().mockResolvedValue();
  });

  const neverCalled = vi.fn(async (): Promise<LLMGenerateResult> => {
    throw new Error("the language model must not be called");
  });

  it("act: performs what the driver chose, through the service's action runner", async () => {
    const driver = actDriver("fake", async (request) => {
      request.llm.record({
        prompt_tokens: 7,
        completion_tokens: 2,
        reasoning_tokens: 1,
        cached_input_tokens: 0,
        inference_time_ms: 30,
      });
      const result = await request.runAction({
        selector: "xpath=/html/body/input",
        description: "Email field",
        method: "fill",
        arguments: ["%email%"],
      });
      return { kind: "resolved", result, path: "fake", cacheable: true };
    });
    const logs: { message: string; data: Record<string, unknown> }[] = [];

    const result = await actService.act({
      params: {
        pageId: "page-1",
        instruction: "type my email",
        options: { variables: { email: "user@example.com" } },
      },
      page: actPage(),
      model: undefined,
      clientLLMGenerate: neverCalled,
      logger: testLogger(logs),
      driver,
      logTiming: true,
    });

    // Variables are substituted for the page and kept as placeholders in the result.
    expect(performAction.mock.calls[0]?.slice(2, 5)).toStrictEqual([
      "fill",
      "xpath=/html/body/input",
      ["user@example.com"],
    ]);
    expect(result.data).toMatchObject({ success: true, actions: [{ arguments: ["%email%"] }] });
    // What the driver spent on a model is the operation's usage.
    expect(result.metadata.usage).toMatchObject({
      inputTokens: 7,
      outputTokens: 2,
      inferenceTimeMs: 30,
    });
    expect(logs.find(({ message }) => message === "Act pipeline finished")?.data).toMatchObject({
      path: "fake",
      success: true,
      llmInputTokens: 7,
    });
    expect(neverCalled).not.toHaveBeenCalled();
  });

  it("act: lets only an early-starting driver run before the DOM has settled", async () => {
    for (const startsBeforeSettle of [true, false]) {
      let settle!: () => void;
      waitForQuiet.mockReset().mockReturnValue(new Promise<void>((resolve) => (settle = resolve)));
      const order: string[] = [];
      const driver = actDriver(
        "fake",
        async (request) => {
          order.push("resolve");
          await request.settled;
          return done(PICK);
        },
        { startsBeforeSettle, prepare: () => void order.push("prepare") },
      );

      const pending = actService.act({
        params: { pageId: "page-1", instruction: "pick" },
        page: actPage(),
        model: undefined,
        clientLLMGenerate: neverCalled,
        logger: testLogger(),
        driver,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      order.push("settled");
      settle();
      await pending;

      expect(order).toStrictEqual(
        startsBeforeSettle ? ["prepare", "resolve", "settled"] : ["prepare", "settled", "resolve"],
      );
    }
  });

  it("act: settles before a cache lookup whatever the driver, and skips it on a hit", async () => {
    let settle!: () => void;
    waitForQuiet.mockReturnValue(new Promise<void>((resolve) => (settle = resolve)));
    const frame = { frameId: "frame-1", getAccessibilityTree: vi.fn(async () => []) };
    const get = vi.fn().mockResolvedValue({ hit: true, value: [PICK], cacheKey: "key" });
    const driver = actDriver("eager", async () => done(OPEN), { startsBeforeSettle: true });
    const guard = { check: vi.fn(async () => ({ verdict: "ok" as const })) };

    const pending = actService.act({
      params: { pageId: "page-1", instruction: "pick" },
      page: cachePage(frame),
      model: undefined,
      clientLLMGenerate: neverCalled,
      logger: testLogger(),
      cache: {
        sessionId: "session-1",
        client: { get, set: vi.fn() } as unknown as CacheClient,
        defaultCaching: true as const,
      },
      driver,
      cachedActionGuard: guard,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The cache key is built from the page: no lookup until it has settled.
    expect(get).not.toHaveBeenCalled();
    settle();
    const result = await pending;

    expect(result.metadata.cache.status).toBe("HIT");
    expect(result.data.actions).toStrictEqual([PICK]);
    expect(guard.check).toHaveBeenCalledExactlyOnceWith(PICK, expect.anything());
    expect(driver.resolve).not.toHaveBeenCalled();
  });

  it("act: replays cached actions without self-heal, leaving recovery to the driver", async () => {
    const frame = { frameId: "frame-1", getAccessibilityTree: vi.fn(async () => []) };
    const page = cachePage(frame);
    performAction.mockRejectedValueOnce(new Error("element is detached"));
    const driver = actDriver("fake", async () => done(OPEN));

    const result = await actService.act({
      params: { pageId: "page-1", instruction: "pick" },
      page,
      model: undefined,
      clientLLMGenerate: neverCalled,
      logger: testLogger(),
      selfHeal: true,
      cache: {
        sessionId: "session-1",
        client: {
          get: vi.fn().mockResolvedValue({ hit: true, value: [PICK], cacheKey: "key" }),
          set: vi.fn().mockResolvedValue({ written: true, cacheKey: "key" }),
        } as unknown as CacheClient,
        defaultCaching: true as const,
      },
      driver,
    });

    expect(result.metadata.cache).toMatchObject({ status: "MISS", missReason: "replay_failed" });
    // Self-heal would have re-read the page to find the element again.
    expect(page.captureSnapshot).not.toHaveBeenCalled();
    expect(driver.resolve).toHaveBeenCalledTimes(1);
  });

  it("act: re-resolves when the guard calls a cached action stale", async () => {
    const frame = { frameId: "frame-1", getAccessibilityTree: vi.fn(async () => []) };
    const get = vi.fn().mockResolvedValue({ hit: true, value: [PICK], cacheKey: "key" });
    const driver = actDriver("fake", async (request) => ({
      kind: "resolved",
      result: await request.runAction(OPEN),
      path: "fake",
      cacheable: true,
    }));

    const result = await actService.act({
      params: { pageId: "page-1", instruction: "pick" },
      page: cachePage(frame),
      model: undefined,
      clientLLMGenerate: neverCalled,
      logger: testLogger(),
      cache: {
        sessionId: "session-1",
        client: {
          get,
          set: vi.fn().mockResolvedValue({ written: true, cacheKey: "key" }),
        } as unknown as CacheClient,
        defaultCaching: true as const,
      },
      driver,
      cachedActionGuard: {
        check: async () => ({ verdict: "stale", detail: "selector now resolves to a link" }),
      },
    });

    expect(result.metadata.cache).toMatchObject({ status: "MISS", missReason: "replay_failed" });
    expect(performAction).toHaveBeenCalledTimes(1);
    expect(performAction.mock.calls[0]?.[3]).toBe(OPEN.selector);
  });

  it("act: writes to the cache only what the driver calls cacheable", async () => {
    for (const cacheable of [true, false]) {
      const frame = { frameId: "frame-1", getAccessibilityTree: vi.fn(async () => []) };
      const set = vi.fn().mockResolvedValue({ written: true, cacheKey: "key" });
      const cache = {
        sessionId: "session-1",
        client: {
          get: vi.fn().mockResolvedValue({ hit: false, cacheKey: "key" }),
          set,
        } as unknown as CacheClient,
        defaultCaching: true as const,
      };

      await actService.act({
        params: { pageId: "page-1", instruction: "pick" },
        page: cachePage(frame),
        model: undefined,
        clientLLMGenerate: neverCalled,
        logger: testLogger(),
        cache,
        driver: actDriver("fake", async () => done(PICK, { cacheable })),
      });

      expect(set).toHaveBeenCalledTimes(cacheable ? 1 : 0);
    }
  });

  it("act: performs an Action instruction without asking any driver", async () => {
    const driver = actDriver("fake", async () => done(PICK));

    const result = await actService.act({
      params: { pageId: "page-1", instruction: OPEN },
      page: actPage(),
      model: undefined,
      clientLLMGenerate: neverCalled,
      logger: testLogger(),
      driver,
    });

    expect(result.data.success).toBe(true);
    expect(performAction.mock.calls[0]?.[3]).toBe(OPEN.selector);
    expect(driver.resolve).not.toHaveBeenCalled();
  });

  it("observe: returns the driver's actions with the usage it recorded", async () => {
    const captureSnapshot = vi.fn();
    const resolve = vi.fn<ObserveDriver["resolve"]>(async (request) => {
      request.llm.record({
        prompt_tokens: 5,
        completion_tokens: 1,
        reasoning_tokens: 0,
        cached_input_tokens: 0,
        inference_time_ms: 20,
      });
      return { kind: "resolved", actions: [PICK] };
    });

    const result = await observeService.observe({
      params: {
        pageId: "page-1",
        instruction: "find the item",
        options: { variables: { a: "b" } },
      },
      page: { captureSnapshot } as unknown as Page,
      model: undefined,
      clientLLMGenerate: neverCalled,
      logger: testLogger(),
      driver: { name: "fake", resolve },
    });

    expect(result.data).toStrictEqual([PICK]);
    expect(result.metadata.usage).toMatchObject({ inputTokens: 5, outputTokens: 1 });
    expect(resolve.mock.calls[0]?.[0]).toMatchObject({
      instruction: "find the item",
      variables: { a: "b" },
    });
    // The page is the driver's to read; the service did not capture it on its behalf.
    expect(captureSnapshot).not.toHaveBeenCalled();
  });

  it("extract: captures the page once and gives the driver the schema both ways", async () => {
    const captureSnapshot = vi.fn(async () => ({
      combinedTree: "[0-1] heading: Example",
      combinedXpathMap: {},
      combinedUrlMap: { "0-1": "https://example.com" },
    }));
    const resolve = vi.fn<ExtractDriver["resolve"]>(async (request) => ({
      kind: "resolved",
      data: request.schema.parse({ title: "Example" }),
    }));
    const jsonSchema = {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
    };

    const result = await extractService.extract({
      params: { pageId: "page-1", instruction: "the title", schema: jsonSchema },
      page: { captureSnapshot, screenshot: vi.fn() } as unknown as Page,
      model: undefined,
      clientLLMGenerate: neverCalled,
      logger: testLogger(),
      driver: { name: "fake", resolve },
    });

    expect(result.data).toStrictEqual({ title: "Example" });
    expect(captureSnapshot).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0]?.[0]).toMatchObject({
      instruction: "the title",
      jsonSchema,
      snapshot: { tree: "[0-1] heading: Example", urlMap: { "0-1": "https://example.com" } },
    });
    expect(resolve.mock.calls[0]?.[0].screenshot).toBeUndefined();
  });

  it("a driver that abstains with nothing behind it is an error, never an empty success", async () => {
    await expect(
      actService.act({
        params: { pageId: "page-1", instruction: "pick" },
        page: actPage(),
        model: undefined,
        clientLLMGenerate: neverCalled,
        logger: testLogger(),
        driver: actDriver("fake", async () => abstain("unsure")),
      }),
    ).rejects.toThrow("act() failed: no driver resolved the instruction (unsure)");
    await expect(
      observeService.observe({
        params: { pageId: "page-1" },
        page: { captureSnapshot: vi.fn() } as unknown as Page,
        model: undefined,
        clientLLMGenerate: neverCalled,
        logger: testLogger(),
        driver: { name: "fake", resolve: async () => ({ kind: "abstained", reason: "unsure" }) },
      }),
    ).rejects.toThrow("observe() failed: no driver resolved the instruction (unsure)");
  });
});

describe("decision-first act, end to end through the service", () => {
  beforeEach(() => {
    performAction.mockReset().mockResolvedValue();
    waitForQuiet.mockReset().mockResolvedValue();
  });

  it("continues with the language model when the decision model does not commit", async () => {
    // Every question comes back undecided, so the decision driver abstains.
    const decisionRequests = vi.fn(async (_url: string, init: RequestInit) => {
      const questions = Object.keys(JSON.parse(String(init.body)).questions);
      return new Response(
        JSON.stringify({
          model: "decision-model",
          answers: Object.fromEntries(
            questions.map((key) => [
              key,
              { type: "choice", choice: "unsupported", confidence: 0.2, probabilities: {} },
            ]),
          ),
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    });
    vi.stubGlobal("fetch", decisionRequests);
    const clientLLMGenerate = vi.fn(
      async (): Promise<LLMGenerateResult> => ({
        role: "assistant",
        content: { type: "text", text: "structured action" },
        outputFormat: "json_schema",
        structuredContent: {
          action: {
            elementId: "0-12",
            description: "Submit button",
            method: "click",
            arguments: [],
          },
          twoStep: false,
        },
        usage: { inputTokens: 11, outputTokens: 4, totalTokens: 15 },
      }),
    );
    const page = {
      mainFrame: () => ({}),
      captureSnapshot: vi.fn(async () => ({
        combinedTree: "[0-12] button: Submit",
        combinedXpathMap: { "0-12": "/html/body/button" },
        combinedUrlMap: {},
      })),
      url: () => "https://example.com/form",
    } as unknown as Page;
    const logs: { message: string; data: Record<string, unknown> }[] = [];
    const drivers = decisionDrivers({ apiKey: "test" });

    try {
      const result = await actService.act({
        params: { pageId: "page-1", instruction: "Click submit" },
        page,
        model: { source: "client" },
        clientLLMGenerate,
        logger: testLogger(logs),
        driver: drivers.act,
        cachedActionGuard: drivers.cachedActionGuard,
        logTiming: drivers.logActTiming,
      });

      expect(decisionRequests).toHaveBeenCalled();
      expect(clientLLMGenerate).toHaveBeenCalledTimes(1);
      expect(result.data).toMatchObject({
        success: true,
        actions: [{ selector: "xpath=/html/body/button", method: "click" }],
      });
      expect(result.metadata.usage).toMatchObject({ inputTokens: 11, outputTokens: 4 });
      expect(logs.find(({ message }) => message === "Act pipeline finished")?.data).toMatchObject({
        path: "decisions+llm",
        success: true,
      });
      expect(
        logs.find(({ message }) => message.startsWith("Act driver abstained"))?.data,
      ).toMatchObject({ driver: "decisions", next: "llm" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("driver composition", () => {
  it("wires the plain methods to the language model alone", () => {
    const drivers = llmDrivers();

    expect([drivers.act.name, drivers.observe.name, drivers.extract.name]).toStrictEqual([
      "llm",
      "llm",
      "llm",
    ]);
    expect(drivers.act.startsBeforeSettle).toBe(false);
    expect(drivers.cachedActionGuard).toBeUndefined();
    expect(drivers.logActTiming).toBe(false);
    expect(llmDrivers({ logActTiming: true }).logActTiming).toBe(true);
  });

  it("puts the decision model first and the language model behind it", () => {
    const drivers = decisionDrivers({ apiKey: "key" });

    expect([drivers.act.name, drivers.observe.name, drivers.extract.name]).toStrictEqual([
      "decisions+llm",
      "decisions+llm",
      "decisions+llm",
    ]);
    // The intent question needs no page, so the chain may start while the DOM settles.
    expect(drivers.act.startsBeforeSettle).toBe(true);
    expect(drivers.cachedActionGuard).toBeUndefined();
  });

  it("follows the configuration: no fallback, judge-only extraction, cache check", () => {
    const strict = decisionDrivers({ apiKey: "key", llmFallback: false, cacheCheck: true });
    const judge = decisionDrivers({ apiKey: "key", extract: "judge" });

    expect([strict.act.name, strict.observe.name, strict.extract.name]).toStrictEqual([
      "decisions",
      "decisions",
      "decisions",
    ]);
    expect(strict.cachedActionGuard).toBeDefined();
    // "judge": the language model extracts; the decision model only checks completion.
    expect(judge.extract.name).toBe("llm");
    expect(judge.act.name).toBe("decisions+llm");
  });
});

function actPage(frame: object = {}): Page {
  return { mainFrame: () => frame, captureSnapshot: vi.fn() } as unknown as Page;
}

/** A page the cache can key on: it has a URL and frames to read the tree from. */
function cachePage(frame: object): Page {
  return {
    mainFrame: () => frame,
    captureSnapshot: vi.fn(),
    url: () => "https://example.com",
    frames: () => [frame],
  } as unknown as Page;
}

function testLogger(logs?: { message: string; data: Record<string, unknown> }[]): StagehandLogger {
  return new StagehandLogger({ tracer: trace.getTracer("drivers-test") }, (log) => {
    logs?.push(log as unknown as { message: string; data: Record<string, unknown> });
  });
}
