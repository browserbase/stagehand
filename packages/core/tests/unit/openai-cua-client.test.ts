import { describe, expect, it, vi } from "vitest";
import { OpenAICUAClient } from "../../lib/v3/agent/OpenAICUAClient.js";

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

function createClient() {
  return new OpenAICUAClient(
    "openai",
    "computer-use-preview-2025-03-11",
    undefined,
    { apiKey: "test-key" },
  );
}

function spyExecuteStep(client: OpenAICUAClient) {
  return vi.spyOn(
    client as unknown as {
      executeStep: (
        inputItems: unknown[],
        previousResponseId: string | undefined,
        logger: (message: { message: string }) => void,
      ) => Promise<ExecuteStepResult>;
    },
    "executeStep",
  );
}

const FOLLOW_UP_RESPONSE: ExecuteStepResult = {
  actions: [],
  message:
    "I've located the Submit button. Should I go ahead and submit it?",
  completed: true,
  nextInputItems: [],
  responseId: "response-1",
  usage: { input_tokens: 1, output_tokens: 1, inference_time_ms: 1 },
};

const COMPLETED_RESPONSE: ExecuteStepResult = {
  actions: [{ type: "click" }],
  message: "Submitted successfully.",
  completed: true,
  nextInputItems: [],
  responseId: "response-2",
  usage: { input_tokens: 1, output_tokens: 1, inference_time_ms: 1 },
};

describe("OpenAICUAClient", () => {
  it("auto-continues past follow-up questions after a captcha solve", async () => {
    const client = createClient();
    // Simulate a captcha context note being added (as the CUA handler does)
    client.addContextNote(
      "A captcha was automatically detected and solved — no further interaction needed.",
    );

    const executeStepSpy = spyExecuteStep(client)
      .mockResolvedValueOnce(FOLLOW_UP_RESPONSE)
      .mockResolvedValueOnce(COMPLETED_RESPONSE);

    const result = await client.execute({
      options: { instruction: "Submit the form.", maxSteps: 10 } as never,
      logger: vi.fn(),
    });

    expect(executeStepSpy).toHaveBeenCalledTimes(2);
    expect(executeStepSpy.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining([
        {
          role: "user",
          content: expect.stringContaining(
            "Do not ask follow up questions or request confirmation",
          ),
        },
      ]),
    );
    expect(result.completed).toBe(true);
    expect(result.message).toBe("Submitted successfully.");
  });

  it("does NOT auto-continue follow-up questions without a captcha context", async () => {
    const client = createClient();
    // No captcha context note — the model's confirmation should be respected

    const executeStepSpy = spyExecuteStep(client).mockResolvedValueOnce(
      FOLLOW_UP_RESPONSE,
    );

    const result = await client.execute({
      options: { instruction: "Submit the form.", maxSteps: 10 } as never,
      logger: vi.fn(),
    });

    // Should NOT have continued — the model's follow-up is treated as completion
    expect(executeStepSpy).toHaveBeenCalledTimes(1);
    expect(result.completed).toBe(true);
    expect(result.message).toBe(FOLLOW_UP_RESPONSE.message);
  });
});
