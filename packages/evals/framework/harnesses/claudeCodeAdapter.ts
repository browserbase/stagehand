import type { ProbeEvidence, TaskSpec, Trajectory } from "stagehand-v3";
import { AGENT_RUN_TOOL_NAME } from "../../core/contracts/tool.js";
import type { StepObservation } from "../observationRecorder.js";
import {
  buildTrajectory,
  type NormalizedToolCall,
  type TrajectoryAdapter,
} from "./trajectoryAdapter.js";

export interface ClaudeCodeRunResult {
  messages: Array<Record<string, unknown>>;
  finalAnswer?: string;
  status?: Trajectory["status"];
  usage?: Partial<Trajectory["usage"]>;
  finalObservation?: ProbeEvidence;
  stepObservations?: StepObservation[];
  observedToolName?: (name: string) => boolean;
}

interface ToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
  reasoningPrefix: string;
}

interface ToolResultBlock {
  toolUseId: string;
  text: string;
  raw?: unknown;
  images: Array<{ bytes: Buffer; mediaType: string }>;
  isError: boolean;
}

export class ClaudeCodeTrajectoryAdapter implements TrajectoryAdapter<ClaudeCodeRunResult> {
  fromHarnessResult(result: ClaudeCodeRunResult, taskSpec: TaskSpec): Trajectory {
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
          // Extended thinking is reasoning but never the answer, so it does
          // not join trailingTextParts. redacted_thinking carries no text.
          if (blockType === "thinking" && typeof block.thinking === "string") {
            pendingReasoning = appendText(pendingReasoning, block.thinking);
            continue;
          }
          if (blockType === "tool_use") {
            const id = typeof block.id === "string" ? block.id : "";
            const name = typeof block.name === "string" ? block.name : "tool";
            const input = isRecord(block.input) ? (block.input as Record<string, unknown>) : {};
            toolUses.push({
              id,
              name,
              input,
              reasoningPrefix: pendingReasoning,
            });
            pendingReasoning = "";
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
          const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
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

    const observationsByRunIndex = new Map(
      (result.stepObservations ?? []).map((o) => [o.runIndex, o.evidence]),
    );
    let runOrdinal = 0;
    const isObservedTool =
      result.observedToolName ?? ((name: string) => name === AGENT_RUN_TOOL_NAME);
    const toolCalls: NormalizedToolCall[] = toolUses.map((use) => {
      const matched = toolResults.get(use.id);
      const ok = matched ? !matched.isError : true;
      const resultPayload = matched?.raw !== undefined ? matched.raw : (matched?.text ?? "");
      const observation = isObservedTool(use.name)
        ? observationsByRunIndex.get(runOrdinal++)
        : undefined;
      return {
        name: use.name,
        args: use.input,
        result: resultPayload,
        ok,
        ...(matched?.isError && matched.text && { error: matched.text }),
        reasoning: use.reasoningPrefix.trim() || undefined,
        ...(matched?.images.length && { images: matched.images }),
        ...(observation && { probeEvidence: observation }),
      };
    });

    const trailing = trailingTextParts.join("\n").trim();
    const finalAnswer =
      result.finalAnswer ?? resultMessageText ?? (trailing.length > 0 ? trailing : undefined);

    let finalObservation: ProbeEvidence | undefined = result.finalObservation?.screenshot
      ? result.finalObservation
      : undefined;
    for (let i = toolUses.length - 1; !finalObservation && i >= 0; i--) {
      const matched = toolResults.get(toolUses[i].id);
      const lastImage = matched?.images[matched.images.length - 1];
      if (lastImage) {
        finalObservation = { screenshot: lastImage.bytes };
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
  if (source.type === "base64" && typeof source.data === "string" && source.data.length > 0) {
    const mediaType = typeof source.media_type === "string" ? source.media_type : "image/png";
    try {
      return { bytes: Buffer.from(source.data, "base64"), mediaType };
    } catch {
      return undefined;
    }
  }
  return undefined;
}
