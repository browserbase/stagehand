import {
  clip,
  isRecord,
  safeJson,
  stringifyError,
} from "@browserbasehq/stagehand-integrations/harness";

export type CursorEvent = Record<string, unknown>;

export type CursorToolCallView = {
  callId: string;
  subtype: "started" | "completed" | string;
  kind: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  ok: boolean;
  error?: string;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

function asLabel(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return fallback;
}

export function parseCursorStreamLine(line: string): CursorEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isPlainRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function extractCursorToolCall(event: CursorEvent): CursorToolCallView | undefined {
  if (event.type !== "tool_call" || !isPlainRecord(event.tool_call)) return undefined;
  const entry = Object.entries(event.tool_call)[0];
  if (!entry || !isPlainRecord(entry[1])) return undefined;
  const [rawKind, call] = entry;
  const kind = rawKind === "function" ? "function" : rawKind.replace(/ToolCall$/, "");
  const rawArgs = isPlainRecord(call.args) ? call.args : {};
  let name = kind;
  let args = rawArgs;

  if (kind === "function") {
    name = typeof call.name === "string" ? call.name : "function";
    const value = call.arguments;
    if (typeof value === "string") {
      try {
        const parsed: unknown = JSON.parse(value);
        args = isPlainRecord(parsed) ? parsed : {};
      } catch {
        args = {};
      }
    } else {
      args = isPlainRecord(value) ? value : {};
    }
  } else if (kind === "mcp") {
    const server = readString(rawArgs, ["providerIdentifier", "server", "provider"]) ?? "mcp";
    const tool = readString(rawArgs, ["name", "toolName", "tool"]) ?? "tool";
    name = `${server}.${tool}`;
    args = isPlainRecord(rawArgs.args)
      ? rawArgs.args
      : isPlainRecord(rawArgs.arguments)
        ? rawArgs.arguments
        : rawArgs;
  }

  const resultEnvelope = isPlainRecord(call.result) ? call.result : undefined;
  let result: unknown;
  let ok = true;
  let error: string | undefined;
  if (resultEnvelope && Object.hasOwn(resultEnvelope, "success")) {
    result =
      kind === "mcp" ? normalizeCursorMcpResult(resultEnvelope.success) : resultEnvelope.success;
    if (kind === "mcp" && isPlainRecord(result) && result.isError === true) ok = false;
  } else if (resultEnvelope) {
    for (const key of ["error", "rejected", "failure"] as const) {
      if (Object.hasOwn(resultEnvelope, key)) {
        ok = false;
        error = stringifyError(resultEnvelope[key]);
        break;
      }
    }
  }

  return {
    callId: typeof event.call_id === "string" ? event.call_id : "",
    subtype: typeof event.subtype === "string" ? event.subtype : "",
    kind,
    name,
    args,
    ...(result !== undefined && { result }),
    ok,
    ...(error && { error }),
  };
}

function normalizeCursorMcpResult(result: unknown): unknown {
  if (!isPlainRecord(result) || !Array.isArray(result.content)) return result;
  return {
    ...result,
    content: result.content.map((block: unknown) => {
      if (!isPlainRecord(block) || block.type !== undefined) return block;
      if (isPlainRecord(block.text) && typeof block.text.text === "string") {
        const { text, ...rest } = block;
        return { ...rest, ...text, type: "text" };
      }
      if (
        isPlainRecord(block.image) &&
        typeof block.image.data === "string" &&
        typeof block.image.mimeType === "string"
      ) {
        const { image, ...rest } = block;
        return { ...rest, ...image, type: "image" };
      }
      return block;
    }),
  };
}

export function buildCursorTranscript(events: CursorEvent[]): string {
  return events
    .map((event) => summarizeCursorEvent(event).detail)
    .filter((detail): detail is string => Boolean(detail))
    .join("\n");
}

export function summarizeCursorEvent(event: CursorEvent): { message: string; detail?: string } {
  const type = asLabel(event.type, "unknown");
  if (type === "assistant") {
    const text = extractAssistantText(event);
    return { message: text ? `assistant: ${clip(text, 500)}` : "assistant message", detail: text };
  }
  if (type === "tool_call") {
    const view = extractCursorToolCall(event);
    return {
      message: view
        ? `tool: ${view.name} ${view.subtype}${view.ok ? "" : " failed"}`
        : "tool_call event",
      detail: safeJson(event),
    };
  }
  if (type === "result") {
    return {
      message: `result: ${asLabel(event.subtype, "done")}`,
      detail: typeof event.result === "string" ? event.result : safeJson(event),
    };
  }
  return { message: `${type} event`, detail: safeJson(event) };
}

function extractAssistantText(event: CursorEvent): string | undefined {
  const parts = extractAssistantTextBlocks(event);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function extractAssistantTextBlocks(event: CursorEvent): string[] {
  const message = isPlainRecord(event.message) ? event.message : undefined;
  if (!Array.isArray(message?.content)) return [];
  return message.content
    .filter(isPlainRecord)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string);
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key].trim().length > 0) return record[key];
  }
  return undefined;
}
