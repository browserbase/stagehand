import type { GeminiCuaSessionEvent } from "./session.js";

const MAX_RESULT_CHARS = 2_000;

export function buildGeminiCuaTranscript(events: GeminiCuaSessionEvent[]): string {
  const lines: string[] = [];
  for (const event of events) {
    if (event.type === "assistant") {
      if (event.text) lines.push(event.text);
    } else if (event.type === "tool_use") {
      lines.push(`<tool_use name="${event.name}">${JSON.stringify(event.input)}</tool_use>`);
    } else {
      const status = event.error ? ' status="error"' : "";
      lines.push(
        `<tool_result name="${event.name}"${status}>${clip(event.response ? JSON.stringify(event.response) : event.text, MAX_RESULT_CHARS)}</tool_result>`,
      );
      if (event.image) lines.push(`[image: ${event.image.mimeType}]`);
    }
  }
  return lines.join("\n");
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  let end = max - 1;
  // Do not leave half of a UTF-16 pair at the persisted text boundary.
  const last = value.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${value.slice(0, end)}…`;
}
