import { trace } from "@opentelemetry/api";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod/v4";
import type { LLMGenerateParams, LLMGenerateResult } from "../../protocol/types.js";
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
        input: "Fill in the email field",
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
      result: {
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
    });
  });

  it("preserves two-step action behavior", async () => {
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

    const result = await actService.act({
      params: { pageId: "page-1", input: "Choose Switzerland from the country dropdown" },
      page,
      model: { source: "client" },
      clientLLMGenerate,
      logger: testLogger(),
    });

    expect(clientLLMGenerate).toHaveBeenCalledTimes(2);
    expect(performAction).toHaveBeenCalledTimes(2);
    expect(result.result.success).toBe(true);
    expect(result.result.actions).toHaveLength(2);
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
      params: { pageId: "page-1", input: "Click the submit button" },
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
    expect(result.result).toMatchObject({
      success: true,
      actions: [{ selector: "xpath=/html/body/button[2]" }],
    });
  });

  it("returns a failed result when the model finds no action", async () => {
    const page = actPage(
      {},
      vi.fn(async () => snapshot("0-12", "/html/body/button")),
    );

    const result = await actService.act({
      params: { pageId: "page-1", input: "Click a missing button" },
      page,
      model: { source: "client" },
      clientLLMGenerate: vi.fn(async (): Promise<LLMGenerateResult> => actGeneration(null)),
      logger: testLogger(),
    });

    expect(performAction).not.toHaveBeenCalled();
    expect(result.result).toMatchObject({
      success: false,
      message: "Failed to perform act: No action found",
    });
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
          input: "Click the submit button",
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
