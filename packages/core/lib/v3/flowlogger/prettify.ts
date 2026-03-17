import { toTitleCase } from "../../utils.js";
import { FlowEvent } from "./FlowLogger.js";
import type { EventStoreApi } from "./EventStore.js";

const MAX_LINE_LENGTH = 160; // Maximum width for a prettified log line.

// =============================================================================
// Pretty Formatting
// =============================================================================

// All functions in this section intentionally share the `prettify` prefix so the formatting pipeline is easy to scan and reason about in one place.

// Sanitizes individual values before they are included in prettified output. This currently shortens CDP ids but otherwise preserves structure.
function prettifySanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return truncateCdpIds(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => prettifySanitizeValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        prettifySanitizeValue(entry),
      ]),
    );
  }

  return value;
}

// Produces a prettified-safe copy of the event without mutating the original event that other sinks may still need to serialize verbatim.
export function prettifySanitizeEvent(event: FlowEvent): FlowEvent {
  if (!event.eventType.startsWith("Cdp")) {
    return event;
  }

  return {
    ...event,
    data: prettifySanitizeValue(event.data) as Record<string, unknown>,
  };
}

// Collapses newlines and tabs, then truncates a string to the configured pretty log width while preserving the tail for ids and result summaries.
function prettifyTruncateLine(value: string, maxLen: number): string {
  const collapsed = value.replace(/[\r\n\t]+/g, " ");
  if (collapsed.length <= maxLen) {
    return collapsed;
  }

  const endLen = Math.floor(maxLen * 0.3);
  const startLen = maxLen - endLen - 1;
  return `${collapsed.slice(0, startLen)}…${collapsed.slice(-endLen)}`;
}

// Converts any event argument into a compact string representation for pretty logs.
function prettifyFormatValue(value: unknown): string {
  if (typeof value === "string") return `'${value}'`;
  if (value == null || typeof value !== "object") return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

// Formats one or more call arguments into a comma-separated pretty string.
function prettifyFormatArgs(args?: unknown | unknown[]): string {
  if (args === undefined) {
    return "";
  }

  return (Array.isArray(args) ? args : [args])
    .filter((entry) => entry !== undefined)
    .map(prettifyFormatValue)
    .filter((entry) => entry.length > 0)
    .join(", ");
}

// Returns the short id fragment used by pretty tags.
function shortId(id: string | null | undefined): string {
  return id ? id.slice(-4) : "-";
}

// Shortens 32-character CDP ids so pretty logs stay readable while still leaving enough information to correlate related targets.
function truncateCdpIds(value: string): string {
  return value.replace(
    /([iI]d:?"?)([0-9A-F]{32})(?="?[,})\s]|$)/g,
    (_, prefix: string, id: string) =>
      `${prefix}${id.slice(0, 4)}…${id.slice(-4)}`,
  );
}

let nonce = 0;

