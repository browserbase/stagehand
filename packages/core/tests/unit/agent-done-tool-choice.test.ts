import { describe, expect, it } from "vitest";
import type { LanguageModelV2 } from "@ai-sdk/provider";

import { handleDoneToolCall } from "../../lib/v3/agent/utils/handleDoneToolCall.js";

const automaticToolChoiceModels = [
  "claude-sonnet-5-5",
  "claude-opus-5-5",
  "claude-fable-5-1",
].flatMap((modelId) => [modelId, `anthropic/${modelId}`]);

function modelMock(modelId: string, response: "done" | "text") {
  const toolChoices: unknown[] = [];
  const model = {
    specificationVersion: "v2",
    provider: "anthropic",
    modelId,
    supportedUrls: {},
    async doGenerate(options: Parameters<LanguageModelV2["doGenerate"]>[0]) {
      toolChoices.push(options.toolChoice);
      if (
        options.toolChoice?.type === "tool" ||
        options.toolChoice?.type === "required"
      ) {
        throw new Error(`${modelId} rejects forced tool use`);
      }
      return {
        finishReason: "stop" as const,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        content:
          response === "done"
            ? [
                {
                  type: "tool-call" as const,
                  toolCallId: "done-1",
                  toolName: "done",
                  input: JSON.stringify({
                    reasoning: "The task is complete.",
                    taskComplete: true,
                  }),
                },
              ]
            : [{ type: "text" as const, text: "The task needs review." }],
        warnings: [] as [],
      };
    },
  } as unknown as LanguageModelV2;
  return { model, toolChoices };
}

describe("v3 agent done tool choice", () => {
  it.each(automaticToolChoiceModels)(
    "lets %s call done without forcing tool use",
    async (modelId) => {
      const { model, toolChoices } = modelMock(modelId, "done");
      const result = await handleDoneToolCall({
        model,
        inputMessages: [{ role: "user", content: "The task is complete." }],
        instruction: "Complete the task",
        logger: () => {},
      });

      expect(toolChoices).toEqual([{ type: "auto" }]);
      expect(result.taskComplete).toBe(true);
      expect(result.reasoning).toBe("The task is complete.");
    },
  );

  it.each(automaticToolChoiceModels)(
    "keeps a text reply from %s as an incomplete result",
    async (modelId) => {
      const { model, toolChoices } = modelMock(modelId, "text");
      const result = await handleDoneToolCall({
        model,
        inputMessages: [{ role: "user", content: "The task is incomplete." }],
        instruction: "Complete the task",
        logger: () => {},
      });

      expect(toolChoices).toEqual([{ type: "auto" }]);
      expect(result.taskComplete).toBe(false);
      expect(result.reasoning).toBe("The task needs review.");
    },
  );
});
