import { test, expect } from "@playwright/test";
import { V3 } from "../../lib/v3/v3.js";
import { v3DynamicTestConfig } from "./v3.dynamic.config.js";
import { z } from "zod";
import { closeV3 } from "./testUtils.js";
import type { LLMClient } from "../../lib/v3/llm/LLMClient.js";
import { generateText } from "ai";

type AgentToolNameWithTimeout = "act" | "extract" | "fillForm" | "ariaTree";

type ToolTimeoutTestModel = {
  provider: string;
  modelId: string;
  specificationVersion: "v2";
  supportedUrls: Record<string, RegExp[]>;
  doGenerate: () => Promise<{
    content: Array<{
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: string;
    }>;
    finishReason: "tool-calls";
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
    warnings: [];
  }>;
  doStream: (_options: unknown) => Promise<never>;
};

type ToolTimeoutTestLLMClient = LLMClient & {
  model: ToolTimeoutTestModel;
};

function createToolTimeoutTestLlmClient(
  toolName: AgentToolNameWithTimeout,
  toolInput: Record<string, unknown>,
): ToolTimeoutTestLLMClient {
  const usage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    reasoning_tokens: 0,
    cached_input_tokens: 0,
    total_tokens: 0,
  };
  let generateCallCount = 0;

  const model: ToolTimeoutTestModel = {
    provider: "mock",
    modelId: "mock/tool-timeout-test",
    specificationVersion: "v2",
    supportedUrls: {},
    doGenerate: async () => {
      generateCallCount += 1;
      if (generateCallCount === 1) {
        return {
          content: [
            {
              type: "tool-call",
              toolCallId: "tool-1",
              toolName,
              input: JSON.stringify(toolInput),
            },
          ],
          finishReason: "tool-calls",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          warnings: [],
        };
      }

      return {
        content: [
          {
            type: "tool-call",
            toolCallId: "done-1",
            toolName: "done",
            input: JSON.stringify({ reasoning: "done", taskComplete: true }),
          },
        ],
        finishReason: "tool-calls",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        warnings: [],
      };
    },
    doStream: async () => {
      throw new Error("doStream not implemented in timeout test model");
    },
  };

  const llm = {
    type: "openai",
    modelName: "openai/gpt-4.1-mini",
    hasVision: false,
    clientOptions: {},
    model,
    getLanguageModel: () => model,
    generateText,
    createChatCompletion: async <T = unknown>(options: unknown): Promise<T> => {
      const responseModelName = (
        options as { options?: { response_model?: { name?: string } } }
      )?.options?.response_model?.name;

      if (responseModelName === "act") {
        return {
          data: {
            elementId: "1-0",
            description: "click body",
            method: "click",
            arguments: [],
            twoStep: false,
          },
          usage,
        } as T;
      }
      if (responseModelName === "Observation") {
        return { data: { elements: [] }, usage } as T;
      }
      if (responseModelName === "Extraction") {
        return { data: {}, usage } as T;
      }
      if (responseModelName === "Metadata") {
        return { data: { completed: true, progress: "" }, usage } as T;
      }
      return { data: {}, usage } as T;
    },
  };

  return llm as unknown as ToolTimeoutTestLLMClient;
}

function findToolOutput(
  stepEvents: Array<{
    toolCalls?: Array<{ toolName?: string }>;
    toolResults?: Array<{ output?: unknown }>;
  }>,
  toolName: string,
) {
  for (const event of stepEvents) {
    if (!event.toolCalls || !event.toolResults) continue;
    const toolIndex = event.toolCalls.findIndex(
      (tc) => tc.toolName === toolName,
    );
    if (toolIndex !== -1) {
      return event.toolResults[toolIndex]?.output;
    }
  }
  return undefined;
}

async function runAgentToolTimeoutScenario(
  toolName: AgentToolNameWithTimeout,
  toolInput: Record<string, unknown>,
) {
  const llmClient = createToolTimeoutTestLlmClient(toolName, toolInput);
  const stepEvents: Array<{
    toolCalls?: Array<{ toolName?: string }>;
    toolResults?: Array<{ output?: unknown }>;
  }> = [];
  const v3 = new V3({
    ...v3DynamicTestConfig,
    experimental: true,
    llmClient,
  });
  await v3.init();
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://example.com");
    const agent = v3.agent();
    await agent.execute({
      instruction: `Use ${toolName} and then finish`,
      maxSteps: 2,
      toolTimeout: 1,
      callbacks: {
        onStepFinish: (event) => {
          stepEvents.push({
            toolCalls: event.toolCalls?.map((tc) => ({
              toolName: tc.toolName,
            })),
            toolResults: event.toolResults?.map((tr) => ({
              output: tr.output,
            })),
          });
        },
      },
    });
    const toolOutput = findToolOutput(stepEvents, toolName);
    if (!toolOutput) {
      throw new Error(`No tool output captured for ${toolName}`);
    }
    return { toolOutput };
  } finally {
    await closeV3(v3);
  }
}

test.describe("V3 hard timeouts", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3DynamicTestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await closeV3(v3);
  });

  test("observe() enforces timeoutMs", async () => {
    // Tiny timeout to force the race to hit the timeout branch
    await expect(v3.observe("find something", { timeout: 5 })).rejects.toThrow(
      /timed out/i,
    );
  });

  test("extract() enforces timeoutMs", async () => {
    const schema = z.object({ title: z.string().optional() });
    await expect(
      v3.extract("Extract title", schema, { timeout: 5 }),
    ).rejects.toThrow(/timed out/i);
  });

  test("act() enforces timeoutMs", async () => {
    await expect(v3.act("do nothing", { timeout: 5 })).rejects.toThrow(
      /timed out/i,
    );
  });

  test("agent toolTimeout enforces timeout for act tool", async () => {
    const { toolOutput } = await runAgentToolTimeoutScenario("act", {
      action: "click somewhere",
    });
    const output = toolOutput as { success: boolean; error: string };
    expect(output.success).toBe(false);
    expect(output.error).toContain("TimeoutError");
  });

  test("agent toolTimeout enforces timeout for extract tool", async () => {
    const { toolOutput } = await runAgentToolTimeoutScenario("extract", {
      instruction: "extract the page title",
      schema: { type: "object", properties: { title: { type: "string" } } },
    });
    const output = toolOutput as { success: boolean; error: string };
    expect(output.success).toBe(false);
    expect(output.error).toContain("TimeoutError");
  });

  test("agent toolTimeout enforces timeout for fillForm tool", async () => {
    const { toolOutput } = await runAgentToolTimeoutScenario("fillForm", {
      fields: [{ action: "type hello into name", value: "hello" }],
    });
    const output = toolOutput as { success: boolean; error: string };
    expect(output.success).toBe(false);
    expect(output.error).toContain("TimeoutError");
  });

  test("agent toolTimeout enforces timeout for ariaTree", async () => {
    const { toolOutput } = await runAgentToolTimeoutScenario("ariaTree", {});
    const output = toolOutput as { success: boolean; error: string };
    expect(output.success).toBe(false);
    expect(output.error).toContain("TimeoutError");
  });
});
