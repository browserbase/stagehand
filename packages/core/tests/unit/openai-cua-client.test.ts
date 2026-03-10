import { describe, expect, it, vi } from "vitest";
import { OpenAICUAClient } from "../../lib/v3/agent/OpenAICUAClient.js";

describe("OpenAICUAClient", () => {
  it("continues when the model asks for confirmation instead of finishing", async () => {
    const client = new OpenAICUAClient(
      "openai",
      "computer-use-preview-2025-03-11",
      undefined,
      { apiKey: "test-key" },
    );

    const executeStepSpy = vi
      .spyOn(
        client as unknown as {
          executeStep: (
            inputItems: unknown[],
            previousResponseId: string | undefined,
            logger: (message: { message: string }) => void,
          ) => Promise<{
            actions: Array<{ type: string }>;
            message: string;
            completed: boolean;
            nextInputItems: unknown[];
            responseId: string;
            usage: {
              input_tokens: number;
              output_tokens: number;
              inference_time_ms: number;
            };
          }>;
        },
        "executeStep",
      )
      .mockResolvedValueOnce({
        actions: [],
        message: "I've located the Submit button. Should I go ahead and submit it?",
        completed: true,
        nextInputItems: [],
        responseId: "response-1",
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          inference_time_ms: 1,
        },
      })
      .mockResolvedValueOnce({
        actions: [{ type: "click" }],
        message: "Submitted successfully.",
        completed: true,
        nextInputItems: [],
        responseId: "response-2",
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          inference_time_ms: 1,
        },
      });

    const logger = vi.fn();
    const result = await client.execute({
      options: {
        instruction: "Submit the form.",
        maxSteps: 10,
      } as never,
      logger,
    });

    expect(executeStepSpy).toHaveBeenCalledTimes(2);
    expect(executeStepSpy.mock.calls[1]?.[0]).toEqual([
      {
        role: "user",
        content: expect.stringContaining(
          "Do not ask follow up questions or request confirmation",
        ),
      },
    ]);
    expect(result.completed).toBe(true);
    expect(result.message).toBe("Submitted successfully.");
  });
});
