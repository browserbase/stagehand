import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod/v4";
import type { LLMGenerateParams, LLMGenerateResult } from "../../protocol/types.js";
import { extract } from "../inference.js";

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
});
