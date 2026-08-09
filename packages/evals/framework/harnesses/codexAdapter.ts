/**
 * codexAdapter — converts a Codex SDK run into a `Trajectory` the verifier
 * can consume.
 *
 * Input shape: codex emits `ThreadEvent`s — `item.completed` carrying a
 * `ThreadItem` (command_execution, file_change, mcp_tool_call, agent_message,
 * reasoning, web_search, todo_list, error), plus `turn.completed` for usage.
 * We accumulate the full event list upstream in `runCodexAgent` and hand it
 * here.
 *
 * Mapping:
 *   - command_execution items → tool call named `bash` (or the command's
 *     leading token), args = { command }, result = aggregated_output,
 *     ok = exit_code === 0.
 *   - mcp_tool_call items → tool call named `${server}.${tool}`, args =
 *     arguments, result = structured_content (json modality) when present,
 *     else flattened content text. ok = status !== "failed".
 *   - reasoning items between item.completed events → folded into the next
 *     tool call's reasoning string.
 *   - agent_message items → the final answer (last wins).
 *   - error items → captured as a failed tool call so the verifier sees the
 *     pattern (a no-op `error` action with the message in toolOutput.error).
 *   - file_change items → captured as a tool call named `file_change` with the
 *     change set in args (rare in browser eval contexts).
 *   - web_search items → captured as a tool call named `web_search` with the
 *     query in args.
 *   - todo_list items → not surfaced as tool calls (they aren't actions).
 */
import type { TaskSpec, Trajectory } from "@browserbasehq/stagehand";
import {
  buildTrajectory,
  type NormalizedToolCall,
  type TrajectoryAdapter,
} from "./trajectoryAdapter.js";

export interface CodexRunResult {
  /** All ThreadEvents collected from the SDK stream, in arrival order. */
  events: Array<Record<string, unknown>>;
  /** Last `agent_message` text. Adapter falls back to scanning events otherwise. */
  finalAnswer?: string;
  /** Trajectory-level status. Defaults to "complete". */
  status?: Trajectory["status"];
  /** Optional usage to fold into Trajectory.usage. */
  usage?: Partial<Trajectory["usage"]>;
}

export class CodexTrajectoryAdapter implements TrajectoryAdapter<CodexRunResult> {
  fromHarnessResult(result: CodexRunResult, taskSpec: TaskSpec): Trajectory {
    const toolCalls: NormalizedToolCall[] = [];
    let pendingReasoning = "";
    let latestAgentMessage: string | undefined;

    for (const event of result.events) {
      const type = String((event as Record<string, unknown>).type ?? "");
      if (type !== "item.completed") continue;
      const item = (event as Record<string, unknown>).item;
      if (!isRecord(item)) continue;
      const itemType = String(item.type ?? "");

      if (itemType === "reasoning" && typeof item.text === "string") {
        pendingReasoning = pendingReasoning
          ? `${pendingReasoning}\n${item.text}`
          : item.text;
        continue;
      }

      if (itemType === "agent_message" && typeof item.text === "string") {
        // Drop buffered reasoning that didn't precede a tool call.
        pendingReasoning = "";
        latestAgentMessage = item.text;
        continue;
      }

      const call = normalizeItem(itemType, item, pendingReasoning);
      if (call) {
        toolCalls.push(call);
        pendingReasoning = "";
      }
    }

    const finalAnswer = result.finalAnswer ?? latestAgentMessage;

    return buildTrajectory({
      taskSpec,
      toolCalls,
      finalAnswer,
      status: result.status ?? "complete",
      usage: result.usage,
    });
  }
}

export const codexAdapter = new CodexTrajectoryAdapter();

function normalizeItem(
  itemType: string,
  item: Record<string, unknown>,
  reasoning: string,
): NormalizedToolCall | undefined {
  if (itemType === "command_execution") {
    const command = typeof item.command === "string" ? item.command : "";
    const exitCode =
      typeof item.exit_code === "number" ? item.exit_code : undefined;
    const status = String(item.status ?? "");
    const ok = exitCode === 0 || status === "completed";
    const output =
      typeof item.aggregated_output === "string" ? item.aggregated_output : "";
    // Use the leading token as the action name (`bash`, `browse`, etc.) when
    // possible; falls back to `command_execution`.
    const leading = command.split(/\s+/, 1)[0] || "command_execution";
    return {
      name: leading,
      args: { command, ...(exitCode !== undefined && { exit_code: exitCode }) },
      result: output,
      ok,
      ...(!ok && {
        error:
          exitCode !== undefined
            ? `exit code ${exitCode}`
            : `command status ${status}`,
      }),
      reasoning: reasoning || undefined,
    };
  }

  if (itemType === "mcp_tool_call") {
    const server = typeof item.server === "string" ? item.server : "mcp";
    const tool = typeof item.tool === "string" ? item.tool : "tool";
    const args = isRecord(item.arguments)
      ? (item.arguments as Record<string, unknown>)
      : {};
    const status = String(item.status ?? "");
    const ok = status !== "failed";
    const mcpResult = isRecord(item.result) ? item.result : undefined;
    const structured = mcpResult?.structured_content;
    const content = mcpResult?.content;
    const errorMessage = isRecord(item.error)
      ? typeof item.error.message === "string"
        ? item.error.message
        : undefined
      : undefined;

    // Prefer structured_content (json modality) when present, else flatten
    // content blocks to text. Falls back to error message when failed.
    let payload: unknown;
    if (structured !== undefined && structured !== null) {
      payload = structured;
    } else if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const block of content) {
        if (!isRecord(block)) continue;
        if (block.type === "text" && typeof block.text === "string") {
          parts.push(block.text);
        } else if (block.type === "image") {
          parts.push("[image]");
        } else if (typeof block.text === "string") {
          parts.push(block.text);
        }
      }
      payload = parts.join("\n");
    } else if (!ok && errorMessage) {
      payload = errorMessage;
    } else {
      payload = "";
    }

    return {
      name: `${server}.${tool}`,
      args,
      result: payload,
      ok,
      ...(errorMessage && !ok && { error: errorMessage }),
      reasoning: reasoning || undefined,
    };
  }

  if (itemType === "web_search") {
    const query = typeof item.query === "string" ? item.query : "";
    return {
      name: "web_search",
      args: { query },
      result: "",
      ok: true,
      reasoning: reasoning || undefined,
    };
  }

  if (itemType === "file_change") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const status = String(item.status ?? "");
    return {
      name: "file_change",
      args: { changes },
      result: { status, changes },
      ok: status === "completed",
      reasoning: reasoning || undefined,
    };
  }

  if (itemType === "error") {
    const message =
      typeof item.message === "string" ? item.message : "codex error item";
    return {
      name: "error",
      args: {},
      result: message,
      ok: false,
      error: message,
      reasoning: reasoning || undefined,
    };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
