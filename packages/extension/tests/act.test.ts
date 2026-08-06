import { trace } from "@opentelemetry/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import type { LLMGenerateParams, LLMGenerateResult } from "../../protocol/types.js";
import type { CacheClient } from "../clients/cacheClient.js";
import {
  performUnderstudyMethod,
  waitForDomNetworkQuiet,
} from "../handlers/handlerUtils/actHandlerUtils.js";
import { createStagehandController } from "../controllers/stagehandController.js";
import * as inference from "../inference.js";
import { StagehandLogger } from "../logger.js";
import type { StagehandRuntime } from "../runtime.js";
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

  it("performs a supplied Action without a model or inference", async () => {
    const frame = {};
    const captureSnapshot = vi.fn();
    const page = actPage(frame, captureSnapshot);
    const clientLLMGenerate = vi.fn();
    const logger = testLogger();

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
      clientLLMGenerate,
      logger,
    });

    expect(waitForQuiet).not.toHaveBeenCalled();
    expect(captureSnapshot).not.toHaveBeenCalled();
    expect(clientLLMGenerate).not.toHaveBeenCalled();
    expect(performAction).toHaveBeenCalledWith(
      page,
      frame,
      "click",
      "xpath=/html/body/button",
      [],
      logger,
      undefined,
    );
    expect(result.data).toMatchObject({
      success: true,
      actions: [{ selector: "xpath=/html/body/button" }],
    });
    expect(result.metadata.usage).toStrictEqual({
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      inferenceTimeMs: 0,
    });
  });

  it("does not attempt model-backed self-healing without a model", async () => {
    const captureSnapshot = vi.fn();
    const page = actPage({}, captureSnapshot);
    const clientLLMGenerate = vi.fn();
    performAction.mockRejectedValueOnce(new Error("Element detached"));

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
      clientLLMGenerate,
      logger: testLogger(),
      selfHeal: true,
    });

    expect(result.data).toMatchObject({
      success: false,
      message: "Failed to perform act: Element detached",
    });
    expect(captureSnapshot).not.toHaveBeenCalled();
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

describe("act controller", () => {
  beforeEach(() => {
    performAction.mockReset().mockResolvedValue();
    waitForQuiet.mockReset().mockResolvedValue();
  });

  it("allows a supplied Action through an initialization without a model", async () => {
    const page = actPage({}, vi.fn());
    const resolveUnderstudyPage = vi.fn(() => page);
    const runtime = {
      adapters: { clientLLMGenerate: vi.fn() },
      metrics: { record: vi.fn() },
      resolveUnderstudyPage,
      runWithTelemetryContext: vi.fn((_scope, _logger, run: () => unknown) => run()),
      state: {
        getState: () => ({
          status: "initialized",
          initParams: {
            domSettleTimeoutMs: 2_000,
            selfHeal: true,
            systemPrompt: "",
          },
        }),
      },
    } as unknown as StagehandRuntime;
    const controller = createStagehandController(runtime);

    await expect(
      controller.act(
        {
          pageId: "page-1",
          instruction: {
            selector: "xpath=/html/body/button",
            description: "Submit button",
            method: "click",
            arguments: [],
          },
        },
        { logger: testLogger(), telemetryScope: Symbol("act-controller-test") },
      ),
    ).resolves.toMatchObject({ data: { success: true } });

    expect(resolveUnderstudyPage).toHaveBeenCalledWith("page-1");
    expect(runtime.adapters.clientLLMGenerate).not.toHaveBeenCalled();
  });

  it("still rejects a natural-language instruction without a model", async () => {
    const resolveUnderstudyPage = vi.fn();
    const runtime = {
      adapters: { clientLLMGenerate: vi.fn() },
      metrics: { record: vi.fn() },
      resolveUnderstudyPage,
      runWithTelemetryContext: vi.fn((_scope, _logger, run: () => unknown) => run()),
      state: {
        getState: () => ({
          status: "initialized",
          initParams: { selfHeal: true, systemPrompt: "" },
        }),
      },
    } as unknown as StagehandRuntime;
    const controller = createStagehandController(runtime);

    await expect(
      controller.act(
        {
          pageId: "page-1",
          instruction: "Click the submit button",
        },
        { logger: testLogger(), telemetryScope: Symbol("act-controller-test") },
      ),
    ).rejects.toThrow("An LLM was not configured during Stagehand initialization");
    expect(resolveUnderstudyPage).not.toHaveBeenCalled();
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
