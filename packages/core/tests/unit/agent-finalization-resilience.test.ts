import { describe, expect, it } from "vitest";
import { generateText, type ModelMessage } from "ai";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import { sanitizeMessagesForResubmission } from "../../lib/v3/agent/utils/handleDoneToolCall.js";

// A minimal mock model. generateText runs the AI SDK's prompt validation
// (standardizePrompt) before ever reaching the model, so this is enough to
// reproduce STG-2335: the forced "done" finalization re-submits the run
// history, and a tool-result whose output value contains an `undefined` field
// trips that validation with "Invalid prompt: messages must be a
// ModelMessage[]" — the AI SDK's JSON-value schema rejects `undefined`.
const mockModel = {
  specificationVersion: "v2",
  provider: "mock",
  modelId: "mock",
  supportedUrls: {},
  async doGenerate() {
    return {
      finishReason: "stop" as const,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      content: [{ type: "text" as const, text: "ok" }],
      warnings: [] as [],
    };
  },
} as unknown as LanguageModelV2;

// Mirrors PermitFlow's custom tool: an optional field (`matchedExpected`) is
// left `undefined` in the tool result, so the re-submitted tool-result carries
// an `undefined` inside output.value. Also includes a valid reasoning part
// (text: "") to confirm sanitization leaves real content intact.
const malformedHistory = [
  { role: "user", content: "do the task" },
  {
    role: "assistant",
    content: [
      {
        type: "reasoning",
        text: "",
        providerOptions: { openai: { itemId: "rs_1" } },
      },
      { type: "tool-call", toolCallId: "c1", toolName: "captureField", input: {} },
    ],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "c1",
        toolName: "captureField",
        output: {
          type: "json",
          value: { success: true, value: "permit", matchedExpected: undefined },
        },
      },
    ],
  },
] as unknown as ModelMessage[];

describe("v3 agent finalization: tool-result re-submission (STG-2335)", () => {
  it("reproduces the InvalidPromptError when an undefined tool-result field is re-submitted", async () => {
    await expect(
      generateText({ model: mockModel, messages: malformedHistory }),
    ).rejects.toThrow(/must be a ModelMessage\[\]/);
  });

  it("re-submission succeeds once undefined values are stripped", async () => {
    const result = await generateText({
      model: mockModel,
      messages: sanitizeMessagesForResubmission(malformedHistory),
    });
    expect(result.text).toBe("ok");
  });

  it("drops undefined fields but preserves all real content", () => {
    const cleaned = sanitizeMessagesForResubmission(malformedHistory);

    expect(cleaned).toHaveLength(3);
    expect(cleaned[0]).toEqual({ role: "user", content: "do the task" });

    // reasoning + tool-call survive on the assistant message.
    const assistant = cleaned[1].content as Array<{ type: string }>;
    expect(assistant.map((p) => p.type)).toEqual(["reasoning", "tool-call"]);

    // tool-result value keeps real fields, drops the undefined one.
    const toolResult = (
      cleaned[2].content as Array<{ output: { value: Record<string, unknown> } }>
    )[0];
    expect(toolResult.output.value).toEqual({ success: true, value: "permit" });
    expect("matchedExpected" in toolResult.output.value).toBe(false);
  });

  it("leaves class instances (URL, typed arrays) untouched", () => {
    const url = new URL("https://example.com");
    const bytes = new Uint8Array([1, 2, 3]);
    const messages = [
      {
        role: "user",
        content: [
          { type: "file", data: url, mediaType: "text/plain" },
          { type: "file", data: bytes, mediaType: "application/octet-stream" },
        ],
      },
    ] as unknown as ModelMessage[];

    const cleaned = sanitizeMessagesForResubmission(messages);
    const parts = cleaned[0].content as Array<{ data: unknown }>;
    expect(parts[0].data).toBeInstanceOf(URL);
    expect(parts[1].data).toBeInstanceOf(Uint8Array);
  });
});
