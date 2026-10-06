import type { MCPClient } from "@ai-sdk/mcp";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, stepCountIs, type ToolSet } from "ai";
import { z } from "zod/v4";
import { costUsd } from "./pricing.ts";
import type { RunMetrics, TimelineStep } from "./results.ts";
import { MODEL, MODEL_ID, PROVIDER, requireEnv } from "./session.ts";
import type { ShowcaseTask, Workflow } from "./task.ts";

const MAX_STEPS = 60;

const OUTPUT_INSTRUCTIONS =
  "Complete the task, then reply with only a JSON object that matches the given JSON Schema. No prose, no code fences.";

export type AgentStep = Omit<TimelineStep, "t" | "kind"> & { startedAt: number; kind: string };

export type AgentRun = { metrics: RunMetrics; output: unknown; steps: AgentStep[] };

function parseJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Agent did not return JSON");
  return JSON.parse(text.slice(start, end + 1));
}

function describeCall(input: unknown): string {
  if (input && typeof input === "object") {
    const { code, actions } = input as { code?: string; actions?: unknown };
    if (typeof code === "string") return code.replace(/\s+/g, " ").trim().slice(0, 200);
    if (actions) return JSON.stringify(actions).slice(0, 160);
  }
  return JSON.stringify(input ?? {}).slice(0, 160);
}

// One loop for every agent lane, so the Playwright MCP agent and the Stagehand
// code-mode agent differ only in the MCP server and its instructions.
export async function runAgent<Schema extends z.ZodType>(
  workflow: Workflow<Schema>,
  task: ShowcaseTask<Schema>,
  client: MCPClient,
  toolInstructions: string,
): Promise<AgentRun> {
  const env = requireEnv();
  const started = Date.now();
  const steps: AgentStep[] = [];
  let stepStarted = started;
  let output: unknown;
  let success = false;
  let error: string | undefined;
  let usage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    reasoningTokens: 0,
  };
  let llmCalls = 0;

  try {
    const schema = JSON.stringify(z.toJSONSchema(workflow.schema));
    const result = await generateText({
      model:
        PROVIDER === "anthropic"
          ? createAnthropic({ apiKey: env.MODEL_API_KEY })(MODEL_ID)
          : createOpenAI({ apiKey: env.MODEL_API_KEY })(MODEL_ID),
      // OpenAI caches prefixes automatically; Anthropic only caches when asked.
      // Top-level cacheControl is Anthropic's standard setup for an agent loop,
      // so each agent is configured the way a real Claude agent would be.
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      // `ai` and `@ai-sdk/mcp` pin different @ai-sdk/provider-utils versions.
      tools: (await client.tools()) as ToolSet,
      stopWhen: stepCountIs(MAX_STEPS),
      instructions: `${toolInstructions}\n\n${OUTPUT_INSTRUCTIONS}`,
      prompt: `Start at ${task.startUrl}.\n\nTask: ${task.goal}\n\nJSON Schema:\n${schema}`,
      // Accumulated per step so tokens spent before a failure still count.
      onStepEnd: ({ usage: step, toolCalls }) => {
        llmCalls += 1;
        const stepUsage = {
          inputTokens: step.inputTokens ?? 0,
          outputTokens: step.outputTokens ?? 0,
          cachedInputTokens: step.inputTokenDetails.cacheReadTokens ?? 0,
          cacheWriteInputTokens: step.inputTokenDetails.cacheWriteTokens ?? 0,
          reasoningTokens: step.outputTokenDetails.reasoningTokens ?? 0,
        };
        usage = {
          inputTokens: usage.inputTokens + stepUsage.inputTokens,
          outputTokens: usage.outputTokens + stepUsage.outputTokens,
          cachedInputTokens: usage.cachedInputTokens + stepUsage.cachedInputTokens,
          cacheWriteInputTokens: usage.cacheWriteInputTokens + stepUsage.cacheWriteInputTokens,
          reasoningTokens: usage.reasoningTokens + stepUsage.reasoningTokens,
        };
        const now = Date.now();
        for (const call of toolCalls) {
          steps.push({
            startedAt: stepStarted,
            durationMs: now - stepStarted,
            kind: call.toolName,
            instruction: describeCall(call.input),
            ...stepUsage,
            cache: stepUsage.cachedInputTokens > 0 ? "HIT" : "MISS",
          });
        }
        stepStarted = now;
      },
    });
    if (result.steps.length >= MAX_STEPS && result.finishReason === "tool-calls") {
      throw new Error(`Agent hit the ${MAX_STEPS}-step limit before answering`);
    }
    output = workflow.schema.parse(parseJson(result.text));
    success = task.check(output as z.output<Schema>);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  return {
    metrics: {
      ...usage,
      costUsd: costUsd(MODEL, usage),
      durationMs: Date.now() - started,
      llmCalls,
      success,
      ...(error ? { error: error.slice(0, 500) } : {}),
    },
    output,
    steps,
  };
}
