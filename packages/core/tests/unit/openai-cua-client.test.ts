import { describe, expect, it, vi } from "vitest";
import { OpenAICUAClient } from "../../lib/v3/agent/OpenAICUAClient.js";

function createClient() {
  return new OpenAICUAClient(
    "openai",
    "computer-use-preview-2025-03-11",
    undefined,
    { apiKey: "test-key" },
  );
}

describe("OpenAICUAClient", () => {
  it("exposes captchaSolvedProceed tool after a captcha context note", () => {
    const client = createClient();

    // Before captcha note — tool should not be active
    expect(
      (client as unknown as { captchaSolvedToolActive: boolean })
        .captchaSolvedToolActive,
    ).toBe(false);

    // Simulate a captcha context note being added (as the CUA handler does)
    client.addContextNote(
      "A captcha was automatically detected and solved — no further interaction needed.",
    );

    expect(
      (client as unknown as { captchaSolvedToolActive: boolean })
        .captchaSolvedToolActive,
    ).toBe(true);
  });

  it("does NOT activate captcha tool for non-captcha context notes", () => {
    const client = createClient();

    client.addContextNote("The page has finished loading.");

    expect(
      (client as unknown as { captchaSolvedToolActive: boolean })
        .captchaSolvedToolActive,
    ).toBe(false);
  });

  it("deactivates captcha tool after takeAction handles the function call", async () => {
    const client = createClient();
    client.addContextNote("A captcha was solved.");

    expect(
      (client as unknown as { captchaSolvedToolActive: boolean })
        .captchaSolvedToolActive,
    ).toBe(true);

    // Simulate the model calling the captchaSolvedProceed tool
    const result = await (
      client as unknown as {
        takeAction: (
          output: unknown[],
          logger: (msg: unknown) => void,
        ) => Promise<unknown[]>;
      }
    ).takeAction(
      [
        {
          type: "function_call",
          name: "captchaSolvedProceed",
          call_id: "call-1",
          arguments: "{}",
        },
      ],
      vi.fn(),
    );

    // Tool should be deactivated
    expect(
      (client as unknown as { captchaSolvedToolActive: boolean })
        .captchaSolvedToolActive,
    ).toBe(false);

    // Result should contain a function_call_output confirming proceed
    expect(result).toEqual([
      {
        type: "function_call_output",
        call_id: "call-1",
        output: expect.stringContaining("Continue completing"),
      },
    ]);
  });

  it("does NOT auto-continue follow-up questions without a captcha context", async () => {
    const client = createClient();
    // No captcha context note — no tool should be exposed

    type ExecuteStepResult = {
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
    };

    const executeStepSpy = vi.spyOn(
      client as unknown as {
        executeStep: (
          inputItems: unknown[],
          previousResponseId: string | undefined,
          logger: (message: { message: string }) => void,
        ) => Promise<ExecuteStepResult>;
      },
      "executeStep",
    );

    executeStepSpy.mockResolvedValueOnce({
      actions: [],
      message:
        "I've located the Submit button. Should I go ahead and submit it?",
      completed: true,
      nextInputItems: [],
      responseId: "response-1",
      usage: { input_tokens: 1, output_tokens: 1, inference_time_ms: 1 },
    });

    const result = await client.execute({
      options: { instruction: "Submit the form.", maxSteps: 10 } as never,
      logger: vi.fn(),
    });

    // Should NOT have continued — the model's follow-up is treated as completion
    expect(executeStepSpy).toHaveBeenCalledTimes(1);
    expect(result.completed).toBe(true);
  });
});
