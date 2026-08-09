import { describe, expect, it, vi } from "vitest";
import { AnthropicCUAClient } from "../../lib/v3/agent/AnthropicCUAClient.js";
import { GoogleCUAClient } from "../../lib/v3/agent/GoogleCUAClient.js";
import { MicrosoftCUAClient } from "../../lib/v3/agent/MicrosoftCUAClient.js";

const usage = {
  input_tokens: 0,
  output_tokens: 0,
  inference_time_ms: 0,
};

const noopLogger = vi.fn();

describe("CUA context note parity", () => {
  it("injects Anthropic context notes into the next turn only", async () => {
    const note = "captcha solved: continue and do not click again";
    const client = new AnthropicCUAClient(
      "anthropic",
      "anthropic/claude-sonnet-4-6",
      undefined,
      { apiKey: "test-key" },
    );

    const executeStepSpy = vi.spyOn(
      client as unknown as {
        executeStep: (
          inputItems: unknown[],
          logger: typeof noopLogger,
        ) => Promise<unknown>;
      },
      "executeStep",
    );

    let step = 0;
    executeStepSpy.mockImplementation(async () => {
      step += 1;
      return {
        actions: [],
        message: `step-${step}`,
        completed: step >= 3,
        nextInputItems: [],
        usage,
      };
    });

    client.addContextNote(note);

    await client.execute({
      options: { instruction: "test", maxSteps: 5 } as never,
      logger: noopLogger,
    });

    expect(executeStepSpy).toHaveBeenCalledTimes(3);

    const step2Input = executeStepSpy.mock.calls[1]?.[0] as Array<{
      role?: string;
      content?: string;
    }>;
    const step3Input = executeStepSpy.mock.calls[2]?.[0] as Array<{
      role?: string;
      content?: string;
    }>;

    expect(
      step2Input.some((item) => item.role === "user" && item.content === note),
    ).toBe(true);
    expect(
      step3Input.some((item) => item.role === "user" && item.content === note),
    ).toBe(false);
  });

  it("does not carry Anthropic context notes into a new execution after terminal step", async () => {
    const note = "captcha solved: continue and do not click again";
    const client = new AnthropicCUAClient(
      "anthropic",
      "anthropic/claude-sonnet-4-6",
      undefined,
      { apiKey: "test-key" },
    );

    const executeStepSpy = vi.spyOn(
      client as unknown as {
        executeStep: (
          inputItems: unknown[],
          logger: typeof noopLogger,
        ) => Promise<unknown>;
      },
      "executeStep",
    );

    const completedByCall = [true, false, true];
    let callIndex = 0;
    executeStepSpy.mockImplementation(async () => {
      const completed = completedByCall[callIndex] ?? true;
      callIndex += 1;
      return {
        actions: [],
        message: `step-${callIndex}`,
        completed,
        nextInputItems: [],
        usage,
      };
    });

    client.addContextNote(note);

    await client.execute({
      options: { instruction: "first run", maxSteps: 5 } as never,
      logger: noopLogger,
    });

    await client.execute({
      options: { instruction: "second run", maxSteps: 5 } as never,
      logger: noopLogger,
    });

    const secondRunStep2Input = executeStepSpy.mock.calls[2]?.[0] as Array<{
      role?: string;
      content?: string;
    }>;
    expect(
      secondRunStep2Input.some(
        (item) => item.role === "user" && item.content === note,
      ),
    ).toBe(false);
  });

  it("injects Google context notes once into history between turns", async () => {
    const note = "captcha solved: continue and do not click again";
    const client = new GoogleCUAClient(
      "google",
      "google/gemini-3-flash-preview",
    );

    const executeStepSpy = vi.spyOn(
      client as unknown as {
        executeStep: (logger: typeof noopLogger) => Promise<unknown>;
      },
      "executeStep",
    );

    let step = 0;
    let sawNoteBeforeSecondStep = false;
    executeStepSpy.mockImplementation(async () => {
      step += 1;

      if (step === 2) {
        const history = (
          client as unknown as {
            history: Array<{ role?: string; parts?: Array<{ text?: string }> }>;
          }
        ).history;
        sawNoteBeforeSecondStep = history.some(
          (entry) =>
            entry.role === "user" &&
            Array.isArray(entry.parts) &&
            entry.parts.some((part) => part.text === note),
        );
      }

      return {
        actions: [],
        message: `step-${step}`,
        completed: step >= 3,
        usage,
      };
    });

    client.addContextNote(note);

    await client.execute({
      options: { instruction: "test", maxSteps: 5 } as never,
      logger: noopLogger,
    });

    expect(executeStepSpy).toHaveBeenCalledTimes(3);
    expect(sawNoteBeforeSecondStep).toBe(true);

    const finalHistory = (
      client as unknown as {
        history: Array<{ role?: string; parts?: Array<{ text?: string }> }>;
      }
    ).history;
    const noteMessageCount = finalHistory.filter(
      (entry) =>
        entry.role === "user" &&
        Array.isArray(entry.parts) &&
        entry.parts.some((part) => part.text === note),
    ).length;
    expect(noteMessageCount).toBe(1);
  });

  it("does not carry Google context notes into a new execution after terminal step", async () => {
    const note = "captcha solved: continue and do not click again";
    const client = new GoogleCUAClient(
      "google",
      "google/gemini-3-flash-preview",
    );

    const executeStepSpy = vi.spyOn(
      client as unknown as {
        executeStep: (logger: typeof noopLogger) => Promise<unknown>;
      },
      "executeStep",
    );

    let callIndex = 0;
    let leakedInSecondRun = false;
    executeStepSpy.mockImplementation(async () => {
      callIndex += 1;

      if (callIndex === 3) {
        const history = (
          client as unknown as {
            history: Array<{ role?: string; parts?: Array<{ text?: string }> }>;
          }
        ).history;
        leakedInSecondRun = history.some(
          (entry) =>
            entry.role === "user" &&
            Array.isArray(entry.parts) &&
            entry.parts.some((part) => part.text === note),
        );
      }

      return {
        actions: [],
        message: `step-${callIndex}`,
        completed: callIndex === 1 || callIndex === 3,
        usage,
      };
    });

    client.addContextNote(note);

    await client.execute({
      options: { instruction: "first run", maxSteps: 5 } as never,
      logger: noopLogger,
    });

    await client.execute({
      options: { instruction: "second run", maxSteps: 5 } as never,
      logger: noopLogger,
    });

    expect(leakedInSecondRun).toBe(false);
  });

  it("injects Microsoft context notes once into conversation history between turns", async () => {
    const note = "captcha solved: continue and do not click again";
    const client = new MicrosoftCUAClient(
      "microsoft",
      "microsoft/fara-7b",
      undefined,
      {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
      },
    );

    const executeStepSpy = vi.spyOn(
      client as unknown as {
        executeStep: (
          logger: typeof noopLogger,
          isFirstRound?: boolean,
        ) => Promise<unknown>;
      },
      "executeStep",
    );

    let step = 0;
    let sawNoteBeforeSecondStep = false;
    executeStepSpy.mockImplementation(async () => {
      step += 1;

      if (step === 2) {
        const history = (
          client as unknown as {
            conversationHistory: Array<{ role?: string; content?: unknown }>;
          }
        ).conversationHistory;
        sawNoteBeforeSecondStep = history.some(
          (entry) => entry.role === "user" && entry.content === note,
        );
      }

      return {
        actions: [],
        completed: step >= 3,
        usage,
      };
    });

    client.addContextNote(note);

    await client.execute({
      options: { instruction: "test", maxSteps: 5 } as never,
      logger: noopLogger,
    });

    expect(executeStepSpy).toHaveBeenCalledTimes(3);
    expect(sawNoteBeforeSecondStep).toBe(true);

    const finalHistory = (
      client as unknown as {
        conversationHistory: Array<{ role?: string; content?: unknown }>;
      }
    ).conversationHistory;
    const noteMessageCount = finalHistory.filter(
      (entry) => entry.role === "user" && entry.content === note,
    ).length;
    expect(noteMessageCount).toBe(1);
  });

  it("does not carry Microsoft context notes into a new execution after terminal step", async () => {
    const note = "captcha solved: continue and do not click again";
    const client = new MicrosoftCUAClient(
      "microsoft",
      "microsoft/fara-7b",
      undefined,
      {
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
      },
    );

    const executeStepSpy = vi.spyOn(
      client as unknown as {
        executeStep: (
          logger: typeof noopLogger,
          isFirstRound?: boolean,
        ) => Promise<unknown>;
      },
      "executeStep",
    );

    let callIndex = 0;
    let leakedInSecondRun = false;
    executeStepSpy.mockImplementation(async () => {
      callIndex += 1;

      if (callIndex === 3) {
        const history = (
          client as unknown as {
            conversationHistory: Array<{ role?: string; content?: unknown }>;
          }
        ).conversationHistory;
        leakedInSecondRun = history.some(
          (entry) => entry.role === "user" && entry.content === note,
        );
      }

      return {
        actions: [],
        completed: callIndex === 1 || callIndex === 3,
        usage,
      };
    });

    client.addContextNote(note);

    await client.execute({
      options: { instruction: "first run", maxSteps: 5 } as never,
      logger: noopLogger,
    });

    await client.execute({
      options: { instruction: "second run", maxSteps: 5 } as never,
      logger: noopLogger,
    });

    expect(leakedInSecondRun).toBe(false);
  });
});
