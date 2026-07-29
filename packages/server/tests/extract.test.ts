import { trace } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import type { LLMGenerateParams, LLMGenerateResult } from "../../protocol/types.js";
import { extract } from "../inference.js";
import { StagehandLogger } from "../logger.js";
import * as cacheService from "../services/cacheService.js";
import * as extractService from "../services/extractService.js";

describe("extract inference", () => {
  it("runs extraction and completion metadata through structured LLM calls", async () => {
    const generate = vi.fn(async (params: LLMGenerateParams): Promise<LLMGenerateResult> => {
      const name = params.responseFormat?.type === "json_schema" && params.responseFormat.name;

      if (name === "Extraction") {
        return {
          role: "assistant" as const,
          content: { type: "text" as const, text: "structured extraction" },
          outputFormat: "json_schema" as const,
          structuredContent: { heading: "Example Domain" },
          usage: {
            inputTokens: 10,
            outputTokens: 4,
            totalTokens: 14,
            reasoningTokens: 1,
            cachedInputTokens: 2,
          },
        };
      }

      return {
        role: "assistant",
        content: { type: "text", text: "complete" },
        outputFormat: "json_schema",
        structuredContent: { progress: "The heading was extracted", completed: true },
        usage: {
          inputTokens: 3,
          outputTokens: 2,
          totalTokens: 5,
        },
      };
    });

    const result = await extract({
      instruction: "Extract the page heading",
      domElements: "[0-1] heading: Example Domain",
      schema: z.object({ heading: z.string() }),
      generate,
    });

    expect(result).toMatchObject({
      heading: "Example Domain",
      metadata: {
        progress: "The heading was extracted",
        completed: true,
      },
      prompt_tokens: 13,
      completion_tokens: 6,
      reasoning_tokens: 1,
      cached_input_tokens: 2,
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0]?.[0]).toMatchObject({
      responseFormat: { type: "json_schema", name: "Extraction" },
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: expect.stringContaining("[0-1] heading: Example Domain"),
          },
        },
      ],
    });
    expect(generate.mock.calls[1]?.[0]).toMatchObject({
      responseFormat: { type: "json_schema", name: "Metadata" },
    });
  });

  it("validates both structured LLM responses before returning data", async () => {
    const generate = vi.fn(
      async (): Promise<LLMGenerateResult> => ({
        role: "assistant",
        content: { type: "text", text: "invalid" },
        outputFormat: "json_schema",
        structuredContent: { heading: 42 },
      }),
    );

    await expect(
      extract({
        instruction: "Extract the page heading",
        domElements: "[0-1] heading: Example Domain",
        schema: z.object({ heading: z.string() }),
        generate,
      }),
    ).rejects.toThrow();
  });

  it("sends a viewport PNG alongside the accessibility tree", async () => {
    const screenshot = {
      type: "image" as const,
      data: "iVBORw0KGgo=",
      mimeType: "image/png",
    };
    const generate = vi.fn(
      async (params: LLMGenerateParams): Promise<LLMGenerateResult> =>
        structuredResult(
          params.responseFormat?.type === "json_schema" &&
            params.responseFormat.name === "Extraction"
            ? { heading: "Screenshot heading" }
            : { progress: "The heading was extracted", completed: true },
        ),
    );

    await extract({
      instruction: "Extract the heading shown in the screenshot",
      domElements: "[0-1] heading",
      schema: z.object({ heading: z.string() }),
      generate,
      screenshot,
    });

    const extractionRequest = generate.mock.calls[0]?.[0];
    expect(extractionRequest?.systemPrompt).toContain("a screenshot of the current viewport");
    expect(extractionRequest?.messages).toStrictEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: expect.stringContaining(
              "Use the screenshot of the current viewport together with the accessibility tree",
            ),
          },
          screenshot,
        ],
      },
    ]);
    expect(generate.mock.calls[1]?.[0].messages).toEqual([
      expect.objectContaining({
        content: expect.objectContaining({ type: "text" }),
      }),
    ]);
  });
});

