import { trace } from "@opentelemetry/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import type { Page } from "../understudy/page.js";

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

    expect(waitForQuiet).toHaveBeenCalledWith(frame, logger, 2_000);
    expect(captureSnapshot).toHaveBeenCalledTimes(1);
    expect(performAction).toHaveBeenCalledWith(
      page,
      frame,
      "fill",
      "xpath=/html/body/input",
      ["user@example.com"],
      logger,
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

    expect(captureSnapshot).toHaveBeenCalledWith({
      focusLocator: { selector: "main", nth: 1 },
      ignoreLocators: [{ selector: "nav" }, { selector: ".cookie-banner", nth: 0 }],
    });
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
    expect(captureSnapshot).toHaveBeenCalledWith({
      focusLocator: { selector: "main", nth: 1 },
      ignoreLocators: [{ selector: ".promo", nth: 0 }],
    });
    expect(clientLLMGenerate).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(frame.getAccessibilityTree).not.toHaveBeenCalled();
  });

  it("respects the act timeout across page preparation", async () => {
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(6);
    const page = actPage(
      {},
      vi.fn(async () => snapshot("0-12", "/html/body/button")),
    );
    const clientLLMGenerate = vi.fn(
      async (): Promise<LLMGenerateResult> =>
        actGeneration({
          elementId: "0-12",
          description: "Submit button",
          method: "click",
          arguments: [],
        }),
    );

    await expect(
      actService.act({
        params: {
          pageId: "page-1",
          instruction: "Click the submit button",
          options: { timeout: 5 },
        },
        page,
        model: { source: "client" },
        clientLLMGenerate,
        logger: testLogger(),
      }),
    ).rejects.toThrow("act() timed out after 5ms");

    expect(clientLLMGenerate).not.toHaveBeenCalled();
    now.mockRestore();
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
