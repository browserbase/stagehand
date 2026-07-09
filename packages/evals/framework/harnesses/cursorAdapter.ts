/**
 * cursorAdapter — converts a Cursor SDK (`@cursor/sdk`) run into a
 * `Trajectory` the verifier can consume.
 *
 * Input shape: the SDK's `run.stream()` yields `SDKMessage` events —
 * `assistant` (text + tool_use blocks), `tool_call` (name/args/result with a
 * running→completed|error status), `thinking`, `usage` (per-turn token
 * counts), and `status`. We accumulate the stream upstream in
 * `runCursorSdkAgent` and hand the full list here.
 *
 * Mapping:
 *   - Each terminal `tool_call` event (status completed|error) becomes one
 *     normalized tool call. Duplicate events for the same call_id collapse to
 *     the last (terminal) one.
 *   - `assistant` text blocks and `thinking` text buffered since the previous
 *     tool call fold into the next tool call's `reasoning`; trailing text
 *     becomes the finalAnswer fallback.
 *   - `usage` events sum into the trajectory usage.
 *
 * Like claude_code/codex, Cursor is a full harness: the runner does not own
 * the loop, so this adapter reverse-maps the harness's event stream.
 */
import type { TaskSpec, Trajectory } from "@browserbasehq/stagehand";
import {
  buildTrajectory,
  type NormalizedToolCall,
  type TrajectoryAdapter,
} from "./trajectoryAdapter.js";

export interface CursorRunResult {
  /** Raw SDKMessage stream collected during execution, in arrival order. */
  messages: Array<Record<string, unknown>>;
  /** Final result text from run.wait() (falls back to trailing assistant text). */
  finalAnswer?: string;
  /** Trajectory-level status. Defaults to "complete". */
  status?: Trajectory["status"];
  /** Optional usage to fold into Trajectory.usage. */
  usage?: Partial<Trajectory["usage"]>;
}

export class CursorTrajectoryAdapter
  implements TrajectoryAdapter<CursorRunResult>
{
  fromHarnessResult(result: CursorRunResult, taskSpec: TaskSpec): Trajectory {
    const toolCalls: NormalizedToolCall[] = [];
    // call_id → index into toolCalls, so a completed event replaces its
    // earlier "running" placeholder instead of duplicating the call.
    const callIndexById = new Map<string, number>();
    let pendingReasoning = "";
    const trailingTextParts: string[] = [];
    let usageTotals = { input_tokens: 0, output_tokens: 0, cached: 0 };
    let sawUsage = false;

    for (const message of result.messages) {
      const type = String(message.type ?? "");

      if (type === "assistant") {
        const text = extractAssistantText(message);
        if (text) {
          pendingReasoning = appendText(pendingReasoning, text);
          trailingTextParts.push(text);
        }
        continue;
      }

      if (type === "thinking" && typeof message.text === "string") {
        pendingReasoning = appendText(pendingReasoning, message.text);
        continue;
      }

      if (type === "tool_call") {
        const callId =
          typeof message.call_id === "string" ? message.call_id : "";
        const status = String(message.status ?? "");
        const call: NormalizedToolCall = {
          name: typeof message.name === "string" ? message.name : "tool",
          args: isRecord(message.args)
            ? (message.args as Record<string, unknown>)
            : { input: message.args },
          result: message.result ?? "",
          ok: status !== "error",
          ...(status === "error" && {
            error: stringifyResult(message.result) || "tool_call error",
          }),
          reasoning: pendingReasoning.trim() || undefined,
        };
        const existing = callId ? callIndexById.get(callId) : undefined;
        if (existing !== undefined) {
          // Preserve the reasoning captured with the first (running) event.
          call.reasoning = toolCalls[existing].reasoning ?? call.reasoning;
          toolCalls[existing] = call;
        } else {
          toolCalls.push(call);
          if (callId) callIndexById.set(callId, toolCalls.length - 1);
          pendingReasoning = "";
          trailingTextParts.length = 0;
        }
        continue;
      }

      if (type === "usage" && isRecord(message.usage)) {
        sawUsage = true;
        usageTotals = {
          input_tokens:
            usageTotals.input_tokens + toFinite(message.usage.inputTokens),
          output_tokens:
            usageTotals.output_tokens + toFinite(message.usage.outputTokens),
          cached: usageTotals.cached + toFinite(message.usage.cacheReadTokens),
        };
        continue;
      }
    }

    const trailing = trailingTextParts.join("\n").trim();
    const finalAnswer =
      result.finalAnswer ?? (trailing.length > 0 ? trailing : undefined);

    return buildTrajectory({
      taskSpec,
      toolCalls,
      finalAnswer,
      status: result.status ?? "complete",
      usage:
        result.usage ??
        (sawUsage
          ? {
              input_tokens: usageTotals.input_tokens,
              output_tokens: usageTotals.output_tokens,
              ...(usageTotals.cached > 0 && {
                cached_input_tokens: usageTotals.cached,
              }),
            }
          : undefined),
    });
  }
}

export const cursorAdapter = new CursorTrajectoryAdapter();

function extractAssistantText(
  message: Record<string, unknown>,
): string | undefined {
  const inner = message.message;
  if (!isRecord(inner)) return undefined;
  const content = inner.content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    if (
      isRecord(block) &&
      block.type === "text" &&
      typeof block.text === "string"
    ) {
      parts.push(block.text);
    }
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function appendText(buffer: string, addition: string): string {
  if (!addition) return buffer;
  if (!buffer) return addition;
  return `${buffer}\n${addition}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toFinite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringifyResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}
