import { zodSchema } from "ai";
import { describe, expect, it, vi } from "vitest";
import { act } from "../../lib/inference.js";
import type { LLMClient } from "../../lib/v3/llm/LLMClient.js";

// zod is a peer dependency (^3.25 || ^4); under Zod 3 the root import is v3.
vi.mock("zod", async () => await import("zod/v3"));

describe("act response schema with a Zod 3 peer", () => {
  it("builds the schema without Zod 4-only methods and keeps additionalProperties: false", async () => {
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
    expect(schema._zod).toBeUndefined();
    expect(await zodSchema(schema).jsonSchema).toMatchObject({
      properties: {
        action: {
          anyOf: [
            { type: "object", additionalProperties: false },
            { type: "null" },
          ],
        },
      },
    });
  });
});
