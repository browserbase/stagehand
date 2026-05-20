import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { extract as runExtract } from "../../lib/inference.js";
import type {
  CreateChatCompletionOptions,
  LLMClient,
} from "../../lib/v3/llm/LLMClient.js";
import { StagehandInvalidArgumentError } from "../../lib/v3/types/public/sdkErrors.js";

describe("extract screenshot prompt", () => {
  it("sends the viewport screenshot with the DOM tree on the extraction LLM call", async () => {
    const createChatCompletion = vi
      .fn()
      .mockResolvedValueOnce({
        data: { title: "Visible title" },
        usage: {
          prompt_tokens: 10,
          completion_tokens: 3,
          total_tokens: 13,
        },
      })
      .mockResolvedValueOnce({
        data: { completed: true, progress: "done" },
        usage: {
          prompt_tokens: 4,
          completion_tokens: 2,
          total_tokens: 6,
        },
      });

    const llmClient = {
      type: "aisdk",
      modelName: "gpt-4o",
      createChatCompletion,
    } as unknown as LLMClient;

    await runExtract({
      instruction: "extract the visible title",
      domElements: "RootWebArea [0-0] title",
      schema: z.object({ title: z.string() }),
      llmClient,
      logger: vi.fn(),
      screenshot: Buffer.from("viewport-image"),
    });

    const firstCall = createChatCompletion.mock
      .calls[0][0] as CreateChatCompletionOptions;
    const userMessage = firstCall.options.messages[1];

    expect(Array.isArray(userMessage.content)).toBe(true);
    if (!Array.isArray(userMessage.content)) {
      throw new Error("Expected multimodal user content");
    }

    expect(userMessage.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("DOM"),
        }),
        expect.objectContaining({
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${Buffer.from(
              "viewport-image",
            ).toString("base64")}`,
          },
        }),
      ]),
    );
    expect(userMessage.content[0]).toEqual(
      expect.objectContaining({
        text: expect.stringContaining("current viewport"),
      }),
    );
  });

  it("rejects screenshot payloads for non-AI SDK clients", async () => {
    const createChatCompletion = vi.fn();
    const llmClient = {
      type: "openai",
      modelName: "gpt-4o",
      createChatCompletion,
    } as unknown as LLMClient;

    await expect(
      runExtract({
        instruction: "extract the visible title",
        domElements: "RootWebArea [0-0] title",
        schema: z.object({ title: z.string() }),
        llmClient,
        logger: vi.fn(),
        screenshot: Buffer.from("viewport-image"),
      }),
    ).rejects.toThrow(StagehandInvalidArgumentError);

    expect(createChatCompletion).not.toHaveBeenCalled();
  });
});
