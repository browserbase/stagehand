import { describe, expect, it, vi } from "vitest";
import { MicrosoftCUAClient } from "../../lib/v3/agent/MicrosoftCUAClient.js";
import { FlowLogger } from "../../lib/v3/flowlogger/FlowLogger.js";

function createClient() {
  const client = new MicrosoftCUAClient("microsoft", "fara-7b", undefined, {
    apiKey: "test-key",
    baseURL: "https://example.com",
  });
  client.setScreenshotProvider(async () => "mock-base64-screenshot");
  return client;
}

describe("MicrosoftCUAClient", () => {
  it("emits FlowLogger request and response events for a successful model call", async () => {
    const client = createClient();
    const createCompletion = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content:
              'thoughts\n<tool_call>\n{"name":"computer_use","arguments":{"action":"terminate","status":"success"}}\n</tool_call>',
          },
        },
      ],
      usage: {
        prompt_tokens: 11,
        completion_tokens: 5,
        total_tokens: 16,
      },
    });

    (
      client as unknown as {
        client: {
          chat: { completions: { create: (...args: unknown[]) => unknown } };
        };
      }
    ).client = {
      chat: {
        completions: {
          create: createCompletion,
        },
      },
    };

    const requestSpy = vi.spyOn(FlowLogger, "logLlmRequest");
    const responseSpy = vi.spyOn(FlowLogger, "logLlmResponse");

    try {
      const result = await (
        client as unknown as {
          executeStep: (
            logger: (message: unknown) => void,
            isFirstRound?: boolean,
          ) => Promise<{ completed: boolean }>;
        }
      ).executeStep(vi.fn(), false);

      expect(result.completed).toBe(true);
      expect(createCompletion).toHaveBeenCalledTimes(1);
      expect(requestSpy).toHaveBeenCalledTimes(1);
      expect(responseSpy).toHaveBeenCalledTimes(1);

      const requestPayload = requestSpy.mock.calls[0]?.[0] as {
        requestId: string;
        model: string;
      };
      const responsePayload = responseSpy.mock.calls[0]?.[0] as {
        requestId: string;
        model: string;
        inputTokens: number;
        outputTokens: number;
        output: string;
      };

      expect(requestPayload.model).toBe("fara-7b");
      expect(responsePayload.model).toBe("fara-7b");
      expect(responsePayload.requestId).toBe(requestPayload.requestId);
      expect(responsePayload.inputTokens).toBe(11);
      expect(responsePayload.outputTokens).toBe(5);
      expect(responsePayload.output).toContain("terminate");
    } finally {
      requestSpy.mockRestore();
      responseSpy.mockRestore();
    }
  });

  it("emits only FlowLogger request event when model call fails", async () => {
    const client = createClient();
    const createCompletion = vi
      .fn()
      .mockRejectedValue(new Error("upstream model error"));

    (
      client as unknown as {
        client: {
          chat: { completions: { create: (...args: unknown[]) => unknown } };
        };
      }
    ).client = {
      chat: {
        completions: {
          create: createCompletion,
        },
      },
    };

    const requestSpy = vi.spyOn(FlowLogger, "logLlmRequest");
    const responseSpy = vi.spyOn(FlowLogger, "logLlmResponse");

    try {
      await expect(
        (
          client as unknown as {
            executeStep: (
              logger: (message: unknown) => void,
              isFirstRound?: boolean,
            ) => Promise<unknown>;
          }
        ).executeStep(vi.fn(), false),
      ).rejects.toThrow("upstream model error");

      expect(requestSpy).toHaveBeenCalledTimes(1);
      expect(responseSpy).not.toHaveBeenCalled();
      expect(createCompletion).toHaveBeenCalledTimes(1);
    } finally {
      requestSpy.mockRestore();
      responseSpy.mockRestore();
    }
  });
});
