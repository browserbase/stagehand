/**
 * anthropicSdkRunner — bare-loop harness via the raw Anthropic SDK
 * (`@anthropic-ai/sdk`), a hand-rolled `tool_use` loop.
 *
 * This is the TS twin of the Python `while stop_reason == "tool_use"` loop
 * that dominates real-world Anthropic usage (and of the Modal sandbox
 * template's agent.mjs): call messages.create, execute every tool_use block,
 * append tool_results, repeat until the model stops or the step cap binds.
 * No retries, no planning, no memory — deliberately.
 *
 * Testability: pass `client` with a mocked `messages.create`.
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

const HARNESS = "anthropic_sdk";
const MAX_STEPS_ENV = "EVAL_ANTHROPIC_SDK_MAX_STEPS";
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

export interface AnthropicMessageResponse {
  content: AnthropicContentBlock[];
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
  };
}

export interface AnthropicMessagesClient {
  messages: {
    create(params: Record<string, unknown>): Promise<AnthropicMessageResponse>;
  };
}

export interface AnthropicSdkRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter: PreparedExternalHarnessAdapter;
  signal?: AbortSignal;
  /** Injectable for unit tests; defaults to a real Anthropic client. */
  client?: AnthropicMessagesClient;
  verifier?: ExternalHarnessVerifierConfig;
}

export function normalizeAnthropicModel(model: AvailableModel): string {
  if (model.includes("/") && !model.startsWith("anthropic/")) {
    throw new EvalsError(
      `anthropic_sdk harness only accepts anthropic models; received "${model}".`,
    );
  }
  return stripProviderPrefix(model);
}

const BROWSE_TOOL_DEFINITION = {
  name: BROWSE_TOOL_NAME,
  description: BROWSE_TOOL_DESCRIPTION,
  input_schema: {
    type: "object",
    properties: {
      args: {
        type: "string",
        description:
          'Everything after "browse", e.g. "open https://example.com".',
      },
    },
    required: ["args"],
  },
} as const;

export async function runAnthropicSdkAgent(
  input: AnthropicSdkRunnerInput,
): Promise<TaskResult> {
  const client = input.client ?? (await loadAnthropicClient());
  const maxSteps = readBareLoopMaxSteps(MAX_STEPS_ENV);
  const recorder = createBareLoopToolRecorder(
    input.toolAdapter,
    input.logger,
    HARNESS,
  );

  const messages: Array<Record<string, unknown>> = [
    { role: "user", content: buildBareLoopUserPrompt(input.plan) },
  ];
  const usageTotals = { input_tokens: 0, output_tokens: 0, cached: 0 };

  let finalText = "";
  let stepsUsed = 0;
  let loopError: unknown;
  let cappedOut = false;

  try {
    for (let step = 0; step < maxSteps; step++) {
      if (input.signal?.aborted) {
        throw new EvalsError("anthropic_sdk run aborted");
      }
      stepsUsed = step + 1;
      const response = await client.messages.create({
        model: normalizeAnthropicModel(input.model),
        max_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
        system: input.toolAdapter.systemPromptAddendum,
        messages,
        tools: [BROWSE_TOOL_DEFINITION],
      });

      usageTotals.input_tokens += response.usage?.input_tokens ?? 0;
      usageTotals.output_tokens += response.usage?.output_tokens ?? 0;
      usageTotals.cached += response.usage?.cache_read_input_tokens ?? 0;

      const textParts = response.content
        .filter((block) => block.type === "text" && block.text)
        .map((block) => block.text as string);
      if (textParts.length > 0) {
        finalText = textParts.join("\n");
      }

      if (response.stop_reason !== "tool_use") {
        return finish("complete");
      }

      const toolUses = response.content.filter(
        (block) => block.type === "tool_use",
      );
      const toolResults: Array<Record<string, unknown>> = [];
      for (const use of toolUses) {
        const args =
          use.input && typeof use.input === "object"
            ? String((use.input as Record<string, unknown>).args ?? "")
            : "";
        const output = await recorder.execute(
          args,
          textParts.join("\n") || undefined,
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id ?? "",
          content: output,
        });
      }

      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
    }
    cappedOut = true;
  } catch (error) {
    loopError = error;
    input.logger.warn({
      category: HARNESS,
      message: `anthropic_sdk loop stopped before a normal result: ${stringifyLoopError(error)}`,
      level: 0,
    });
  }

  return finish(loopError ? "error" : "complete");

  function finish(status: "complete" | "error"): Promise<TaskResult> {
    return finalizeBareLoopResult({
      harness: HARNESS,
      toolCalls: recorder.calls,
      finalText,
      status,
      stopReason: loopError
        ? stringifyLoopError(loopError)
        : cappedOut
          ? `step cap reached (${maxSteps})`
          : undefined,
      usage: {
        input_tokens: usageTotals.input_tokens,
        output_tokens: usageTotals.output_tokens,
        ...(usageTotals.cached > 0 && {
          cached_input_tokens: usageTotals.cached,
        }),
      },
      stepsUsed,
      maxSteps,
      logger: input.logger,
      verifier: input.verifier,
    });
  }
}

async function loadAnthropicClient(): Promise<AnthropicMessagesClient> {
  try {
    const mod = (await import("@anthropic-ai/sdk")) as unknown as {
      default?: new (
        options?: Record<string, unknown>,
      ) => AnthropicMessagesClient;
      Anthropic?: new (
        options?: Record<string, unknown>,
      ) => AnthropicMessagesClient;
    };
    const Ctor = mod.default ?? mod.Anthropic;
    if (typeof Ctor !== "function") {
      throw new Error("Anthropic export missing");
    }
    return new Ctor();
  } catch (error) {
    throw new EvalsError(
      `anthropic_sdk harness requires @anthropic-ai/sdk. Install it in packages/evals before running --harness anthropic_sdk. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
