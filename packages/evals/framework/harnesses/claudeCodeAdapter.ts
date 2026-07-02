/**
 * claudeCodeAdapter — converts a Claude Code SDK run into a `Trajectory` the
 * verifier can consume.
 *
 * Input shape: the SDK emits a stream of `ClaudeSdkMessage` objects of
 * different `type`s — assistant (model output, may contain tool_use blocks),
 * user (tool_result blocks for prior tool_use calls), and result (final
 * outcome with cost/usage/turn counts). We accumulate the stream upstream in
 * `runClaudeCodeAgent` and hand the full list here.
 *
 * Mapping:
 *   - Each `tool_use` block in an assistant message becomes one normalized
 *     tool call, paired with its matching `tool_result` from a subsequent
 *     user message (by `tool_use_id`).
 *   - Assistant `text` blocks that precede a tool_use are folded into that
 *     tool call's `reasoning`. Trailing text after the last tool call (and
 *     the final result message's `result` string when present) becomes the
 *     `finalAnswer`.
 *   - The result message's usage carries forward as the trajectory usage.
 *
 * Failure modes:
 *   - max_turns / sdk_error → status = "error", but we still emit whatever
 *     steps we have. The verifier flags evidence_insufficient on criteria it
 *     can't ground.
 */
import type {
  ProbeEvidence,
  TaskSpec,
  Trajectory,
} from "@browserbasehq/stagehand";
import {
  buildTrajectory,
  type NormalizedToolCall,
  type TrajectoryAdapter,
} from "./trajectoryAdapter.js";

/** Subset of the harness result we need to build a trajectory. */
export interface ClaudeCodeRunResult {
  /** Raw SDK message stream collected during execution, in arrival order. */
  messages: Array<Record<string, unknown>>;
  /** Final assistant message captured separately (optional — falls back to messages). */
  finalAnswer?: string;
  /** Trajectory-level status. Defaults to "complete". */
  status?: Trajectory["status"];
  /** Optional usage to fold into Trajectory.usage. */
  usage?: Partial<Trajectory["usage"]>;
}

interface ToolUseBlock {
  /** tool_use_id used to match against tool_result blocks. */
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Assistant text accumulated before this tool call (becomes `reasoning`). */
  reasoningPrefix: string;
}

interface ToolResultBlock {
  toolUseId: string;
  /** Concatenated text content of the result. */
  text: string;
  /** Original structured content when not flattened to text. */
  raw?: unknown;
  /** Images returned by the tool (e.g., playwright_code screenshots). */
  images: Array<{ bytes: Buffer; mediaType: string }>;
  isError: boolean;
}

