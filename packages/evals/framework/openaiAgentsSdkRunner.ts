/**
 * openaiAgentsSdkRunner — harness via the OpenAI Agents SDK (`@openai/agents`).
 *
 * Classification: bare-ISH, one notch above the raw provider loops. The SDK
 * runs its own agent loop (turn management, tool dispatch, tracing) but ships
 * no behavioral scaffolding: everything the agent knows comes from the
 * dev-supplied `instructions` string. Per the design doc we keep every SDK
 * default untouched except `maxTurns` (the step cap — the SDK's own default
 * of 10 is far too low for a browse task) — instructions carry only the
 * configured skill-arm prompt.
 *
 * Tool parameters use a plain JSON schema (not a zod schema) to sidestep the
 * SDK's zod version coupling; packages/evals pins zod v4 while the SDK's
 * zodCompat targeted v3 first.
 *
 * Testability: pass `sdk` with mocked { Agent, run, tool }.
 */
import type { AvailableModel } from "@browserbasehq/stagehand";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import type { PreparedExternalHarnessAdapter } from "./externalHarnessToolAdapter.js";
import { readBareLoopMaxSteps } from "./bareLoopConfig.js";
import {
  BROWSE_TOOL_DESCRIPTION,
  BROWSE_TOOL_NAME,
  buildBareLoopUserPrompt,
  createBareLoopToolRecorder,
  finalizeBareLoopResult,
  stringifyLoopError,
  stripProviderPrefix,
} from "./bareLoopRunner.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

const HARNESS = "openai_agents_sdk";
const MAX_TURNS_ENV = "EVAL_OPENAI_AGENTS_SDK_MAX_TURNS";

export interface OpenAiAgentsRunResult {
  finalOutput?: unknown;
  rawResponses?: Array<{
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
    };
  }>;
}

export interface OpenAiAgentsSdk {
  Agent: new (config: Record<string, unknown>) => unknown;
  run: (
    agent: unknown,
    input: string,
    options?: Record<string, unknown>,
  ) => Promise<OpenAiAgentsRunResult>;
  tool: (options: Record<string, unknown>) => unknown;
}

export interface OpenAiAgentsSdkRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter: PreparedExternalHarnessAdapter;
  signal?: AbortSignal;
  /** Injectable for unit tests; defaults to the real @openai/agents exports. */
  sdk?: OpenAiAgentsSdk;
  verifier?: ExternalHarnessVerifierConfig;
}

export function normalizeOpenAiAgentsModel(model: AvailableModel): string {
  if (model.includes("/") && !model.startsWith("openai/")) {
    throw new EvalsError(
      `openai_agents_sdk harness only accepts openai models; received "${model}".`,
    );
  }
  return stripProviderPrefix(model);
}

export async function runOpenAiAgentsSdkAgent(
  input: OpenAiAgentsSdkRunnerInput,
): Promise<TaskResult> {
  const sdk = input.sdk ?? (await loadOpenAiAgentsSdk());
  const maxTurns = readBareLoopMaxSteps(MAX_TURNS_ENV);
  const recorder = createBareLoopToolRecorder(
    input.toolAdapter,
    input.logger,
    HARNESS,
  );

  let finalText = "";
  let usage = { input_tokens: 0, output_tokens: 0 };
  let loopError: unknown;

  try {
    const browseTool = sdk.tool({
      name: BROWSE_TOOL_NAME,
      description: BROWSE_TOOL_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          args: {
            type: "string",
            description:
              'Everything after "browse", e.g. "open https://example.com".',
          },
        },
        required: ["args"],
        additionalProperties: false,
      },
      strict: true,
      execute: async (params: unknown) => {
        const args =
          params && typeof params === "object"
            ? String((params as Record<string, unknown>).args ?? "")
            : "";
        return recorder.execute(args);
      },
    });

    const agent = new sdk.Agent({
      name: "browse-bench-agent",
      instructions: input.toolAdapter.systemPromptAddendum,
      model: normalizeOpenAiAgentsModel(input.model),
      tools: [browseTool],
    });

    const result = await sdk.run(agent, buildBareLoopUserPrompt(input.plan), {
      maxTurns,
      ...(input.signal && { signal: input.signal }),
    });

    finalText =
      typeof result.finalOutput === "string"
        ? result.finalOutput
        : (safeJson(result.finalOutput) ?? "");
    usage = sumAgentsUsage(result.rawResponses);
  } catch (error) {
    loopError = error;
    input.logger.warn({
      category: HARNESS,
      message: `openai_agents_sdk run stopped before a normal result: ${stringifyLoopError(error)}`,
      level: 0,
    });
  }

  return finalizeBareLoopResult({
    harness: HARNESS,
    toolCalls: recorder.calls,
    finalText,
    status: loopError ? "error" : "complete",
    stopReason: loopError ? stringifyLoopError(loopError) : undefined,
    usage,
    stepsUsed: recorder.calls.length,
    maxSteps: maxTurns,
    logger: input.logger,
    verifier: input.verifier,
  });
}

function sumAgentsUsage(responses: OpenAiAgentsRunResult["rawResponses"]): {
  input_tokens: number;
  output_tokens: number;
} {
  const totals = { input_tokens: 0, output_tokens: 0 };
  for (const response of responses ?? []) {
    totals.input_tokens += toFinite(response.usage?.inputTokens);
    totals.output_tokens += toFinite(response.usage?.outputTokens);
  }
  return totals;
}

function toFinite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeJson(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function loadOpenAiAgentsSdk(): Promise<OpenAiAgentsSdk> {
  try {
    const mod = (await import("@openai/agents")) as Partial<OpenAiAgentsSdk>;
    if (
      typeof mod.Agent !== "function" ||
      typeof mod.run !== "function" ||
      typeof mod.tool !== "function"
    ) {
      throw new Error("Agent/run/tool exports missing");
    }
    return { Agent: mod.Agent, run: mod.run, tool: mod.tool };
  } catch (error) {
    throw new EvalsError(
      `openai_agents_sdk harness requires @openai/agents. Install it in packages/evals before running --harness openai_agents_sdk. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
