import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicCUAClient } from "../../lib/v3/agent/AnthropicCUAClient.js";
import { GoogleCUAClient } from "../../lib/v3/agent/GoogleCUAClient.js";
import { MicrosoftCUAClient } from "../../lib/v3/agent/MicrosoftCUAClient.js";
import { OpenAICUAClient } from "../../lib/v3/agent/OpenAICUAClient.js";

const { writeTimestampedTxtFile, appendSummary } = vi.hoisted(() => ({
  writeTimestampedTxtFile: vi.fn(() => ({
    fileName: "call.txt",
    timestamp: "20250705_120000",
  })),
  appendSummary: vi.fn(),
}));

vi.mock("../../lib/inferenceLogUtils.js", () => ({
  writeTimestampedTxtFile,
  appendSummary,
}));

type CuaStepResult = {
  actions: unknown[];
  message: string;
  completed: boolean;
  nextInputItems: unknown[];
  responseId?: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    inference_time_ms: number;
  };
};

type CuaClientCase = {
  name: string;
  createClient: () =>
    | AnthropicCUAClient
    | GoogleCUAClient
    | MicrosoftCUAClient
    | OpenAICUAClient;
  mockExecuteStep: (
    client:
      | AnthropicCUAClient
      | GoogleCUAClient
      | MicrosoftCUAClient
      | OpenAICUAClient,
  ) => void;
};

const completedStep: CuaStepResult = {
  actions: [],
  message: "done",
  completed: true,
  nextInputItems: [],
  responseId: "response-1",
  usage: { input_tokens: 1, output_tokens: 1, inference_time_ms: 1 },
};

function mockCuaExecuteStep(client: {
  executeStep: (...args: unknown[]) => Promise<CuaStepResult>;
}): void {
  vi.spyOn(client, "executeStep").mockImplementation(async (...args) => {
    const maybeCtx = args[args.length - 1];
    if (
      maybeCtx &&
      typeof maybeCtx === "object" &&
      "logCall" in maybeCtx &&
      typeof (maybeCtx as { logCall: unknown }).logCall === "function"
    ) {
      (maybeCtx as { logCall: (payload: unknown) => void }).logCall({
        mocked: true,
      });
    }
    return completedStep;
  });
}

const clientCases: CuaClientCase[] = [
  {
    name: "AnthropicCUAClient",
    createClient: () =>
      new AnthropicCUAClient(
        "anthropic",
        "claude-sonnet-4-20250514",
        undefined,
        { apiKey: "test-key" },
      ),
    mockExecuteStep: (client) => {
      mockCuaExecuteStep(
        client as unknown as {
          executeStep: (...args: unknown[]) => Promise<CuaStepResult>;
        },
      );
    },
  },
  {
    name: "GoogleCUAClient",
    createClient: () =>
      new GoogleCUAClient(
        "google",
        "gemini-2.5-computer-use-preview-10-2025",
        undefined,
        { apiKey: "test-key" },
      ),
    mockExecuteStep: (client) => {
      vi.spyOn(
        client as unknown as {
          executeStep: (
            logger: (message: { message: string }) => void,
          ) => Promise<CuaStepResult>;
        },
        "executeStep",
      ).mockResolvedValueOnce(completedStep);
    },
  },
  {
    name: "MicrosoftCUAClient",
    createClient: () =>
      new MicrosoftCUAClient("microsoft", "fara-7b", undefined, {
        apiKey: "test-key",
      }),
    mockExecuteStep: (client) => {
      mockCuaExecuteStep(
        client as unknown as {
          executeStep: (...args: unknown[]) => Promise<CuaStepResult>;
        },
      );
    },
  },
  {
    name: "OpenAICUAClient",
    createClient: () =>
      new OpenAICUAClient(
        "openai",
        "computer-use-preview-2025-03-11",
        undefined,
        { apiKey: "test-key" },
      ),
    mockExecuteStep: (client) => {
      mockCuaExecuteStep(
        client as unknown as {
          executeStep: (...args: unknown[]) => Promise<CuaStepResult>;
        },
      );
    },
  },
];

describe.each(clientCases)(
  "CUA client inference logging ($name)",
  ({ createClient, mockExecuteStep }) => {
    beforeEach(() => {
      writeTimestampedTxtFile.mockClear();
      appendSummary.mockClear();
      writeTimestampedTxtFile.mockReturnValue({
        fileName: "call.txt",
        timestamp: "20250705_120000",
      });
    });

    it("logs inference files when logInferenceToFile is enabled", async () => {
      const client = createClient();
      mockExecuteStep(client);

      await client.execute({
        options: { instruction: "Submit the form.", maxSteps: 10 } as never,
        logger: vi.fn(),
        logInferenceToFile: true,
      });

      expect(writeTimestampedTxtFile).toHaveBeenCalledWith(
        "agent_summary",
        "agent_run_start",
        expect.objectContaining({
          instruction: "Submit the form.",
          agentType: "cua",
        }),
      );
      expect(appendSummary).toHaveBeenCalledWith(
        "agent",
        expect.objectContaining({
          agent_inference_type: "agent_cua_step",
          step: 1,
        }),
      );
    });
  },
);
