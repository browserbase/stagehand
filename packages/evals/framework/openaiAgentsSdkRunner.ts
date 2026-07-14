/**
 * openaiAgentsSdkRunner — harness via the OpenAI Agents SDK (`@openai/agents`).
 *
 * Classification: bare-ISH, one notch above the raw provider loops. The SDK
 * runs its own agent loop (turn management, tool dispatch, tracing) but ships
 * no behavioral scaffolding: everything the agent knows comes from the
 * dev-supplied `instructions` string. We keep every SDK default untouched
 * except `maxTurns` (the step cap — the SDK's own default of 10 is far too
 * low for a browse task) — instructions carry only the configured skill-mode
 * prompt.
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
// The real @openai/agents-core throws `MaxTurnsExceededError` with exactly
// this message shape ("Max turns (${maxTurns}) exceeded" -- see
// @openai/agents-core/dist/runner/turnPreparation.js) and sets
// `error.name = "MaxTurnsExceededError"` (AgentsError's constructor does
// `this.name = new.target.name`). Match on either so a plain mocked Error
// with the same message (as our unit tests use) is also recognized.
const MAX_TURNS_EXCEEDED_NAME = "MaxTurnsExceededError";
const MAX_TURNS_EXCEEDED_MESSAGE = /^Max turns \(\d+\) exceeded$/;

function isMaxTurnsExceededError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === MAX_TURNS_EXCEEDED_NAME ||
    MAX_TURNS_EXCEEDED_MESSAGE.test(error.message)
  );
}

export interface OpenAiAgentsRunResult {
  finalOutput?: unknown;
  rawResponses?: Array<{
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  }>;
}

/**
 * The real `@openai/agents-core` `AgentsError` (base of `MaxTurnsExceededError`)
 * carries a `state?: RunState` -- `RunState.usage` is a getter returning the
 * real cumulative `Usage` (inputTokens/outputTokens/totalTokens), and
 * `_currentTurn` is a public field with the real turn count reached before
 * the cap fired. Without this, the exception path has no way to recover
 * real usage/turns since `sdk.run()` never returned a result.
 */
interface MaxTurnsExceededErrorState {
  state?: {
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
    _currentTurn?: number;
  };
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
  let providerTotalTokens: number | undefined;
  let loopError: unknown;
  let cappedOut = false;
  let modelTurns: number | undefined;

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
        const { output } = await recorder.execute(args);
        return output;
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
    providerTotalTokens = sumProviderTotalTokens(result.rawResponses);
    modelTurns = result.rawResponses?.length;
  } catch (error) {
    if (isMaxTurnsExceededError(error)) {
      // The SDK throws instead of returning a truncated result, unlike
      // vercel_ai_sdk/anthropic_sdk which end their loop and return normally.
      // Treat it as the same step-cap outcome those two report, not a
      // harness/SDK failure.
      cappedOut = true;
      // `sdk.run()` never returned, so `usage`/`modelTurns` above are still
      // at their zero/undefined defaults -- recover the real numbers from
      // the exception's own state instead of reporting a live run as 0/0.
      const state = (error as MaxTurnsExceededErrorState).state;
      if (state?.usage) {
        usage = {
          input_tokens: toFinite(state.usage.inputTokens),
          output_tokens: toFinite(state.usage.outputTokens),
        };
        providerTotalTokens = state.usage.totalTokens;
      }
      if (typeof state?._currentTurn === "number") {
        modelTurns = state._currentTurn;
      }
      input.logger.warn({
        category: HARNESS,
        message: `openai_agents_sdk hit the max-turns cap (${maxTurns})`,
        level: 0,
      });
    } else {
      loopError = error;
      input.logger.warn({
        category: HARNESS,
        message: `openai_agents_sdk run stopped before a normal result: ${stringifyLoopError(error)}`,
        level: 0,
      });
    }
  }

  return finalizeBareLoopResult({
    harness: HARNESS,
    toolCalls: recorder.calls,
    finalText,
    status: loopError ? "error" : cappedOut ? "aborted" : "complete",
    stopReason: loopError
      ? stringifyLoopError(loopError)
      : cappedOut
        ? `step cap reached (${maxTurns})`
        : undefined,
    usage,
    providerTotalTokens,
    // Steps are model turns when the SDK reports them (rawResponses is one
    // entry per turn); tool-call count alone undercounts runs that end with
    // a text-only turn. Fall back to tool calls when no result was returned.
    stepsUsed: modelTurns ?? recorder.calls.length,
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

/** `undefined` if no raw response reported a totalTokens field, so the caller can fall back to recomputing input+output. */
function sumProviderTotalTokens(
  responses: OpenAiAgentsRunResult["rawResponses"],
): number | undefined {
  let total: number | undefined;
  for (const response of responses ?? []) {
    if (typeof response.usage?.totalTokens === "number") {
      total = (total ?? 0) + response.usage.totalTokens;
    }
  }
  return total;
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
