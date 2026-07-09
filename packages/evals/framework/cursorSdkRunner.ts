/**
 * cursorSdkRunner — FULL-harness runner via the Cursor SDK (`@cursor/sdk`).
 *
 * Classification: this sits on the smart tier next to claude_code/codex, NOT
 * the bare tier — "the same runtime, harness, and models that power Cursor"
 * is the product's own description. The SDK runs Cursor's managed local agent
 * (its own loop, planning, retries, shell/file tools); we expose exactly one
 * custom tool (`browse`, same allowed-command gate as every other external
 * harness) and prompt the agent to use only that tool. The SDK does not
 * expose an allow-list to hard-disable its native shell tools, so the browse
 * gating here is prompt + custom-tool discipline rather than the Claude Code
 * canUseTool hard gate — recorded as a known limitation in the design doc.
 *
 * Auth: CURSOR_API_KEY (the SDK's own default env var). Model ids come from
 * Cursor's catalog (e.g. "composer-2.5" / "cursor/composer-2.5" via -m).
 *
 * Testability: pass `sdk` with a mocked { Agent } (Agent.create → send →
 * stream/wait).
 */
import type { AvailableModel } from "@browserbasehq/stagehand";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import type { PreparedExternalHarnessAdapter } from "./externalHarnessToolAdapter.js";
import { runBareBrowseCommand } from "./externalHarnessToolAdapter.js";
import {
  BROWSE_TOOL_DESCRIPTION,
  BROWSE_TOOL_NAME,
  buildBareLoopUserPrompt,
  stringifyLoopError,
  stripProviderPrefix,
} from "./bareLoopRunner.js";
import { parseEvalResultText } from "./evalResultParser.js";
import { cursorAdapter } from "./harnesses/cursorAdapter.js";
import {
  gradeExternalTrajectory,
  type ExternalHarnessVerifierConfig,
} from "./verifierAdapter.js";

type MetricValue = { count: number; value: number };
type CursorSdkMessage = Record<string, unknown>;

const HARNESS = "cursor_sdk";
export const DEFAULT_CURSOR_MODEL = "composer-2.5";

export interface CursorRunHandle {
  stream(): AsyncGenerator<CursorSdkMessage, void>;
  wait(): Promise<{
    status: string;
    result?: string;
    error?: { message: string; code?: string };
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
    };
  }>;
}

export interface CursorSdkAgentHandle {
  send(message: string): Promise<CursorRunHandle>;
  close(): void;
}

export interface CursorSdk {
  Agent: {
    create(options: Record<string, unknown>): Promise<CursorSdkAgentHandle>;
  };
}

export interface CursorSdkRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter: PreparedExternalHarnessAdapter;
  signal?: AbortSignal;
  /** Injectable for unit tests; defaults to the real @cursor/sdk Agent. */
  sdk?: CursorSdk;
  verifier?: ExternalHarnessVerifierConfig;
}

export function normalizeCursorModel(model: AvailableModel): string {
  if (model === ("cursor/default" as AvailableModel)) {
    return DEFAULT_CURSOR_MODEL;
  }
  if (model.includes("/") && !model.startsWith("cursor/")) {
    throw new EvalsError(
      `cursor_sdk harness only accepts cursor models (e.g. cursor/${DEFAULT_CURSOR_MODEL}); received "${model}".`,
    );
  }
  return stripProviderPrefix(model);
}

export function buildCursorPrompt(
  plan: ExternalHarnessTaskPlan,
  systemPromptAddendum: string,
): string {
  // Cursor's SDK has no separate system-prompt channel for local agents; the
  // skill-arm text rides at the top of the single prompt instead.
  return [
    systemPromptAddendum,
    `Use ONLY the custom "${BROWSE_TOOL_NAME}" tool for browser work — do not use your shell for browsing, and do not edit repository files.`,
    "",
    buildBareLoopUserPrompt(plan),
  ].join("\n");
}