// Formats timestamps for pretty logs while appending a tiny nonce so lines emitted in the same millisecond remain stable and sortable.
function prettifyFormatTimestamp(date: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${pad(nonce++ % 100)}`;
}

// Removes noisy quoting artifacts from the final pretty line.
function prettifyRemoveQuotes(value: string): string {
  return value
    .replace(/([^\\])["']/g, "$1")
    .replace(/^["']|["']$/g, "")
    .trim();
}

// Strips event lifecycle suffixes so related started/completed/error variants can be grouped under one logical operation name.
function prettifyEventName(eventType: string): string {
  return eventType
    .replace(/CompletedEvent$/, "")
    .replace(/ErrorEvent$/, "")
    .replace(/Event$/, "");
}

// Extracts the operation name from a Stagehand/Page/Understudy/Agent event.
function prettifyEventAction(eventType: string): string {
  return prettifyEventName(eventType)
    .replace(/^Agent/, "")
    .replace(/^Stagehand/, "")
    .replace(/^Understudy/, "")
    .replace(/^Page/, "");
}

// Formats `Target.method(args)` style entries while gracefully handling events whose action portion is intentionally blank, such as `StagehandEvent`.
function prettifyFormatMethodCall(
  target: string,
  method: string,
  args: unknown,
): string {
  const member = method ? `.${method[0].toLowerCase()}${method.slice(1)}` : "";
  return `▷ ${target}${member}(${prettifyFormatEventArgs(args)})`;
}

// Marks agent lifecycle events for ancestry tags.
function prettifyIsAgentEvent(event: FlowEvent): boolean {
  return prettifyEventName(event.eventType).startsWith("Agent");
}

// Marks Stagehand lifecycle events for ancestry tags.
function prettifyIsStagehandEvent(event: FlowEvent): boolean {
  return prettifyEventName(event.eventType).startsWith("Stagehand");
}

// Marks page and Understudy actions for the action tag.
function prettifyIsActionEvent(event: FlowEvent): boolean {
  return /^(Page|Understudy)/.test(prettifyEventName(event.eventType));
}

// Routes transport-level CDP traffic to the CDP formatter.
export function prettifyIsCdpEvent(event: FlowEvent): boolean {
  return prettifyEventName(event.eventType).startsWith("Cdp");
}

// Routes LLM request/response events to the LLM formatter.
function prettifyIsLlmEvent(event: FlowEvent): boolean {
  return prettifyEventName(event.eventType).startsWith("Llm");
}

// Completed events should inherit tags from the started operation.
function prettifyIsCompletedEvent(event: FlowEvent): boolean {
  return event.eventType.endsWith("CompletedEvent");
}

// Error events should inherit tags from the started operation.
function prettifyIsErrorEvent(event: FlowEvent): boolean {
  return event.eventType.endsWith("ErrorEvent");
}

// Renders the bracketed pretty tag used in stderr/file pretty logs.
function prettifyFormatTag(
  label: string | null | undefined,
  id: string | null | undefined,
  icon: string,
): string {
  return id ? `[${icon} #${shortId(id)}${label ? ` ${label}` : ""}]` : "⤑";
}

// Formats duration values stored on completed/error events.
function prettifyFormatDuration(durationMs?: unknown): string | null {
  return typeof durationMs === "number"
    ? `${(durationMs / 1000).toFixed(2)}s`
    : null;
}

// Summarizes a prompt or output payload down to a single displayable string for the LLM pretty formatter.
function prettifySummarizePrompt(value: unknown): string | undefined {
  if (typeof value === "string") {
    return prettifyTruncateLine(value, MAX_LINE_LENGTH / 2);
  }

  if (value == null) {
    return undefined;
  }

  return prettifyTruncateLine(prettifyFormatValue(value), MAX_LINE_LENGTH / 2);
}

// Replaces large object references from live runtime objects with placeholders before they are stringified for pretty output.
function prettifyCompactValue(value: unknown): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => prettifyCompactValue(entry));
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      key === "page" ||
      key === "frame" ||
      key === "locator" ||
      key === "conn" ||
      key === "mainSession" ||
      key === "sessions" ||
      key === "registry" ||
      key === "networkManager" ||
      key === "apiClient"
    ) {
      result[key] = `[${toTitleCase(key)}]`;
      continue;
    }

    result[key] = prettifyCompactValue(entry);
  }

  return result;
}

// Formats event arguments after compacting any live object references.
function prettifyFormatEventArgs(args?: unknown | unknown[]): string {
  return prettifyFormatArgs(prettifyCompactValue(args) as unknown | unknown[]);
}

// Finds the nearest event in the current parent chain that satisfies the given predicate. Pretty tags use this to recover agent/stagehand/action/llm ancestry.
function prettifyFindNearestEvent(
  event: FlowEvent,
  parentMap: Map<string, FlowEvent>,
  predicate: (candidate: FlowEvent) => boolean,
  options?: { includeSelf?: boolean },
): FlowEvent | null {
  if (options?.includeSelf !== false && predicate(event)) {
    return event;
  }

  for (let index = event.eventParentIds.length - 1; index >= 0; index -= 1) {
    const parent = parentMap.get(event.eventParentIds[index]);
    if (parent && predicate(parent)) {
      return parent;
    }
  }

  return null;
}

