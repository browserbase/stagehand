import { EventEmitter } from "node:events";
import { trace } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import type { LLMGenerateParams, LLMGenerateResult } from "@browserbasehq/stagehand-protocol/types";
import type { CacheClient } from "../clients/cacheClient.js";
import {
  performUnderstudyMethod,
  waitForDomNetworkQuiet,
} from "../handlers/handlerUtils/actHandlerUtils.js";
import * as inference from "../inference.js";
import { StagehandLogger } from "../logger.js";
import * as actService from "../services/actService.js";
import { Page } from "../understudy/page.js";
import { Frame } from "../understudy/frame.js";
import { Locator } from "../understudy/locator.js";
import { Progress } from "../understudy/progress.js";

vi.mock("../handlers/handlerUtils/actHandlerUtils.js", () => ({
  performUnderstudyMethod: vi.fn(),
  waitForDomNetworkQuiet: vi.fn(),
}));

const performAction = vi.mocked(performUnderstudyMethod);
const waitForQuiet = vi.mocked(waitForDomNetworkQuiet);

describe("act inference", () => {
  it("runs one structured action call through the shared generator", async () => {
    const generate = vi.fn(
      async (_params: LLMGenerateParams): Promise<LLMGenerateResult> =>
        actGeneration({
          elementId: "0-12",
          description: "Submit button",
          method: "click",
          arguments: [],
        }),
    );

    const result = await inference.act({
      instruction: "Click the submit button",
      domElements: "[0-12] button: Submit",
      generate,
      userProvidedInstructions: "Prefer visible controls",
    });

    expect(result).toMatchObject({
      element: {
        elementId: "0-12",
        description: "Submit button",
        method: "click",
        arguments: [],
      },
      twoStep: false,
      prompt_tokens: 11,
      completion_tokens: 4,
      reasoning_tokens: 2,
      cached_input_tokens: 3,
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]?.[0]).toMatchObject({
      systemPrompt: expect.stringContaining("Prefer visible controls"),
      responseFormat: { type: "json_schema", name: "Act" },
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: expect.stringContaining("[0-12] button: Submit"),
          },
        },
      ],
    });
  });

  it("rejects malformed structured action output", async () => {
    const generate = vi.fn(
      async (_params: LLMGenerateParams): Promise<LLMGenerateResult> =>
        actGeneration({
          elementId: "12",
          description: "Invalid element ID",
          method: "click",
          arguments: [],
        }),
    );

    await expect(
      inference.act({
        instruction: "Click the submit button",
        domElements: "[0-12] button: Submit",
        generate,
      }),
    ).rejects.toThrow();
  });
});

