import { test, expect } from "@playwright/test";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import { V3 } from "../../lib/v3/v3.js";
import { AISdkClient } from "../../lib/v3/llm/aisdk.js";
import { v3TestConfig } from "./v3.config.js";

test.describe("Stagehand agent invalid done handling", () => {
  let v3: V3;

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("does not terminate when model emits an invalid done call", async () => {
    test.setTimeout(60000);

    let callCount = 0;

    const model: LanguageModelV2 = {
      specificationVersion: "v2",
      provider: "mock-provider",
      modelId: "mock-agent-model",
      supportedUrls: {},
      async doGenerate() {
        callCount += 1;

        if (callCount === 1) {
          // done is not an available runtime tool; this should be parsed as invalid/dynamic.
          return {
            content: [
              {
                type: "tool-call",
                toolCallType: "function",
                toolCallId: "call_done_1",
                toolName: "done",
                input: JSON.stringify({
                  reasoning: "done enough",
                  taskComplete: false,
                }),
              },
            ],
            finishReason: "tool-calls",
            usage: {
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
            },
            warnings: [],
          };
        }

        if (callCount === 2) {
          return {
            content: [{ type: "text", text: "continuing execution" }],
            finishReason: "stop",
            usage: {
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
            },
            warnings: [],
          };
        }

        // ensureDone() forces a done tool call at the end.
        return {
          content: [
            {
              type: "tool-call",
              toolCallType: "function",
              toolCallId: "call_done_2",
              toolName: "done",
              input: JSON.stringify({
                reasoning: "task fully complete",
                taskComplete: true,
              }),
            },
          ],
          finishReason: "tool-calls",
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
          },
          warnings: [],
        };
      },
      async doStream() {
        throw new Error("streaming not implemented for this test model");
      },
    };

    v3 = new V3({
      ...v3TestConfig,
      experimental: true,
      llmClient: new AISdkClient({ model }),
    });
    await v3.init();

    const seenToolCalls: Array<{ toolName: string; invalid?: boolean }> = [];
    const result = await v3.agent().execute({
      instruction: "Complete a simple multi-step task.",
      maxSteps: 5,
      callbacks: {
        onStepFinish: async (event) => {
          for (const tc of event.toolCalls ?? []) {
            seenToolCalls.push({
              toolName: tc.toolName,
              invalid: "invalid" in tc ? tc.invalid : undefined,
            });
          }
        },
      },
    });

    // 3 calls means: invalid done step, continued main-loop step, then ensureDone step.
    expect(callCount).toBe(3);
    expect(
      seenToolCalls.some((tc) => tc.toolName === "done" && tc.invalid === true),
    ).toBe(true);
    expect(result.completed).toBe(true);
  });
});