// Builds the semantic ancestry tags shown on each pretty log line.
// 2026-03-16 22:04:15.45540 [🅰 #1083] [🆂 #7bf4 ACT] [🆄 #2125 CLICK] [🅲 #8B8B CDP] ⏴ Network.policyUpdated({})
function prettifyBuildContextTags(
  event: FlowEvent,
  parentMap: Map<string, FlowEvent>,
): string[] {
  // Completed/error events should inherit tags from their started parent so the completion line points back to the original operation id.
  const includeSelf =
    !prettifyIsCompletedEvent(event) && !prettifyIsErrorEvent(event);
  const agentEvent = prettifyFindNearestEvent(
    event,
    parentMap,
    prettifyIsAgentEvent,
    { includeSelf },
  );
  const stagehandEvent = prettifyFindNearestEvent(
    event,
    parentMap,
    prettifyIsStagehandEvent,
    { includeSelf },
  );
  const actionEvent = prettifyFindNearestEvent(
    event,
    parentMap,
    prettifyIsActionEvent,
    { includeSelf },
  );
  const llmEvent = prettifyFindNearestEvent(
    event,
    parentMap,
    prettifyIsLlmEvent,
    {
      includeSelf,
    },
  );

  let targetId: string | null = null;
  if (typeof event.data.targetId === "string") {
    targetId = event.data.targetId;
  }

  let stagehandLabel = "";
  if (stagehandEvent) {
    stagehandLabel = prettifyEventAction(
      stagehandEvent.eventType,
    ).toUpperCase();
  }

  let actionLabel = "";
  if (actionEvent) {
    actionLabel = prettifyEventAction(actionEvent.eventType).toUpperCase();
  }

  if (prettifyIsAgentEvent(event)) {
    return [prettifyFormatTag("", agentEvent?.eventId, "🅰")];
  }

  if (prettifyIsStagehandEvent(event)) {
    return [
      prettifyFormatTag("", agentEvent?.eventId, "🅰"),
      prettifyFormatTag(
        prettifyEventAction(
          stagehandEvent?.eventType ?? event.eventType,
        ).toUpperCase(),
        stagehandEvent?.eventId,
        "🆂",
      ),
    ];
  }

  if (prettifyIsActionEvent(event)) {
    return [
      prettifyFormatTag("", agentEvent?.eventId, "🅰"),
      prettifyFormatTag(stagehandLabel, stagehandEvent?.eventId, "🆂"),
      prettifyFormatTag(
        prettifyEventAction(
          actionEvent?.eventType ?? event.eventType,
        ).toUpperCase(),
        actionEvent?.eventId,
        "🆄",
      ),
    ];
  }

  if (prettifyIsCdpEvent(event)) {
    return [
      prettifyFormatTag("", agentEvent?.eventId, "🅰"),
      prettifyFormatTag(stagehandLabel, stagehandEvent?.eventId, "🆂"),
      prettifyFormatTag(actionLabel, actionEvent?.eventId, "🆄"),
      prettifyFormatTag("CDP", targetId, "🅲"),
    ];
  }

  if (prettifyIsLlmEvent(event)) {
    let requestId: string | null = null;
    if (typeof event.data.requestId === "string") {
      requestId = event.data.requestId;
    }

    return [
      prettifyFormatTag("", agentEvent?.eventId, "🅰"),
      prettifyFormatTag(stagehandLabel, stagehandEvent?.eventId, "🆂"),
      prettifyFormatTag("LLM", requestId ?? llmEvent?.eventId, "🅻"),
    ];
  }

  return [`[#${shortId(event.eventId)}]`];
}

// Formats the details section for started/root events.
function prettifyFormatStartedDetails(event: FlowEvent): string {
  const data = event.data as {
    params?: unknown[];
    target?: string;
  };
  const name = prettifyEventName(event.eventType);
  const method = prettifyEventAction(event.eventType);

  if (name.startsWith("Stagehand")) {
    return prettifyFormatMethodCall("Stagehand", method, data.params);
  }

  if (name.startsWith("Page")) {
    return prettifyFormatMethodCall("Page", method, data.params);
  }

  if (name.startsWith("Understudy")) {
    const args = [
      data.target,
      ...(Array.isArray(data.params) ? data.params : []),
    ].filter((entry) => entry !== undefined);
    return prettifyFormatMethodCall("Understudy", method, args);
  }

  if (name.startsWith("Agent")) {
    return `▷ Agent.execute(${prettifyFormatEventArgs(data.params)})`;
  }

  return `${event.eventType}(${prettifyFormatEventArgs(data.params ?? event.data)})`;
}

// Formats the details section for completed/error events.
function prettifyFormatCompletedDetails(event: FlowEvent): string {
  const duration = prettifyFormatDuration(event.data.durationMs);
  const prefix = prettifyIsAgentEvent(event)
    ? "Agent.execute() completed"
    : `${prettifyEventAction(event.eventType).toUpperCase() || event.eventType} completed`;
  const message =
    prettifyIsErrorEvent(event) && typeof event.data.error === "string"
      ? ` ERROR ${event.data.error}`
      : "";
  return `${prettifyIsErrorEvent(event) ? "✕" : "✓"} ${prefix}${duration ? ` in ${duration}` : ""}${message}`;
}

// Formats CDP request/response/message details. These are rendered differently from normal Stagehand lifecycle events because they represent transport-level traffic rather than method envelopes.
function prettifyFormatCdpDetails(event: FlowEvent): string {
  const data = event.data as {
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: string;
  };
  const method = data.method ?? "unknown";
  const icon = event.eventType === "CdpCallEvent" ? "⏵" : "⏴";
  let payload: unknown;
  if (event.eventType === "CdpCallEvent") {
    payload = data.params;
  } else if (data.error) {
    payload = { error: data.error };
  } else if (event.eventType === "CdpMessageEvent") {
    payload = data.params;
  } else {
    payload = data.result;
  }

  return `${icon} ${method}(${prettifyFormatEventArgs(payload)})`;
}

