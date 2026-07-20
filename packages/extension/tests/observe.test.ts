import { trace } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vite-plus/test";
import type { LLMGenerateParams, LLMGenerateResult } from "../../protocol/types.js";
import * as inference from "../inference.js";
import { StagehandLogger } from "../logger.js";
import * as observeService from "../services/observeService.js";

describe("observe inference", () => {
  it("runs one structured observation call and exposes variable placeholders", async () => {
    const generate = vi.fn(
      async (_params: LLMGenerateParams): Promise<LLMGenerateResult> => observationResult(),
    );

    const result = await inference.observe({
      instruction: "Find the email field",
      domElements: "[0-12] textbox: Email",
      generate,
      userProvidedInstructions: "Prefer visible form controls",
      supportedActions: ["click", "fill"],
      variables: {
        accountEmail: {
          value: "user@example.com",
          description: "The account email",
        },
      },
    });

    expect(result).toMatchObject({
      elements: [
        {
          elementId: "0-12",
          description: "Email field",
          method: "fill",
          arguments: ["%accountEmail%"],
        },
      ],
      prompt_tokens: 11,
      completion_tokens: 4,
      reasoning_tokens: 2,
      cached_input_tokens: 3,
    });
    expect(generate).toHaveBeenCalledTimes(1);
    const request = generate.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      responseFormat: { type: "json_schema", name: "Observation" },
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: expect.stringContaining("[0-12] textbox: Email"),
          },
        },
      ],
    });
    expect(request?.systemPrompt).toContain("%accountEmail% (The account email)");
    expect(request?.systemPrompt).toContain("Prefer visible form controls");
    expect(request?.systemPrompt).not.toContain("user@example.com");
  });

  it("rejects malformed structured observation output", async () => {
    const generate = vi.fn(
      async (_params: LLMGenerateParams): Promise<LLMGenerateResult> =>
        observationResult({
          elements: [
            {
              elementId: "12",
              description: "Invalid element ID",
              method: "click",
              arguments: [],
            },
          ],
        }),
    );

    await expect(
      inference.observe({
        instruction: "Find a button",
        domElements: "[0-12] button: Submit",
        generate,
      }),
    ).rejects.toThrow();
  });
});

describe("observe service", () => {
  it("captures the requested scope and resolves observed IDs to XPath actions", async () => {
    const captureSnapshot = vi.fn(async () => ({
      combinedTree: "[0-12] textbox: Email\n[0-20] listitem: Source\n[0-21] listitem: Target",
      combinedXpathMap: {
        "0-12": "/html/body/main/input/text()",
        "0-20": "/html/body/main/ul/li[1]",
        "0-21": "/html/body/main/ul/li[2]/text()",
      },
      combinedUrlMap: {},
    }));
    const clientLLMGenerate = vi.fn(
      async (_params: LLMGenerateParams): Promise<LLMGenerateResult> =>
        observationResult({
          elements: [
            {
              elementId: "0-12",
              description: "Email field",
              method: "fill",
              arguments: ["%accountEmail%"],
            },
            {
              elementId: "0-20",
              description: "Draggable source",
              method: "dragAndDrop",
              arguments: ["0-21"],
            },
            {
              elementId: "0-99",
              description: "Missing element",
              method: "click",
              arguments: [],
            },
          ],
        }),
    );
    const logs: unknown[] = [];
    const logger = new StagehandLogger({ tracer: trace.getTracer("observe-service-test") }, (log) =>
      logs.push(log),
    );

    const result = await observeService.observe({
      params: {
        pageId: "page-1",
        instruction: "Find form and drag controls",
        options: {
          selector: "xpath=//main",
          ignoreSelectors: ["nav"],
          variables: {
            accountEmail: {
              value: "user@example.com",
              description: "The account email",
            },
          },
        },
      },
      page: { captureSnapshot },
      model: { source: "client" },
      clientLLMGenerate,
      logger,
      systemPrompt: "Prefer visible controls",
      experimental: true,
    });

    expect(captureSnapshot).toHaveBeenCalledWith({
      experimental: true,
      focusSelector: "//main",
      ignoreSelectors: ["nav"],
    });
    expect(clientLLMGenerate).toHaveBeenCalledTimes(1);
    expect(result).toStrictEqual({
      result: [
        {
          selector: "xpath=/html/body/main/input",
          description: "Email field",
          method: "fill",
          arguments: ["%accountEmail%"],
        },
        {
          selector: "xpath=/html/body/main/ul/li[1]",
          description: "Draggable source",
          method: "dragAndDrop",
          arguments: ["xpath=/html/body/main/ul/li[2]"],
        },
      ],
    });
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          message: "Observed element could not be resolved to an XPath",
        }),
      ]),
    );
  });

  it("enforces the configured timeout at service checkpoints", async () => {
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(10);
    const clientLLMGenerate = vi.fn(async (): Promise<LLMGenerateResult> => observationResult());
    const logger = new StagehandLogger(
      { tracer: trace.getTracer("observe-timeout-test") },
      () => {},
    );

    try {
      await expect(
        observeService.observe({
          params: { pageId: "page-1", options: { timeout: 5 } },
          page: {
            captureSnapshot: async () => ({
              combinedTree: "[0-12] textbox: Email",
              combinedXpathMap: { "0-12": "/html/body/input" },
              combinedUrlMap: {},
            }),
          },
          model: { source: "client" },
          clientLLMGenerate,
          logger,
        }),
      ).rejects.toThrow("observe() timed out after 5ms");
      expect(clientLLMGenerate).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });
});

function observationResult(
  structuredContent: Extract<
    LLMGenerateResult,
    { outputFormat: "json_schema" }
  >["structuredContent"] = {
    elements: [
      {
        elementId: "0-12",
        description: "Email field",
        method: "fill",
        arguments: ["%accountEmail%"],
      },
    ],
  },
): LLMGenerateResult {
  return {
    role: "assistant",
    content: { type: "text", text: "structured observation" },
    outputFormat: "json_schema",
    structuredContent,
    usage: {
      inputTokens: 11,
      outputTokens: 4,
      totalTokens: 15,
      reasoningTokens: 2,
      cachedInputTokens: 3,
    },
  };
}
