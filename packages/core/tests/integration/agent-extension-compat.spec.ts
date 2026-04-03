import { test, expect } from "@playwright/test";
import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2Usage,
} from "@ai-sdk/provider";
import { tool } from "ai";
import { z } from "zod";
import { V3 } from "../../lib/v3/v3.js";
import { AISdkClient as ExternalAISdkClient } from "../../lib/v3/external_clients/aisdk.js";
import { AISdkClient as InternalAISdkClient } from "../../lib/v3/llm/aisdk.js";
import { closeV3 } from "./testUtils.js";
import { getV3TestConfig } from "./v3.config.js";

const DEFAULT_USAGE: LanguageModelV2Usage = {
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  reasoningTokens: 0,
  cachedInputTokens: 0,
};

function toolCallResponse(
  toolName: string,
  input: Record<string, unknown>,
  toolCallId = `${toolName}-1`,
): {
  content: LanguageModelV2Content[];
  finishReason: LanguageModelV2FinishReason;
  usage: LanguageModelV2Usage;
  warnings: [];
} {
  return {
    content: [
      {
        type: "tool-call",
        toolCallId,
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: "tool-calls",
    usage: DEFAULT_USAGE,
    warnings: [],
  };
}

function doneToolResponse(
  reasoning = "done",
  taskComplete = true,
  toolCallId = "done-1",
): {
  content: LanguageModelV2Content[];
  finishReason: LanguageModelV2FinishReason;
  usage: LanguageModelV2Usage;
  warnings: [];
} {
  return toolCallResponse("done", { reasoning, taskComplete }, toolCallId);
}

function createV2Model(
  onGenerate: (
    options: LanguageModelV2CallOptions,
    callIndex: number,
  ) => Promise<{
    content: LanguageModelV2Content[];
    finishReason: LanguageModelV2FinishReason;
    usage?: LanguageModelV2Usage;
    warnings?: [];
  }>,
): LanguageModelV2 {
  let callIndex = 0;

  return {
    provider: "mock",
    modelId: "mock/compat-v2",
    specificationVersion: "v2",
    supportedUrls: {},
    doGenerate: async (options) => {
      const result = await onGenerate(options, callIndex++);
      return {
        content: result.content,
        finishReason: result.finishReason,
        usage: result.usage ?? DEFAULT_USAGE,
        warnings: result.warnings ?? [],
      };
    },
    doStream: async () => {
      throw new Error("Streaming is not implemented for this test model.");
    },
  };
}

test.describe("Agent extension compatibility", () => {
  let v3: V3 | undefined;

  test.afterEach(async () => {
    await closeV3(v3);
    v3 = undefined;
  });

  test("extract works with the exported AISdkClient backed by LanguageModelV2", async () => {
    const client = new ExternalAISdkClient({
      model: createV2Model(async (options, callIndex) => {
        const responseFormat = options.responseFormat;

        if (responseFormat?.type !== "json") {
          throw new Error(`Unexpected non-json generate call ${callIndex}`);
        }

        const properties = (
          responseFormat.schema as { properties?: Record<string, unknown> }
        ).properties;

        const jsonResponse =
          properties && "completed" in properties && "progress" in properties
            ? { completed: true, progress: "Greeting extracted" }
            : { greeting: "Hello Stagehand" };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(jsonResponse),
            },
          ],
          finishReason: "stop",
        };
      }),
    });

    v3 = new V3(
      getV3TestConfig({
        llmClient: client,
      }),
    );
    await v3.init();
    const page = await v3.context.awaitActivePage();
    await page.goto("data:text/html,<main>Hello Stagehand</main>");

    const result = await v3.extract(
      "Extract the greeting from the page.",
      z.object({
        greeting: z.string(),
      }),
    );

    expect(result.greeting).toBe("Hello Stagehand");
  });

  test("agent.execute can call a user-provided custom tool", async () => {
    let toolInput: string | undefined;

    const echoTool = tool({
      description: "Echoes the provided text",
      inputSchema: z.object({
        input: z.string(),
      }),
      execute: async ({ input }) => {
        toolInput = input;
        return { echoed: input };
      },
    });

    const client = new InternalAISdkClient({
      model: createV2Model(async (_options, callIndex) => {
        if (callIndex === 0) {
          return toolCallResponse("echoTool", { input: "hello from tool" });
        }

        if (callIndex === 1) {
          return doneToolResponse("tool executed", true);
        }

        throw new Error(`Unexpected generate call ${callIndex}`);
      }),
    });

    v3 = new V3(
      getV3TestConfig({
        experimental: true,
        llmClient: client,
      }),
    );
    await v3.init();

    const agent = v3.agent({
      tools: {
        echoTool,
      },
    });

    const result = await agent.execute({
      instruction: "Use the echo tool once, then finish.",
      maxSteps: 3,
    });

    expect(toolInput).toBe("hello from tool");
    expect(result.completed).toBe(true);
  });
});