// Formats LLM request/response details for pretty logs.
function prettifyFormatLlmDetails(event: FlowEvent): string {
  const data = event.data as {
    model?: string;
    prompt?: unknown;
    output?: unknown;
    inputTokens?: number;
    outputTokens?: number;
  };
  const model = data.model ?? "llm";

  if (event.eventType === "LlmRequestEvent") {
    const prompt = prettifySummarizePrompt(data.prompt);
    return prompt ? `${model} ⏴ ${prompt}` : `${model} ⏴`;
  }

  const tokenInfo =
    (data.inputTokens || data.outputTokens) > 0
      ? ` ꜛ${data.inputTokens ?? 0} ꜜ${data.outputTokens ?? 0}`
      : "";
  const output = prettifySummarizePrompt(data.output);
  return output ? `${model} ↳${tokenInfo} ${output}` : `${model} ↳${tokenInfo}`;
}

// Converts a flow event into a single pretty log line by combining the current event payload with recent shallow ancestry fetched from the store query sink.
export async function prettifyEvent(
  store: Pick<EventStoreApi, "query">,
  event: FlowEvent,
): Promise<string | null> {
  const recentEvents = await store.query({ limit: 500 });
  const parentMap = new Map(
    recentEvents.map((recentEvent) => [recentEvent.eventId, recentEvent]),
  );
  const tags = prettifyBuildContextTags(event, parentMap);

  let details = prettifyFormatStartedDetails(event);
  if (prettifyIsCdpEvent(event)) {
    details = prettifyFormatCdpDetails(event);
  } else if (prettifyIsLlmEvent(event)) {
    details = prettifyFormatLlmDetails(event);
  } else if (prettifyIsCompletedEvent(event) || prettifyIsErrorEvent(event)) {
    details = prettifyFormatCompletedDetails(event);
  }

  if (!details) {
    return null;
  }

  const createdAt = new Date(event.eventCreatedAt);
  let timestamp = prettifyFormatTimestamp(createdAt);
  if (Number.isNaN(createdAt.getTime())) {
    timestamp = prettifyFormatTimestamp(new Date());
  }

  const line = `${timestamp} ${tags.join(" ")} ${details}`;
  const cleaned = prettifyRemoveQuotes(line);
  const processed = prettifyIsCdpEvent(event)
    ? truncateCdpIds(cleaned)
    : cleaned;
  return prettifyTruncateLine(processed, MAX_LINE_LENGTH);
}

// Adds subtle terminal color to stderr-only pretty lines without affecting file sinks.
export function prettifyColorStderrLine(line: string): string {
  if (
    process.env.NO_COLOR !== undefined ||
    (process.env.FORCE_COLOR ?? "") === "0" ||
    (!process.env.FORCE_COLOR &&
      (!process.stderr.isTTY || process.env.TERM === "dumb"))
  ) {
    return line;
  }

  const color = (code: string, value: string) =>
    `\u001B[${code}m${value}\u001B[0m`;
  return line
    .replace(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{5})/, (_, timestamp) =>
      color("2", timestamp),
    )
    .replace(/\[([🅰🆂🆄🅻🅲])([^\]]*)\]/gu, (_, icon, rest) =>
      color(
        icon === "🅰"
          ? "36"
          : icon === "🆂"
            ? "33"
            : icon === "🆄"
              ? "32"
              : icon === "🅻"
                ? "95"
                : "90",
        `[${icon}${rest}]`,
      ),
    )
    .replace(
      / in (\d+(?:\.\d+)?s)/g,
      (_, duration) => ` ${color("2", "in")} ${color("2", duration)}`,
    )
    .replace(/▷/g, color("96", "▷"))
    .replace(/⏴/g, color("96", "⏴"))
    .replace(/↳/g, color("95", "↳"))
    .replace(/ꜛ/g, color("33", "ꜛ"))
    .replace(/ꜜ/g, color("95", "ꜜ"))
    .replace(/…/g, color("94", "…"))
    .replace(/[(){}=]/g, (char) => color("94", char))
    .replace(
      /([A-Za-z])(\.)([A-Za-z])/g,
      (_, left, dot, right) => `${left}${color("94", dot)}${right}`,
    )
    .replace(/ ✓ /g, ` ${color("32", "✓")} `)
    .replace(/ ✕ /g, ` ${color("31", "✕")} `);
}
