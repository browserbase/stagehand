import { zodSchema } from "ai";
import { describe, expect, it, vi } from "vitest";
import { act } from "../../lib/inference.js";
import type { LLMClient } from "../../lib/v3/llm/LLMClient.js";
import { toJsonSchema } from "../../lib/v3/zodCompat.js";

async function captureActSchema() {
  const createChatCompletion = vi.fn().mockResolvedValue({
    data: { action: null, twoStep: false },
  });
  await act({
    instruction: "fill the email field",
    domElements: "[0-1] textbox: Email",
    llmClient: { createChatCompletion } as unknown as LLMClient,
    logger: vi.fn(),
  });
  return createChatCompletion.mock.calls[0][0].options.response_model.schema;
}

const strictNullableAction = {
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
};

describe("act response schema", () => {
  // generateObject (AI SDK clients) converts with the AI SDK's zodSchema.
  it("sets additionalProperties: false on the nullable action for the AI SDK converter", async () => {
    const schema = await captureActSchema();
    expect(await zodSchema(schema).jsonSchema).toMatchObject(
      strictNullableAction,
    );
  });

  // Direct provider clients convert with toJsonSchema.
  it("sets additionalProperties: false on the nullable action for toJsonSchema", async () => {
    const schema = await captureActSchema();
    expect(toJsonSchema(schema)).toMatchObject(strictNullableAction);
  });

  it("still strips unknown keys when parsing instead of rejecting them", async () => {
    const schema = await captureActSchema();
    const action = {
      elementId: "0-1",
      description: "Email",
      method: "fill",
      arguments: ["john@example.com"],
    };
    expect(schema.safeParse({ action: null, twoStep: false }).success).toBe(
      true,
    );
    expect(
      schema.parse({
        action: { ...action, reasoning: "matches the email field" },
        twoStep: false,
      }),
    ).toEqual({ action, twoStep: false });
  });
});
