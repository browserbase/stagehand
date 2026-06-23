import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { sanitizeMessagesForResubmission } from "../../lib/v3/agent/utils/handleDoneToolCall.js";

describe("sanitizeMessagesForResubmission", () => {
  it("strips nested undefined from providerOptions (the gpt-5.x failure)", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "",
            // jsonValueSchema rejects undefined, so this is what breaks
            // standardizePrompt on re-submission.
            providerOptions: {
              openai: { itemId: "rs_1", reasoningEncryptedContent: undefined },
            },
          },
        ],
      },
    ] as unknown as ModelMessage[];

    const [msg] = sanitizeMessagesForResubmission(messages);
    const part = (
      msg.content as unknown as { providerOptions: { openai: object } }[]
    )[0];

    expect(part.providerOptions.openai).toEqual({ itemId: "rs_1" });
    expect("reasoningEncryptedContent" in part.providerOptions.openai).toBe(
      false,
    );
  });

  it("preserves null, primitives, and string content unchanged", () => {
    const messages = [
      { role: "system", content: "you are an agent" },
      { role: "user", content: "hi" },
    ] as unknown as ModelMessage[];

    expect(sanitizeMessagesForResubmission(messages)).toEqual(messages);
  });

  it("does not mutate the input messages", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "x", providerOptions: undefined }],
      },
    ] as unknown as ModelMessage[];

    sanitizeMessagesForResubmission(messages);
    const original = (messages[0].content as { providerOptions?: unknown }[])[0];
    expect("providerOptions" in original).toBe(true);
  });
});