describe("extract service", () => {
  it("captures and forwards a screenshot through a client-provided LLM", async () => {
    const withCache = vi.spyOn(cacheService, "withCache");
    const captureSnapshot = vi.fn(async () => ({
      combinedTree: "[0-1] heading",
      combinedXpathMap: {},
      combinedUrlMap: {},
    }));
    const screenshot = vi.fn(
      async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const clientLLMGenerate = vi.fn(
      async (params: LLMGenerateParams): Promise<LLMGenerateResult> =>
        structuredResult(
          params.responseFormat?.type === "json_schema" &&
            params.responseFormat.name === "Extraction"
            ? { heading: "Screenshot heading" }
            : { progress: "The heading was extracted", completed: true },
        ),
    );

    try {
      await extractService.extract({
        params: {
          pageId: "page-1",
          instruction: "Extract the screenshot heading",
          schema: z.json().parse(z.toJSONSchema(z.object({ heading: z.string() }))),
          options: {
            screenshot: true,
            locator: { selector: "main", nth: 1 },
            ignoreLocators: [{ selector: "nav" }, { selector: ".ad", nth: 2 }],
          },
        },
        page: { captureSnapshot, screenshot },
        model: { source: "client" },
        clientLLMGenerate,
        logger: testLogger(),
      });

      expect(withCache).not.toHaveBeenCalled();
      expect(captureSnapshot).toHaveBeenCalledWith({
        focusLocator: { selector: "main", nth: 1 },
        ignoreLocators: [{ selector: "nav" }, { selector: ".ad", nth: 2 }],
      });
      expect(screenshot).toHaveBeenCalledWith({ fullPage: false, type: "png" });
      expect(clientLLMGenerate.mock.calls[0]?.[0].messages).toEqual([
        {
          role: "user",
          content: [
            expect.objectContaining({ type: "text" }),
            {
              type: "image",
              data: "iVBORw0KGgo=",
              mimeType: "image/png",
            },
          ],
        },
      ]);
    } finally {
      withCache.mockRestore();
    }
  });

  it("checks the extraction timeout after screenshot capture", async () => {
    let currentTime = 0;
    const now = vi.spyOn(Date, "now").mockImplementation(() => currentTime);
    const clientLLMGenerate = vi.fn(async (): Promise<LLMGenerateResult> => structuredResult({}));

    try {
      await expect(
        extractService.extract({
          params: {
            pageId: "page-1",
            instruction: "Extract the heading",
            schema: z.json().parse(z.toJSONSchema(z.object({ heading: z.string() }))),
            options: { screenshot: true, timeout: 5 },
          },
          page: {
            captureSnapshot: async () => ({
              combinedTree: "[0-1] heading",
              combinedXpathMap: {},
              combinedUrlMap: {},
            }),
            screenshot: async () => {
              currentTime = 10;
              return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
            },
          },
          model: { source: "client" },
          clientLLMGenerate,
          logger: testLogger(),
        }),
      ).rejects.toThrow("extract() timed out after 5ms");
      expect(clientLLMGenerate).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it("checks the extraction timeout after screenshot encoding", async () => {
    let currentTime = 0;
    const now = vi.spyOn(Date, "now").mockImplementation(() => currentTime);
    const btoa = vi.spyOn(globalThis, "btoa").mockImplementation(() => {
      currentTime = 10;
      return "encoded-screenshot";
    });
    const clientLLMGenerate = vi.fn(async (): Promise<LLMGenerateResult> => structuredResult({}));

    try {
      await expect(
        extractService.extract({
          params: {
            pageId: "page-1",
            instruction: "Extract the heading",
            schema: z.json().parse(z.toJSONSchema(z.object({ heading: z.string() }))),
            options: { screenshot: true, timeout: 5 },
          },
          page: {
            captureSnapshot: async () => ({
              combinedTree: "[0-1] heading",
              combinedXpathMap: {},
              combinedUrlMap: {},
            }),
            screenshot: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          },
          model: { source: "client" },
          clientLLMGenerate,
          logger: testLogger(),
        }),
      ).rejects.toThrow("extract() timed out after 5ms");
      expect(clientLLMGenerate).not.toHaveBeenCalled();
    } finally {
      btoa.mockRestore();
      now.mockRestore();
    }
  });

  it("returns the standard data and metadata result shape", async () => {
    const generate = vi.fn(async (params: LLMGenerateParams): Promise<LLMGenerateResult> => {
      const name = params.responseFormat?.type === "json_schema" && params.responseFormat.name;
      if (name === "Extraction") {
        return {
          role: "assistant",
          content: { type: "text", text: "structured extraction" },
          outputFormat: "json_schema",
          structuredContent: { count: 1 },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      }
      return {
        role: "assistant",
        content: { type: "text", text: "metadata" },
        outputFormat: "json_schema",
        structuredContent: { progress: "Extracted the count", completed: true },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    });

    const result = await extractService.extract({
      params: {
        pageId: "page-1",
        instruction: "Extract the count",
        schema: z.json().parse(z.toJSONSchema(z.object({ count: z.number() }))),
      },
      page: {
        captureSnapshot: async () => ({
          combinedTree: "[0-1] text: 1",
          combinedXpathMap: {},
          combinedUrlMap: {},
        }),
        screenshot: async () => new Uint8Array(),
      },
      model: { source: "client" },
      clientLLMGenerate: generate,
      logger: new StagehandLogger({ tracer: trace.getTracer("extract-service-test") }, () => {}),
    });

    expect(result).toStrictEqual({ data: { count: 1 }, metadata: {} });
  });
});

function structuredResult(
  structuredContent: Extract<
    LLMGenerateResult,
    { outputFormat: "json_schema" }
  >["structuredContent"],
): LLMGenerateResult {
  return {
    role: "assistant",
    content: { type: "text", text: JSON.stringify(structuredContent) },
    outputFormat: "json_schema",
    structuredContent,
  };
}

function testLogger(): StagehandLogger {
  return new StagehandLogger({ tracer: trace.getTracer("extract-service-test") }, () => {});
}
