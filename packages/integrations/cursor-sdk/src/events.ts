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

export function parseCursorStreamLine(line: string): CursorEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function extractCursorToolCall(event: CursorEvent): CursorToolCallView | undefined {
  if (event.type !== "tool_call" || !isRecord(event.tool_call)) return undefined;
  const entry = Object.entries(event.tool_call)[0];
  if (!entry || !isRecord(entry[1])) return undefined;
  const [rawKind, call] = entry;
  const kind = rawKind === "function" ? "function" : rawKind.replace(/ToolCall$/, "");
  const rawArgs = isRecord(call.args) ? call.args : {};
  let name = kind;
  let args = rawArgs;

  if (kind === "function") {
    name = typeof call.name === "string" ? call.name : "function";
    const value = call.arguments;
    if (typeof value === "string") {
      try {
        const parsed: unknown = JSON.parse(value);
        args = isRecord(parsed) ? parsed : {};
      } catch {
        args = {};
      }
    } else {
      args = isRecord(value) ? value : {};
    }
  } else if (kind === "mcp") {
    // Cursor has not documented its MCP stream-json payload. Accept the
    // observed candidate fields without requiring any one unverified shape.
    const server = readString(rawArgs, ["providerIdentifier", "server", "provider"]) ?? "mcp";
    const tool = readString(rawArgs, ["name", "toolName", "tool"]) ?? "tool";
    name = `${server}.${tool}`;
    args = isRecord(rawArgs.args)
      ? rawArgs.args
      : isRecord(rawArgs.arguments)
        ? rawArgs.arguments
        : rawArgs;
  }

  const resultEnvelope = isRecord(call.result) ? call.result : undefined;
  let result: unknown;
  let ok = true;
  let error: string | undefined;
  if (resultEnvelope && "success" in resultEnvelope) {
    result =
      kind === "mcp" ? normalizeCursorMcpResult(resultEnvelope.success) : resultEnvelope.success;
    if (kind === "mcp" && isRecord(result) && result.isError === true) ok = false;
  } else if (resultEnvelope) {
    for (const key of ["error", "rejected", "failure"] as const) {
      if (key in resultEnvelope) {
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
  if (!isRecord(result) || !Array.isArray(result.content)) return result;
  return {
    ...result,
    content: result.content.map((block: unknown) => {
      if (!isRecord(block) || block.type !== undefined) return block;
      if (isRecord(block.text) && typeof block.text.text === "string") {
        const { text, ...rest } = block;
        return { ...rest, ...text, type: "text" };
      }
      if (
        isRecord(block.image) &&
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
  const type = String(event.type ?? "unknown");
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
      message: `result: ${String(event.subtype ?? "done")}`,
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
  const message = isRecord(event.message) ? event.message : undefined;
  if (!Array.isArray(message?.content)) return [];
  return message.content
    .filter(isRecord)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string);
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof record[key] === "string") return record[key];
  }
  return undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function safeJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

export function stringifyError(value: unknown): string {
  if (!value) return "";
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return safeJson(value) ?? String(value);
}

export function clip(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
