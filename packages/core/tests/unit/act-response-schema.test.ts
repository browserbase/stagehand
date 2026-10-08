import { zodSchema } from "ai";
import { describe, expect, it, vi } from "vitest";
import { act } from "../../lib/inference.js";
import type { LLMClient } from "../../lib/v3/llm/LLMClient.js";

describe("act response schema", () => {
  it("requires strict objects inside the nullable action for OpenAI", async () => {
    const createChatCompletion = vi.fn().mockResolvedValue({
      data: { action: null, twoStep: false },
    });
    await act({
      instruction: "fill the email field",
      domElements: "[0-1] textbox: Email",
      llmClient: { createChatCompletion } as unknown as LLMClient,
      logger: vi.fn(),
    });

    const schema =
      createChatCompletion.mock.calls[0][0].options.response_model.schema;
    expect(zodSchema(schema).jsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          anyOf: [
            { type: "object", additionalProperties: false },
            { type: "null" },
          ],
        },
      },
    });
    expect(schema.safeParse({ action: null, twoStep: false }).success).toBe(
      true,
    );
    expect(
      schema.safeParse({
        action: {
          elementId: "0-1",
          description: "Email",
          method: "fill",
          arguments: ["john@example.com"],
        },
        twoStep: false,
      }).success,
    ).toBe(true);
  });
});
