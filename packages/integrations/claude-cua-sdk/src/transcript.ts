import type { ClaudeCuaSessionEvent } from "./session.js";
import type { CuaToolResultBlock } from "./toolset.js";

const MAX_RESULT_CHARS = 2_000;

/** Human-readable transcript of a session; images become placeholders. */
export function buildClaudeCuaTranscript(events: ClaudeCuaSessionEvent[]): string {
  const lines: string[] = [];
  for (const event of events) {
    if (event.type === "assistant") {
      for (const block of event.content) {
        if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking) {
          lines.push(`<thinking>\n${block.thinking}\n</thinking>`);
        } else if (block.type === "text" && typeof block.text === "string") {
          lines.push(block.text);
        }
      }
    } else if (event.type === "tool_use") {
      lines.push(`<tool_use name="${event.name}">${JSON.stringify(event.input)}</tool_use>`);
    } else {
      const status = event.isError ? ' status="error"' : "";
      lines.push(
        `<tool_result name="${event.name}"${status}>${clip(
          renderResultContent(event.content),
          MAX_RESULT_CHARS,
        )}</tool_result>`,
      );
    }
  }
  return lines.join("\n");
}

export function renderResultContent(content: string | CuaToolResultBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "image") return "[image]";
      return `[browser_state ${JSON.stringify(block.tabs)}]`;
    })
    .join("\n");
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  let end = max - 1;
  if (/[\uD800-\uDBFF]/u.test(value[end - 1] ?? "") && /[\uDC00-\uDFFF]/u.test(value[end] ?? ""))
    end -= 1;
  return `${value.slice(0, end)}…`;
}
