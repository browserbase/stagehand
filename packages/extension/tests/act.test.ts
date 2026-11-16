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
import { guardActionTarget } from "../services/decisions/actionGuard.js";
import * as decisionsPipeline from "../services/decisions/act.js";
import type { Page } from "../understudy/page.js";
import { Progress } from "../understudy/progress.js";

vi.mock("../handlers/handlerUtils/actHandlerUtils.js", () => ({
  performUnderstudyMethod: vi.fn(),
  waitForDomNetworkQuiet: vi.fn(),
}));
vi.mock("../services/decisions/actionGuard.js", () => ({ guardActionTarget: vi.fn() }));

const performAction = vi.mocked(performUnderstudyMethod);
const waitForQuiet = vi.mocked(waitForDomNetworkQuiet);

describe("act inference", () => {
  it("runs one structured action call through the shared generator", async () => {
    const generate = vi.fn(async (_params: LLMGenerateParams): Promise<LLMGenerateResult> =>
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
    const generate = vi.fn(async (_params: LLMGenerateParams): Promise<LLMGenerateResult> =>
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
    const clientLLMGenerate = vi.fn(async (): Promise<LLMGenerateResult> =>
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

  it.each(["inferred", "supplied", "self-heal"] as const)(
    "preserves literal drag targets with variables for %s actions",
    async (route) => {
      const frame = {};
      const sourceXPath = "/html[1]/body[1]/button[1]";
      const targetXPath = "/html[1]/body[1]/x-%token%-%password%[1]/button[1]";
      const page = actPage(
        frame,
        vi.fn(async () => ({
          combinedTree: "[0-12] button: Card\n[0-13] button: Drop zone",
          combinedXpathMap: { "0-12": sourceXPath, "0-13": targetXPath },
          combinedUrlMap: {},
        })),
      );
      const action = {
        selector: `xpath=${sourceXPath}`,
        description: "Drag the card to the drop zone",
        method: "dragAndDrop",
        arguments: [`xpath=${targetXPath}`],
      };
      const clientLLMGenerate = vi.fn(async (): Promise<LLMGenerateResult> =>
        actGeneration({
          elementId: "0-12",
          description: action.description,
          method: action.method,
          arguments: ["0-13"],
        }),
      );
      if (route === "self-heal") {
        performAction.mockRejectedValueOnce(new Error("Element detached"));
      }

      const result = await actService.act({
        params: {
          pageId: "page-1",
          instruction: route === "inferred" ? action.description : action,
          options: {
            variables: {
              token: "sk-CANARY-token",
              password: { value: "CANARY-password", description: "Account password" },
            },
          },
        },
        page,
        model: { source: "client" },
        clientLLMGenerate,
        logger: testLogger(),
        selfHeal: route === "self-heal",
      });

      expect(performAction).toHaveBeenCalledTimes(route === "self-heal" ? 2 : 1);
      for (const call of performAction.mock.calls) {
        expect(call[2]).toBe("dragAndDrop");
        expect(call[3]).toBe(action.selector);
        expect(call[4]).toStrictEqual(action.arguments);
      }
      expect(result.data).toMatchObject({ success: true, actions: [action] });
      expect(JSON.stringify(result)).not.toContain("CANARY");
      expect(clientLLMGenerate).toHaveBeenCalledTimes(route === "supplied" ? 0 : 1);
    },
  );

  it("captures the requested locator scope and ignored locator subtrees", async () => {
    const frame = {};
    const captureSnapshot = vi.fn(async () => snapshot("0-12", "/html/body/button"));
    const page = actPage(frame, captureSnapshot);
    const clientLLMGenerate = vi.fn(async (): Promise<LLMGenerateResult> =>
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
    const clientLLMGenerate = vi.fn(async (): Promise<LLMGenerateResult> =>
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
    const clientLLMGenerate = vi.fn(async (): Promise<LLMGenerateResult> =>
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
    const page = Object.assign(actPage(frame, captureSnapshot), {
      url: () => "https://example.com",
      frames: () => [frame],
    });
    const get = vi.fn().mockResolvedValueOnce({ hit: false, cacheKey: "key" });
    const set = vi.fn().mockResolvedValue({ written: true, cacheKey: "key" });
    const cache = {
      sessionId: "session-1",
      client: { get, set } as unknown as CacheClient,
      defaultCaching: true as const,
    };
    const clientLLMGenerate = vi.fn(async (): Promise<LLMGenerateResult> =>
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
    const page = Object.assign(actPage(frame, captureSnapshot), {
      url: () => "https://example.com",
      frames: () => [frame],
    });
    const get = vi.fn();
    const set = vi.fn();
    const clientLLMGenerate = vi.fn(async (): Promise<LLMGenerateResult> =>
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
    evaluate: vi.fn(async () => ({})),
  } as unknown as Page;
}

function testLogger(): StagehandLogger {
  return new StagehandLogger({ tracer: trace.getTracer("act-service-test") }, () => {});
}

describe("plan-policy LLM handoff", () => {
  it("blocks an ineligible Luna fallback before execution or self-heal", async () => {
    performAction.mockReset();
    waitForQuiet.mockResolvedValue();
    const decision = vi
      .spyOn(decisionsPipeline, "runDecisionsAct")
      .mockResolvedValueOnce({ kind: "fallback", reason: "action_plan_abstained" });
    vi.mocked(guardActionTarget).mockResolvedValueOnce("target_disabled");
    const page = actPage(
      {},
      vi.fn(async () => snapshot("0-12", "/html/body/input")),
    );
    const result = await actService.act({
      params: { pageId: "page-1", instruction: "Fill Disabled input", options: { cache: false } },
      page,
      model: { source: "client" },
      clientLLMGenerate: vi.fn(async () =>
        actGeneration({
          elementId: "0-12",
          description: "Disabled input",
          method: "fill",
          arguments: ["blocked"],
        }),
      ),
      logger: testLogger(),
      decisions: { apiKey: "test" },
      selfHeal: true,
    });
    expect(result.data).toMatchObject({
      success: false,
      actions: [],
      message: expect.stringContaining("target_disabled"),
    });
    expect(performAction).not.toHaveBeenCalled();
    expect(guardActionTarget).toHaveBeenCalledWith(
      page,
      expect.objectContaining({ method: "fill" }),
      expect.anything(),
      "0-12",
      undefined,
    );
    decision.mockRestore();
  });
});

describe("experimental action side effects and replay", () => {
  beforeEach(() => {
    performAction.mockReset().mockResolvedValue();
    waitForQuiet.mockReset().mockResolvedValue();
    vi.mocked(guardActionTarget).mockReset().mockResolvedValue(undefined);
  });

  it("keeps locator scope and exclusions when healing an unresolved target", async () => {
    vi.mocked(guardActionTarget).mockResolvedValueOnce("target_unresolved");
    const captureSnapshot = vi.fn(async () => snapshot("0-20", "/html/body/main/button"));
    const result = await actService.act({
      params: {
        pageId: "page",
        instruction: { selector: "#stale", method: "click", description: "Submit", arguments: [] },
        options: { locator: { selector: "main" }, ignoreLocators: [{ selector: ".promo" }] },
      },
      page: actPage({}, captureSnapshot),
      logger: testLogger(),
      model: { source: "client" },
      decisions: { apiKey: "test" },
      selfHeal: true,
      clientLLMGenerate: vi.fn(async () =>
        actGeneration({
          elementId: "0-20",
          method: "click",
          description: "Submit",
          arguments: [],
        }),
      ),
    });
    expect(result.data.success).toBe(true);
    expect(captureSnapshot).toHaveBeenCalledExactlyOnceWith(
      {
        focusLocator: { selector: "main" },
        ignoreLocators: [{ selector: ".promo" }],
      },
      expect.any(Progress),
    );
  });

  it("does not retry a stale selector when self-heal returns an unmapped target", async () => {
    vi.mocked(guardActionTarget).mockResolvedValueOnce("target_unresolved");
    const result = await actService.act({
      params: {
        pageId: "page",
        instruction: {
          selector: "#stale",
          method: "click",
          description: "Submit",
          arguments: [],
        },
      },
      page: actPage(
        {},
        vi.fn(async () => snapshot("0-20", "/html/body/button")),
      ),
      logger: testLogger(),
      model: { source: "client" },
      decisions: { apiKey: "test" },
      selfHeal: true,
      clientLLMGenerate: vi.fn(async () =>
        actGeneration({
          elementId: "0-99",
          method: "click",
          description: "Submit",
          arguments: [],
        }),
      ),
    });
    expect(result.data).toMatchObject({ success: false, actions: [] });
    expect(performAction).not.toHaveBeenCalled();
  });

  it("rejects repurposed fallback targets before input", async () => {
    const resolver = vi
      .spyOn(decisionsPipeline, "runDecisionsAct")
      .mockResolvedValue({ kind: "fallback", reason: "unsupported" });
    const page = actPage(
      {},
      vi.fn(async () => snapshot("0-12", "/html/body/button")),
    );
    vi.spyOn(page, "evaluate")
      .mockResolvedValueOnce({ "0-12": { text: "Submit" } })
      .mockResolvedValueOnce({ "0-12": { text: "Delete" } });
    try {
      const result = await actService.act({
        params: { pageId: "page", instruction: "Submit", options: { cache: false } },
        page,
        logger: testLogger(),
        model: { source: "client" },
        decisions: { apiKey: "test" },
        clientLLMGenerate: vi.fn(async () =>
          actGeneration({
            elementId: "0-12",
            method: "click",
            description: "Submit",
            arguments: [],
          }),
        ),
      });
      expect(result.data).toMatchObject({ success: false, actions: [] });
      expect(performAction).not.toHaveBeenCalled();
    } finally {
      resolver.mockRestore();
    }
  });

  it("carries both drag identities through fallback before executing", async () => {
    const resolver = vi
      .spyOn(decisionsPipeline, "runDecisionsAct")
      .mockResolvedValue({ kind: "fallback", reason: "unsupported" });
    vi.mocked(guardActionTarget).mockResolvedValueOnce("drag_destination_target_replaced");
    const page = actPage(
      {},
      vi.fn(async () => ({
        combinedTree: "[0-12] button: Card\n[0-13] button: Drop zone",
        combinedXpathMap: { "0-12": "/html/body/button[1]", "0-13": "/html/body/button[2]" },
        combinedUrlMap: {},
      })),
    );
    try {
      const result = await actService.act({
        params: {
          pageId: "page",
          instruction: "Drag card to drop zone",
          options: { cache: false },
        },
        page,
        logger: testLogger(),
        model: { source: "client" },
        decisions: { apiKey: "test" },
        clientLLMGenerate: vi.fn(async () =>
          actGeneration({
            elementId: "0-12",
            method: "dragAndDrop",
            description: "Drag",
            arguments: ["0-13"],
          }),
        ),
      });
      expect(result.data).toMatchObject({ success: false, actions: [] });
      expect(guardActionTarget).toHaveBeenCalledExactlyOnceWith(
        page,
        expect.objectContaining({ arguments: ["xpath=/html/body/button[2]"] }),
        expect.any(Progress),
        "0-12",
        "0-13",
      );
      expect(performAction).not.toHaveBeenCalled();
    } finally {
      resolver.mockRestore();
    }
  });

  it("heals an unresolved explicit target before input and validates the new identity", async () => {
    vi.mocked(guardActionTarget).mockResolvedValueOnce("target_unresolved");
    const generate = vi.fn(async () =>
      actGeneration({ elementId: "0-20", method: "click", arguments: [], description: "Submit" }),
    );
    const page = actPage(
      {},
      vi.fn(async () => snapshot("0-20", "/html/body/button")),
    );
    const result = await actService.act({
      params: {
        pageId: "page",
        instruction: { selector: "#stale", method: "click", description: "Submit", arguments: [] },
      },
      page,
      logger: testLogger(),
      model: { source: "client" },
      clientLLMGenerate: generate,
      decisions: { apiKey: "test" },
      selfHeal: true,
    });
    expect(result.data.success).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(performAction).toHaveBeenCalledTimes(1);
    expect(guardActionTarget).toHaveBeenLastCalledWith(
      page,
      expect.objectContaining({ selector: "xpath=/html/body/button" }),
      expect.any(Progress),
      "0-20",
      undefined,
    );
  });

  it("checks the parent identity when LLM inference selects a text node", async () => {
    const resolver = vi
      .spyOn(decisionsPipeline, "runDecisionsAct")
      .mockResolvedValue({ kind: "fallback", reason: "unsupported" });
    const generate = vi.fn(async () =>
      actGeneration({ elementId: "0-16", method: "click", arguments: [], description: "Expand" }),
    );
    const page = actPage(
      {},
      vi.fn(async () => ({
        combinedTree: "[0-16] StaticText: Expand",
        combinedUrlMap: {},
        combinedXpathMap: { "0-14": "/html/body/div", "0-16": "/html/body/div/text()[1]" },
      })),
    );
    try {
      const result = await actService.act({
        params: { pageId: "page", instruction: "Expand", options: { cache: false } },
        page,
        logger: testLogger(),
        model: { source: "client" },
        clientLLMGenerate: generate,
        decisions: { apiKey: "test" },
      });
      expect(result.data.success).toBe(true);
      expect(guardActionTarget).toHaveBeenCalledWith(
        page,
        expect.objectContaining({ selector: "xpath=/html/body/div" }),
        expect.any(Progress),
        "0-14",
        undefined,
      );
    } finally {
      resolver.mockRestore();
    }
  });

  it("does not self-heal or run a second step after possible input", async () => {
    const resolver = vi
      .spyOn(decisionsPipeline, "runDecisionsAct")
      .mockResolvedValue({ kind: "fallback", reason: "unsupported" });
    performAction.mockRejectedValueOnce(new Error("Connection lost after input"));
    const generate = vi.fn(async () =>
      actGeneration(
        { elementId: "0-12", method: "click", arguments: [], description: "Submit" },
        true,
      ),
    );
    try {
      const result = await actService.act({
        params: { pageId: "page", instruction: "Submit the form", options: { cache: false } },
        page: actPage(
          {},
          vi.fn(async () => snapshot("0-12", "/html/body/button")),
        ),
        logger: testLogger(),
        model: { source: "client" },
        clientLLMGenerate: generate,
        decisions: { apiKey: "test" },
        selfHeal: true,
      });
      expect(result.data).toMatchObject({
        success: false,
        actions: [expect.objectContaining({ method: "click" })],
      });
      expect(generate).toHaveBeenCalledTimes(1);
      expect(performAction).toHaveBeenCalledTimes(1);
    } finally {
      resolver.mockRestore();
    }
  });

  it.each(["target_disabled", "execution_error"])(
    "does not replay the instruction after a partial cached sequence: %s",
    async (failure) => {
      const first = { selector: "#first", method: "click", arguments: [], description: "First" };
      const second = { selector: "#second", method: "click", arguments: [], description: "Second" };
      const frame = { frameId: "frame", getAccessibilityTree: vi.fn(async () => []) };
      const page = Object.assign(actPage(frame, vi.fn()), {
        frames: () => [frame],
        url: () => "https://example.org",
      });
      const generate = vi.fn();
      if (failure === "target_disabled")
        vi.mocked(guardActionTarget)
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce("target_disabled");
      else
        performAction.mockResolvedValueOnce().mockRejectedValueOnce(new Error("Lost after click"));
      const result = await actService.act({
        params: { pageId: "page", instruction: "Complete both steps" },
        page,
        logger: testLogger(),
        model: { source: "client" },
        clientLLMGenerate: generate,
        decisions: { apiKey: "test" },
        selfHeal: true,
        cache: {
          sessionId: "session",
          defaultCaching: true,
          client: {
            get: vi.fn(async () => ({ hit: true, value: [first, second], cacheKey: "key" })),
            set: vi.fn(),
          } as unknown as CacheClient,
        },
      });
      expect(result.data.success).toBe(false);
      expect(result.data.actions).toEqual(
        failure === "target_disabled" ? [first] : [first, second],
      );
      expect(performAction).toHaveBeenCalledTimes(failure === "target_disabled" ? 1 : 2);
      expect(generate).not.toHaveBeenCalled();
    },
  );
});