describe("act service", () => {
  beforeEach(() => {
    performAction.mockReset().mockResolvedValue();
    waitForQuiet.mockReset().mockResolvedValue();
  });

  it("captures the page, resolves variables, and performs the inferred action", async () => {
    const frame = {};
    const captureSnapshot = vi.fn(async () => snapshot("0-12", "/html/body/input/text()"));
    const page = actPage(frame, captureSnapshot);
    const clientLLMGenerate = vi.fn(
      async (): Promise<LLMGenerateResult> =>
        actGeneration({
          elementId: "0-12",
          description: "Email field",
          method: "fill",
          arguments: ["%accountEmail%"],
        }),
    );
    const logger = testLogger();

    const result = await actService.act({
      params: {
        pageId: "page-1",
        instruction: "Fill in the email field",
        options: {
          variables: {
            accountEmail: {
              value: "user@example.com",
              description: "The account email",
            },
          },
        },
      },
      page,
      model: { source: "client" },
      clientLLMGenerate,
      logger,
      domSettleTimeoutMs: 2_000,
    });

    expect(waitForQuiet).toHaveBeenCalledWith(frame, logger, 2_000, expect.any(Progress));
    expect(captureSnapshot).toHaveBeenCalledTimes(1);
    expect(performAction).toHaveBeenCalledWith(
      page,
      frame,
      "fill",
      "xpath=/html/body/input",
      ["user@example.com"],
      logger,
      expect.any(Progress),
      2_000,
    );
    expect(result).toStrictEqual({
      data: {
        success: true,
        message: "Action [fill] performed successfully on selector: xpath=/html/body/input",
        actionDescription: "Email field",
        actions: [
          {
            selector: "xpath=/html/body/input",
            description: "Email field",
            method: "fill",
            arguments: ["%accountEmail%"],
          },
        ],
      },
      metadata: {
        cache: { status: "DISABLED" },
        usage: {
          inputTokens: 11,
          outputTokens: 4,
          reasoningTokens: 2,
          cachedInputTokens: 3,
          inferenceTimeMs: expect.any(Number),
        },
      },
    });
  });

  it("captures the requested locator scope and ignored locator subtrees", async () => {
    const frame = {};
    const captureSnapshot = vi.fn(async () => snapshot("0-12", "/html/body/button"));
    const page = actPage(frame, captureSnapshot);
    const clientLLMGenerate = vi.fn(
      async (): Promise<LLMGenerateResult> =>
        actGeneration({
          elementId: "0-12",
          description: "Submit button",
          method: "click",
          arguments: [],
        }),
    );

    await actService.act({
      params: {
        pageId: "page-1",
        instruction: "Click submit",
        options: {
          locator: { selector: "main", nth: 1 },
          ignoreLocators: [{ selector: "nav" }, { selector: ".cookie-banner", nth: 0 }],
        },
      },
      page,
      model: { source: "client" },
      clientLLMGenerate,
      logger: testLogger(),
    });

    expect(captureSnapshot).toHaveBeenCalledWith(
      {
        focusLocator: { selector: "main", nth: 1 },
        ignoreLocators: [{ selector: "nav" }, { selector: ".cookie-banner", nth: 0 }],
      },
      expect.any(Progress),
    );
  });

  it("plans actions from the locator-filtered snapshot context", async () => {
    const frame = {};
    const captureSnapshot = vi.fn(async (options) => {
      expect(options).toStrictEqual({
        focusLocator: { selector: "main" },
        ignoreLocators: [{ selector: ".promo" }],
      });
      return {
        combinedTree: "[0-12] button: Checkout",
        combinedXpathMap: { "0-12": "/html/body/main/button" },
        combinedUrlMap: {},
      };
    });
    const page = actPage(frame, captureSnapshot);
    const clientLLMGenerate = vi.fn(
      async (): Promise<LLMGenerateResult> =>
        actGeneration({
          elementId: "0-12",
          description: "Checkout button",
          method: "click",
          arguments: [],
        }),
    );

    await actService.act({
      params: {
        pageId: "page-1",
        instruction: "Click checkout",
        options: {
          locator: { selector: "main" },
          ignoreLocators: [{ selector: ".promo" }],
        },
      },
      page,
      model: { source: "client" },
      clientLLMGenerate,
      logger: testLogger(),
    });

    expect(clientLLMGenerate).toHaveBeenCalled();
    const [generateParams] = clientLLMGenerate.mock.calls[0] as unknown as [LLMGenerateParams];
    const prompt = generateParams.messages[0]?.content;
    expect(prompt).toMatchObject({
      type: "text",
      text: expect.stringContaining("[0-12] button: Checkout"),
    });
    expect(prompt).toMatchObject({
      type: "text",
      text: expect.not.stringContaining("Promo modal"),
    });
  });

  it("zeroes usage when a supplied Action succeeds without inference", async () => {
    const frame = {};
    const page = actPage(
      frame,
      vi.fn(async () => snapshot("0-12", "/html/body/button")),
    );
    const clientLLMGenerate = vi.fn(async (): Promise<LLMGenerateResult> => actGeneration(null));

    const result = await actService.act({
      params: {
        pageId: "page-1",
        instruction: {
          selector: "xpath=/html/body/button",
          description: "Submit button",
          method: "click",
          arguments: [],
        },
      },
      page,
      model: { source: "client" },
      clientLLMGenerate,
      logger: testLogger(),
    });

    expect(result.data.success).toBe(true);
    expect(result.metadata.usage).toStrictEqual({
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      inferenceTimeMs: 0,
    });
    expect(clientLLMGenerate).not.toHaveBeenCalled();
  });

  it("self-heals a supplied Action after deterministic replay fails", async () => {
    const frame = {};
    const captureSnapshot = vi.fn(async () => snapshot("0-20", "/html/body/button[2]"));
    const page = actPage(frame, captureSnapshot);
    const clientLLMGenerate = vi.fn(
      async (): Promise<LLMGenerateResult> =>
        actGeneration({
          elementId: "0-20",
          description: "Submit button",
          method: "click",
          arguments: [],
        }),
    );
    performAction.mockRejectedValueOnce(new Error("Element detached")).mockResolvedValueOnce();

    const result = await actService.act({
      params: {
        pageId: "page-1",
        instruction: {
          selector: "xpath=/html/body/button[1]",
          description: "Submit button",
          method: "click",
          arguments: [],
        },
      },
      page,
      model: { source: "client" },
      clientLLMGenerate,
      logger: testLogger(),
      selfHeal: true,
    });

    expect(waitForQuiet).not.toHaveBeenCalled();
    expect(captureSnapshot).toHaveBeenCalledOnce();
    expect(clientLLMGenerate).toHaveBeenCalledOnce();
    expect(performAction).toHaveBeenNthCalledWith(
      1,
      page,
      frame,
      "click",
      "xpath=/html/body/button[1]",
      [],
      expect.any(StagehandLogger),
      expect.any(Progress),
      undefined,
    );
    expect(performAction).toHaveBeenNthCalledWith(
      2,
      page,
      frame,
      "click",
      "xpath=/html/body/button[2]",
      [],
      expect.any(StagehandLogger),
      expect.any(Progress),
      undefined,
    );
    expect(result.data).toMatchObject({
      success: true,
      actions: [{ selector: "xpath=/html/body/button[2]" }],
    });
    expect(result.metadata.usage).toMatchObject({
      inputTokens: 11,
      outputTokens: 4,
      reasoningTokens: 2,
      cachedInputTokens: 3,
    });
  });

  it("aggregates usage across a two-step action", async () => {
    const frame = {};
    const captureSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot("0-12", "/html/body/button"))
      .mockResolvedValueOnce(snapshot("0-20", "/html/body/ul/li"));
    const page = actPage(frame, captureSnapshot);
    const clientLLMGenerate = vi
      .fn()
      .mockResolvedValueOnce(
        actGeneration(
          {
            elementId: "0-12",
            description: "Country dropdown",
            method: "click",
            arguments: [],
          },
          true,
        ),
      )
      .mockResolvedValueOnce(
        actGeneration({
          elementId: "0-20",
          description: "Switzerland option",
          method: "click",
          arguments: [],
        }),
      );

    const now = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(7)
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(23);
    try {
      const result = await actService.act({
        params: { pageId: "page-1", instruction: "Choose Switzerland from the country dropdown" },
        page,
        model: { source: "client" },
        clientLLMGenerate,
        logger: testLogger(),
      });

      expect(clientLLMGenerate).toHaveBeenCalledTimes(2);
      expect(performAction).toHaveBeenCalledTimes(2);
      expect(result.data.success).toBe(true);
      expect(result.data.actions).toHaveLength(2);
      expect(result.metadata.usage).toStrictEqual({
        inputTokens: 22,
        outputTokens: 8,
        reasoningTokens: 4,
        cachedInputTokens: 6,
        inferenceTimeMs: 20,
      });
    } finally {
      now.mockRestore();
    }
  });

  it("retries with a fresh selector when self-healing is enabled", async () => {
    const frame = {};
    const captureSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot("0-12", "/html/body/button[1]"))
      .mockResolvedValueOnce(snapshot("0-20", "/html/body/button[2]"));
    const page = actPage(frame, captureSnapshot);
    const clientLLMGenerate = vi
      .fn()
      .mockResolvedValueOnce(
        actGeneration({
          elementId: "0-12",
          description: "Submit button",
          method: "click",
          arguments: [],
        }),
      )
      .mockResolvedValueOnce(
        actGeneration({
          elementId: "0-20",
          description: "Submit button",
          method: "click",
          arguments: [],
        }),
      );
    performAction.mockRejectedValueOnce(new Error("Element detached")).mockResolvedValueOnce();

    const result = await actService.act({
      params: { pageId: "page-1", instruction: "Click the submit button" },
      page,
      model: { source: "client" },
      clientLLMGenerate,
      logger: testLogger(),
      selfHeal: true,
    });

    expect(clientLLMGenerate).toHaveBeenCalledTimes(2);
    expect(performAction).toHaveBeenLastCalledWith(
      page,
      frame,
      "click",
      "xpath=/html/body/button[2]",
      [],
      expect.any(StagehandLogger),
      expect.any(Progress),
      undefined,
    );
    expect(result.data).toMatchObject({
      success: true,
      actions: [{ selector: "xpath=/html/body/button[2]" }],
    });
    expect(result.metadata.usage).toMatchObject({
      inputTokens: 22,
      outputTokens: 8,
      reasoningTokens: 4,
      cachedInputTokens: 6,
    });
  });

  it("returns a failed result when the model finds no action", async () => {
    const page = actPage(
      {},
      vi.fn(async () => snapshot("0-12", "/html/body/button")),
    );

    const result = await actService.act({
      params: { pageId: "page-1", instruction: "Click a missing button" },
      page,
      model: { source: "client" },
      clientLLMGenerate: vi.fn(async (): Promise<LLMGenerateResult> => actGeneration(null)),
      logger: testLogger(),
    });

    expect(performAction).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      success: false,
      message: "Failed to perform act: No action found",
    });
    expect(result.metadata.usage).toMatchObject({
      inputTokens: 11,
      outputTokens: 4,
      reasoningTokens: 2,
      cachedInputTokens: 3,
    });
  });

  it("persists successful actions and replays them from cache", async () => {
    const frame = {
      frameId: "frame-1",
      getAccessibilityTree: vi.fn(async () => []),
    };
    const captureSnapshot = vi.fn(async () => snapshot("0-12", "/html/body/button"));
    const page = {
      ...actPage(frame, captureSnapshot),
      url: () => "https://example.com",
      frames: () => [frame],
    } as unknown as Page;
    const get = vi.fn().mockResolvedValueOnce({ hit: false, cacheKey: "key" });
    const set = vi.fn().mockResolvedValue({ written: true, cacheKey: "key" });
    const cache = {
      sessionId: "session-1",
      client: { get, set } as unknown as CacheClient,
      defaultCaching: true as const,
    };
    const clientLLMGenerate = vi.fn(
      async (): Promise<LLMGenerateResult> =>
        actGeneration({
          elementId: "0-12",
          description: "Submit button",
          method: "click",
          arguments: [],
        }),
    );

    const miss = await actService.act({
      params: { pageId: "page-1", instruction: "Click submit" },
      page,
      model: { source: "client" },
      clientLLMGenerate,
      logger: testLogger(),
      cache,
    });

    expect(miss.metadata.cache.status).toBe("MISS");
    expect(miss.metadata.usage).toBeDefined();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ value: miss.data.actions }));

    get.mockResolvedValueOnce({ hit: true, value: miss.data.actions, cacheKey: "key" });
    clientLLMGenerate.mockClear();

    const hit = await actService.act({
      params: { pageId: "page-1", instruction: "Click submit" },
      page,
      model: { source: "client" },
      clientLLMGenerate,
      logger: testLogger(),
      cache,
    });

    expect(hit.metadata.cache.status).toBe("HIT");
    expect(hit.metadata.usage).toStrictEqual({
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      inferenceTimeMs: 0,
    });
    expect(hit.data.actions).toStrictEqual(miss.data.actions);
    expect(clientLLMGenerate).not.toHaveBeenCalled();
  });

  it("bypasses cache reads and writes for locator-scoped instruction acts", async () => {
    const frame = {
      frameId: "frame-1",
      getAccessibilityTree: vi.fn(async () => []),
    };
    const captureSnapshot = vi.fn(async () => snapshot("0-12", "/html/body/main/button"));
    const page = {
      ...actPage(frame, captureSnapshot),
      url: () => "https://example.com",
      frames: () => [frame],
    } as unknown as Page;
    const get = vi.fn();
    const set = vi.fn();
    const clientLLMGenerate = vi.fn(
      async (): Promise<LLMGenerateResult> =>
        actGeneration({
          elementId: "0-12",
          description: "Checkout button",
          method: "click",
          arguments: [],
        }),
    );

    const result = await actService.act({
      params: {
        pageId: "page-1",
        instruction: "Click checkout",
        options: {
          cache: true,
          locator: { selector: "main", nth: 1 },
          ignoreLocators: [{ selector: ".promo", nth: 0 }],
        },
      },
      page,
      model: { source: "client" },
      clientLLMGenerate,
      logger: testLogger(),
      cache: {
        sessionId: "session-1",
        client: { get, set } as unknown as CacheClient,
        defaultCaching: true,
      },
    });

    expect(result.metadata.cache).toStrictEqual({ status: "DISABLED" });
    expect(captureSnapshot).toHaveBeenCalledWith(
      {
        focusLocator: { selector: "main", nth: 1 },
        ignoreLocators: [{ selector: ".promo", nth: 0 }],
      },
      expect.any(Progress),
    );
    expect(clientLLMGenerate).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(frame.getAccessibilityTree).not.toHaveBeenCalled();
  });

  describe("shared deadline", () => {
    beforeEach(() =>
      vi.useFakeTimers({
        toFake: [
          "setTimeout",
          "clearTimeout",
          "setInterval",
          "clearInterval",
          "performance",
          "Date",
        ],
      }),
    );
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    const action = { selector: "button", method: "click", description: "Submit", arguments: [] };
    const inferredAction = {
      elementId: "0-12",
      method: action.method,
      description: action.description,
      arguments: action.arguments,
    };
    const generation = () => actGeneration(inferredAction);
    const delay = async <T>(value: T) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return value;
    };

    function fixture() {
      const captureSnapshot = vi.fn(async (_options?: unknown, _progress?: Progress) =>
        snapshot("0-12", "/html/body/button"),
      );
      const frame = { frameId: "main", getAccessibilityTree: vi.fn(async () => []) };
      const page = Object.assign(actPage(frame, captureSnapshot), {
        url: () => "https://example.com",
        frames: () => [frame],
      });
      const generate = vi.fn(async () => generation());
      const get = vi.fn().mockResolvedValue({ hit: false });
      const set = vi.fn().mockResolvedValue({ written: true });
      const options = {
        page,
        model: { source: "client" as const },
        clientLLMGenerate: generate,
        logger: testLogger(),
        cache: {
          sessionId: "session",
          client: { get, set } as unknown as CacheClient,
          defaultCaching: true as const,
        },
      };
      return { captureSnapshot, generate, get, set, options };
    }

    it.each([
      "settling",
      "snapshot",
      "inference",
      "cache read",
      "cache write",
      "cached replay",
      "self-heal",
    ])("rejects during %s & does not resume work after a late response", async (phase) => {
      const { captureSnapshot, generate, get, set, options } = fixture();
      if (phase === "settling") waitForQuiet.mockImplementation(() => delay(undefined));
      if (phase === "snapshot")
        captureSnapshot.mockImplementation(() => delay(snapshot("0-12", "/html/body/button")));
      if (phase === "inference" || phase === "self-heal")
        generate.mockImplementation(() => delay(generation()));
      if (phase === "cache read")
        get.mockImplementation(() => delay({ hit: true, value: [action] }));
      if (phase === "cache write") set.mockImplementation(() => delay({ written: true }));
      if (phase === "cached replay") {
        get.mockResolvedValue({ hit: true, value: [action, action] });
        performAction.mockImplementation(() => delay(undefined));
      }
      if (phase === "self-heal") performAction.mockRejectedValueOnce(new Error("stale selector"));
      const result = actService.act({
        ...options,
        selfHeal: true,
        params: {
          pageId: "page-1",
          instruction: phase === "self-heal" ? action : "Submit",
          options: { timeout: 20 },
        },
      });
      const rejected = expect(result).rejects.toThrow("act() timed out after 20ms");
      await vi.advanceTimersByTimeAsync(20);
      await rejected;
      const calls = () =>
        [captureSnapshot, generate, performAction, get, set].map((mock) => mock.mock.calls.length);
      const callsAtDeadline = calls();
      await vi.advanceTimersByTimeAsync(100);
      expect(calls()).toEqual(callsAtDeadline);
      expect(performAction).toHaveBeenCalledTimes(
        ["cached replay", "self-heal", "cache write"].includes(phase) ? 1 : 0,
      );
    });

    it("shares the remaining budget across both snapshots of a two-step act", async () => {
      const { captureSnapshot, generate, options } = fixture();
      captureSnapshot.mockImplementation(async (_options, progress) => {
        await progress!.delay(15);
        return snapshot("0-12", "/html/body/button");
      });
      generate.mockResolvedValue(actGeneration(inferredAction, true));
      const result = actService.act({
        ...options,
        params: { pageId: "page-1", instruction: "Submit", options: { timeout: 20 } },
      });
      const rejected = expect(result).rejects.toThrow("act() timed out after 20ms");
      await vi.advanceTimersByTimeAsync(20);
      await rejected;
      expect(captureSnapshot).toHaveBeenCalledTimes(2);
      expect(generate).toHaveBeenCalledTimes(1);
      expect(performAction).toHaveBeenCalledTimes(1);
    });

    it("reuses an existing deadline instead of starting the requested timeout", async () => {
      const { generate, options } = fixture();
      const progress = new Progress("parent", 20);
      generate.mockImplementation(() => delay(generation()));
      await vi.advanceTimersByTimeAsync(10);
      const result = actService.act({
        ...options,
        progress,
        params: { pageId: "page-1", instruction: "Submit", options: { timeout: 100 } },
      });
      const rejected = expect(result).rejects.toThrow("parent timed out after 20ms");
      await vi.advanceTimersByTimeAsync(10);
      await rejected;
      expect(performAction).not.toHaveBeenCalled();
      progress.dispose();
    });

    it("interrupts a deterministic fill without self-healing or refilling after expiry", async () => {
      const real = await vi.importActual<
        typeof import("../handlers/handlerUtils/actHandlerUtils.js")
      >("../handlers/handlerUtils/actHandlerUtils.js");
      performAction.mockImplementation(real.performUnderstudyMethod);
      const fill = vi
        .spyOn(Locator.prototype, "fill")
        .mockImplementation(async (_value, progress) => {
          await progress!.delay(50);
        });
      const { captureSnapshot, generate, options } = fixture();
      const page = actPage({ evaluate: async () => "https://example.com" }, captureSnapshot);
      const result = actService.act({
        ...options,
        page,
        selfHeal: true,
        params: {
          pageId: "page-1",
          instruction: { ...action, method: "fill", arguments: ["hello"] },
          options: { timeout: 20 },
        },
      });
      const rejected = expect(result).rejects.toThrow("act() timed out after 20ms");
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      expect(fill).toHaveBeenCalledTimes(1);
      expect(captureSnapshot).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
    });

    it.each(["loading", "complete"])(
      "removes settling listeners & timers when act expires (%s)",
      async (state) => {
        const real = await vi.importActual<
          typeof import("../handlers/handlerUtils/actHandlerUtils.js")
        >("../handlers/handlerUtils/actHandlerUtils.js");
        waitForQuiet.mockImplementation(real.waitForDomNetworkQuiet);
        const session = Object.assign(new EventEmitter(), { send: vi.fn(async () => ({})) });
        const frame = {
          frameId: "main",
          session,
          evaluate: async () => state,
          waitForLoadState(this: Frame, ...args: Parameters<Frame["waitForLoadState"]>) {
            return Frame.prototype.waitForLoadState.apply(this, args);
          },
        } as unknown as Frame;
        const { captureSnapshot, generate, options } = fixture();
        const result = actService.act({
          ...options,
          page: actPage(frame, captureSnapshot),
          params: { pageId: "page-1", instruction: "Submit", options: { timeout: 20 } },
        });
        const rejected = expect(result).rejects.toThrow("act() timed out after 20ms");
        await vi.advanceTimersByTimeAsync(0);
        expect(session.eventNames().length).toBeGreaterThan(0);
        await vi.advanceTimersByTimeAsync(20);
        await rejected;
        expect(session.eventNames()).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
        expect(captureSnapshot).not.toHaveBeenCalled();
        expect(generate).not.toHaveBeenCalled();
      },
    );

    it("stops a drag between moves & releases the mouse after expiry", async () => {
      const send = vi.fn(async (_method: string, _event: { type: string }) => ({}));
      const page = { mainSession: { send }, updateCursor: async () => {} } as unknown as Page;
      const progress = new Progress("act()", 20);
      const result = Page.prototype.dragAndDrop.call(
        page,
        0,
        0,
        100,
        100,
        { steps: 5, delay: 50 },
        progress,
      );
      const rejected = expect(result).rejects.toThrow("act() timed out after 20ms");
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      expect(send.mock.calls.map(([, event]) => event.type)).toEqual([
        "mouseMoved",
        "mousePressed",
        "mouseMoved",
        "mouseReleased",
      ]);
      progress.dispose();
    });

    it("does not press the next key when a modifier response arrives after expiry", async () => {
      const keyDown = vi.fn(() => delay(undefined));
      const keyUp = vi.fn(async () => {});
      const page = { keyDown, keyUp, _pressedModifiers: new Set() } as unknown as Page;
      const progress = new Progress("act()", 20);
      const result = Page.prototype.keyPress.call(page, "Control+A", undefined, progress);
      const rejected = expect(result).rejects.toThrow("act() timed out after 20ms");
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      expect(keyDown.mock.calls).toEqual([["Control"]]);
      expect(keyUp.mock.calls).toEqual([["Control"]]);
      progress.dispose();
    });

    it.each([undefined, 0])("keeps timeout %s unlimited", async (timeout) => {
      const { generate, options } = fixture();
      generate.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60_000));
        return generation();
      });
      const result = actService.act({
        ...options,
        params: { pageId: "page-1", instruction: "Submit", options: { timeout } },
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect((await result).data.success).toBe(true);
    });
  });
});

function actGeneration(
  action: Record<string, string | string[]> | null,
  twoStep = false,
): LLMGenerateResult {
  return {
    role: "assistant",
    content: { type: "text", text: "structured action" },
    outputFormat: "json_schema",
    structuredContent: z.json().parse({ action, twoStep }),
    usage: {
      inputTokens: 11,
      outputTokens: 4,
      totalTokens: 15,
      reasoningTokens: 2,
      cachedInputTokens: 3,
    },
  };
}

function snapshot(elementId: string, xpath: string) {
  return {
    combinedTree: `[${elementId}] button: Target`,
    combinedXpathMap: { [elementId]: xpath },
    combinedUrlMap: {},
  };
}

function actPage(frame: object, captureSnapshot: ReturnType<typeof vi.fn>): Page {
  return {
    mainFrame: () => frame,
    captureSnapshot,
  } as unknown as Page;
}

function testLogger(): StagehandLogger {
  return new StagehandLogger({ tracer: trace.getTracer("act-service-test") }, () => {});
}