export class ClaudeCodeTrajectoryAdapter implements TrajectoryAdapter<ClaudeCodeRunResult> {
  fromHarnessResult(
    result: ClaudeCodeRunResult,
    taskSpec: TaskSpec,
  ): Trajectory {
    const toolUses: ToolUseBlock[] = [];
    const toolResults = new Map<string, ToolResultBlock>();
    const trailingTextParts: string[] = [];
    let resultMessageText: string | undefined;

    let pendingReasoning = "";

    for (const message of result.messages) {
      const type = String((message as Record<string, unknown>).type ?? "");
      const inner = (message as Record<string, unknown>).message;
      if (type === "result") {
        const r = (message as Record<string, unknown>).result;
        if (typeof r === "string" && r.trim()) {
          resultMessageText = r;
        }
        continue;
      }
      if (!isRecord(inner)) continue;
      const content = inner.content;
      if (!Array.isArray(content)) {
        if (typeof content === "string" && type === "assistant") {
          pendingReasoning = appendText(pendingReasoning, content);
          trailingTextParts.push(content);
        }
        continue;
      }

      if (type === "assistant") {
        for (const block of content) {
          if (!isRecord(block)) continue;
          const blockType = String(block.type ?? "");
          if (blockType === "text" && typeof block.text === "string") {
            pendingReasoning = appendText(pendingReasoning, block.text);
            trailingTextParts.push(block.text);
            continue;
          }
          if (blockType === "tool_use") {
            const id = typeof block.id === "string" ? block.id : "";
            const name = typeof block.name === "string" ? block.name : "tool";
            const input = isRecord(block.input)
              ? (block.input as Record<string, unknown>)
              : {};
            toolUses.push({
              id,
              name,
              input,
              reasoningPrefix: pendingReasoning,
            });
            // Once a tool_use lands, the buffered text belonged to its reasoning;
            // future tool calls start with empty reasoning unless more text arrives.
            pendingReasoning = "";
            // The text we just folded into reasoning is not the final answer.
            // Drop it from trailingTextParts.
            trailingTextParts.length = 0;
          }
        }
        continue;
      }

      if (type === "user") {
        for (const block of content) {
          if (!isRecord(block)) continue;
          const blockType = String(block.type ?? "");
          if (blockType !== "tool_result") continue;
          const toolUseId =
            typeof block.tool_use_id === "string" ? block.tool_use_id : "";
          const isError = block.is_error === true;
          const { text, raw, images } = extractToolResultContent(block.content);
          toolResults.set(toolUseId, {
            toolUseId,
            text,
            raw,
            images,
            isError,
          });
        }
        continue;
      }
    }

    const toolCalls: NormalizedToolCall[] = toolUses.map((use) => {
      const matched = toolResults.get(use.id);
      const ok = matched ? !matched.isError : true;
      const resultPayload =
        matched?.raw !== undefined ? matched.raw : (matched?.text ?? "");
      return {
        name: use.name,
        args: use.input,
        result: resultPayload,
        ok,
        ...(matched?.isError && matched.text && { error: matched.text }),
        reasoning: use.reasoningPrefix.trim() || undefined,
        ...(matched?.images.length && { images: matched.images }),
      };
    });

    const trailing = trailingTextParts.join("\n").trim();
    const finalAnswer =
      result.finalAnswer ??
      resultMessageText ??
      (trailing.length > 0 ? trailing : undefined);

    // Anchor the closing frame with the most recent screenshot the agent
    // captured. Claude Code doesn't run a post-task probe, so the last
    // tool_result image is the best proxy for "terminal observation" — without
    // it the verifier's final-screenshot anchor (evidence.ts:136-143) is empty.
    let finalObservation: ProbeEvidence | undefined;
    for (let i = toolUses.length - 1; i >= 0; i--) {
      const matched = toolResults.get(toolUses[i].id);
      const lastImage = matched?.images[matched.images.length - 1];
      if (lastImage) {
        finalObservation = { screenshot: lastImage.bytes };
        break;
      }
    }

    return buildTrajectory({
      taskSpec,
      toolCalls,
      finalAnswer,
      status: result.status ?? "complete",
      usage: result.usage,
      ...(finalObservation && { finalObservation }),
    });
  }
}

export const claudeCodeAdapter = new ClaudeCodeTrajectoryAdapter();

function appendText(buffer: string, addition: string): string {
  if (!addition) return buffer;
  if (!buffer) return addition;
  return `${buffer}\n${addition}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * tool_result `content` can be:
 *   - a string (legacy)
 *   - an array of { type: "text", text } / { type: "image", source } blocks
 *
 * Text blocks are flattened to `text`. Image blocks (Anthropic's `{ type: "image",
 * source: { type: "base64", media_type, data } }` shape) are decoded to Buffers
 * and returned in `images` so the trajectory adapter can fold them into
 * agentEvidence as image modalities. The original array is preserved as `raw`
 * for json-modality consumers.
 */
function extractToolResultContent(content: unknown): {
  text: string;
  raw?: unknown;
  images: Array<{ bytes: Buffer; mediaType: string }>;
} {
  if (typeof content === "string") {
    return { text: content, images: [] };
  }
  if (!Array.isArray(content)) {
    return { text: "", images: [] };
  }
  const parts: string[] = [];
  const images: Array<{ bytes: Buffer; mediaType: string }> = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block.type === "image") {
      const decoded = decodeAnthropicImageBlock(block);
      if (decoded) {
        images.push(decoded);
        parts.push("[image]");
      }
    } else if (typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return { text: parts.join("\n"), raw: content, images };
}

function decodeAnthropicImageBlock(
  block: Record<string, unknown>,
): { bytes: Buffer; mediaType: string } | undefined {
  const source = block.source;
  if (!isRecord(source)) return undefined;
  // Base64 source: { type: "base64", media_type, data }
  if (
    source.type === "base64" &&
    typeof source.data === "string" &&
    source.data.length > 0
  ) {
    const mediaType =
      typeof source.media_type === "string" ? source.media_type : "image/png";
    try {
      return { bytes: Buffer.from(source.data, "base64"), mediaType };
    } catch {
      return undefined;
    }
  }
  return undefined;
}