export async function runCursorSdkAgent(
  input: CursorSdkRunnerInput,
): Promise<TaskResult> {
  const sdk = input.sdk ?? (await loadCursorSdk());
  if (!input.sdk && !process.env.CURSOR_API_KEY) {
    throw new EvalsError(
      "cursor_sdk harness requires CURSOR_API_KEY in the environment.",
    );
  }

  const messages: CursorSdkMessage[] = [];
  let finalText = "";
  let runStatus = "error";
  let stopReason: string | undefined;
  let usage:
    | { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number }
    | undefined;
  let iterationError: unknown;
  let agent: CursorSdkAgentHandle | undefined;

  try {
    agent = await sdk.Agent.create({
      model: { id: normalizeCursorModel(input.model) },
      name: `stagehand-evals-${input.plan.dataset}-${input.plan.taskId ?? "task"}`,
      local: {
        cwd: input.toolAdapter.cwd,
        customTools: {
          [BROWSE_TOOL_NAME]: {
            description: BROWSE_TOOL_DESCRIPTION,
            inputSchema: {
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
            execute: async (args: Record<string, unknown>) => {
              const { output } = await runBareBrowseCommand(
                input.toolAdapter,
                String(args.args ?? ""),
              );
              return output;
            },
          },
        },
      },
    });

    const run = await agent.send(
      buildCursorPrompt(input.plan, input.toolAdapter.systemPromptAddendum),
    );

    for await (const message of run.stream()) {
      if (input.signal?.aborted) {
        throw new EvalsError("cursor_sdk run aborted");
      }
      messages.push(message);
      logCursorMessage(input.logger, message);
    }

    const result = await run.wait();
    runStatus = result.status;
    finalText = result.result ?? "";
    usage = result.usage;
    if (result.error) {
      stopReason = result.error.message;
    }
  } catch (error) {
    iterationError = error;
    input.logger.warn({
      category: HARNESS,
      message: `Cursor stopped before a normal result: ${stringifyLoopError(error)}`,
      level: 0,
    });
  } finally {
    try {
      agent?.close();
    } catch {
      // best-effort only
    }
  }

  const parsed = parseEvalResultText(finalText);
  const completed = runStatus === "finished" && !iterationError;
  const errorMessage =
    parsed.summary ??
    stopReason ??
    (stringifyLoopError(iterationError) ||
      finalText ||
      "Cursor did not report success");

  const baseResult: TaskResult = {
    _success: parsed.success,
    error: !parsed.success ? errorMessage : undefined,
    reasoning: parsed.summary,
    finalAnswer: parsed.finalAnswer,
    rawResult: parsed.raw,
    cursorStatus: completed ? "completed" : "sdk_error",
    ...(stopReason && { cursorStopReason: stopReason }),
    logs: input.logger.getLogs(),
    metrics: buildCursorMetrics(usage, messages),
  };

  if (!input.verifier) {
    return baseResult;
  }

  const verifier = input.verifier;
  return gradeExternalTrajectory({
    buildTrajectory: () =>
      cursorAdapter.fromHarnessResult(
        {
          messages,
          finalAnswer: parsed.finalAnswer ?? finalText,
          status: completed ? "complete" : "error",
          ...(usage && {
            usage: {
              input_tokens: toFinite(usage.inputTokens),
              output_tokens: toFinite(usage.outputTokens),
              ...(usage.cacheReadTokens !== undefined && {
                cached_input_tokens: toFinite(usage.cacheReadTokens),
              }),
            },
          }),
        },
        verifier.taskSpec,
      ),
    verifier,
    baseResult,
    errorMessage,
    category: HARNESS,
    logger: input.logger,
  });
}

function buildCursorMetrics(
  usage:
    | { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number }
    | undefined,
  messages: CursorSdkMessage[],
): Record<string, MetricValue> {
  const toolCalls = messages.filter(
    (message) => message.type === "tool_call" && message.status !== "running",
  ).length;
  return {
    cursor_tool_calls: metricValue(toolCalls),
    cursor_input_tokens: metricValue(usage?.inputTokens),
    cursor_output_tokens: metricValue(usage?.outputTokens),
    cursor_cache_read_tokens: metricValue(usage?.cacheReadTokens),
    cursor_total_tokens: metricValue(
      toFinite(usage?.inputTokens) + toFinite(usage?.outputTokens),
    ),
  };
}

function logCursorMessage(logger: EvalLogger, message: CursorSdkMessage): void {
  const type = String(message.type ?? "unknown");
  let summary = `${type} message`;
  if (type === "tool_call") {
    summary =
      `tool: ${String(message.name ?? "")} ${String(message.status ?? "")}`.trim();
  } else if (type === "status") {
    summary = `status: ${String(message.status ?? "")}`;
  } else if (type === "thinking" && typeof message.text === "string") {
    summary = `thinking: ${clip(message.text, 200)}`;
  } else if (type === "assistant") {
    summary = "assistant message";
  }
  logger.log({
    category: HARNESS,
    message: summary,
    level: 1,
    auxiliary: {
      type: { value: type, type: "string" },
    },
  });
}

function metricValue(value: unknown): MetricValue {
  return { count: 1, value: toFinite(value) };
}

function toFinite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clip(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
}

async function loadCursorSdk(): Promise<CursorSdk> {
  try {
    const mod = (await import("@cursor/sdk")) as { Agent?: CursorSdk["Agent"] };
    if (!mod.Agent || typeof mod.Agent.create !== "function") {
      throw new Error("Agent export missing");
    }
    return { Agent: mod.Agent };
  } catch (error) {
    throw new EvalsError(
      `cursor_sdk harness requires @cursor/sdk. Install it in packages/evals before running --harness cursor_sdk. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
