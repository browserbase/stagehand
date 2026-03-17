import fs from "node:fs";
import path from "node:path";
import { chalkStderr } from "chalk";
import { toTitleCase } from "../utils.js";
import type { V3Options } from "./types/public/index.js";
import { FlowEvent } from "./flowLogger.js";

// per stagehand instance, max history size for event parent id lookups
// (doesn't store event.data, only metadata fields e.g. eventId, eventParentIds, etc.)
const DEFAULT_IN_MEMORY_EVENT_LIMIT = 500;

// session metadata + event logs get saved in  BROWSERBASE_CONFIG_DIR/sessions/<session-id>/*.{log,json,jsonl,...}
const CONFIG_DIR = process.env.BROWSERBASE_CONFIG_DIR || "";
// e.g. BROWSERBASE_CONFIG_DIR=~/.config/browserbase, BROWSERBASE_CONFIG_DIR=., BROWSERBASE_CONFIG_DIR=/tmp/bb
const FLOW_LOGS_ENABLED = process.env.BROWSERBASE_FLOW_LOGS === "1"; // Force-enables the pretty stderr flow sink even when `verbose !== 2`.

// Some last-line-of-defense patterns that should be redacted at all costs when prettifying in log sinks
const SENSITIVE_KEYS =
  /key|secret|token|api-key|apikey|api_key|password|passwd|pwd|credential|auth/i;

const MAX_LINE_LENGTH = 160; // Maximum width for a prettified log line

// =============================================================================
// Public Contracts
// =============================================================================

export interface EventSink {
  emit(event: FlowEvent): Promise<void>;
  query(query: EventStoreQuery): Promise<FlowEvent[]>;
  destroy(): Promise<void>;
}

export interface EventStoreQuery {
  sessionId?: string;
  eventId?: string;
  eventType?: string;
  limit?: number;
}

export interface EventStoreApi {
  readonly sessionId: string;
  emit(event: FlowEvent): Promise<void>;
  query(query: EventStoreQuery): Promise<FlowEvent[]>;
  destroy(): Promise<void>;
}

// Checks whether an event matches a query used by subscribers and queryable sinks. `eventId` matches both the event itself and descendants of that event.
function matchesQuery(event: FlowEvent, query: EventStoreQuery): boolean {
  if (query.sessionId && event.sessionId !== query.sessionId) return false;

  if (query.eventId) {
    const matchesEvent =
      event.eventId === query.eventId ||
      event.eventParentIds.includes(query.eventId);
    if (!matchesEvent) {
      return false;
    }
  }

  if (query.eventType) {
    const pattern = new RegExp(
      `^${query.eventType
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\\\*/g, ".*")}$`,
    );
    if (!pattern.test(event.eventType)) {
      return false;
    }
  }

  return true;
}

// =============================================================================
// Filesystem Helpers
// =============================================================================

// Returns true when a file sink's stream is still open and writable.
function isWritable(stream: fs.WriteStream | null): stream is fs.WriteStream {
  return !!(stream && !stream.destroyed && stream.writable);
}

// Writes a serialized event to a file sink and converts callback-style stream completion into a promise.
function writeToStream(stream: fs.WriteStream, value: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      stream.write(value, (error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

// Redacts secrets before session options are written to `session.json` inside a config-dir-backed session directory.
function sanitizeOptions(options: V3Options): Record<string, unknown> {
  const sanitize = (value: unknown): unknown => {
    if (typeof value !== "object" || value === null) return value;
    if (Array.isArray(value)) return value.map(sanitize);

    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = SENSITIVE_KEYS.test(key) ? "******" : sanitize(entry);
    }
    return result;
  };

  return sanitize({ ...options }) as Record<string, unknown>;
}

// Resolves the configured Browserbase config directory used by file sinks.
export function getConfigDir(): string {
  return CONFIG_DIR ? path.resolve(CONFIG_DIR) : "";
}

// Creates the per-session directory used by file sinks and writes best-effort metadata such as the sanitized `session.json` file and `latest` symlink.
async function createSessionDir(
  sessionId: string,
  options?: V3Options,
): Promise<string | null> {
  const configDir = getConfigDir();
  if (!configDir) {
    return null;
  }

  const sessionDir = path.join(configDir, "sessions", sessionId);
  await fs.promises.mkdir(sessionDir, { recursive: true });

  if (options) {
    await fs.promises.writeFile(
      path.join(sessionDir, "session.json"),
      JSON.stringify(sanitizeOptions(options), null, 2),
      "utf-8",
    );
  }

  const latestLink = path.join(configDir, "sessions", "latest");
  try {
    try {
      await fs.promises.unlink(latestLink);
    } catch {
      // ignore missing link
    }
    await fs.promises.symlink(sessionId, latestLink, "dir");
  } catch {
    // symlink best effort only
  }

  return sessionDir;
}

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
function prettifySanitizeEvent(event: FlowEvent): FlowEvent {
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
function formatTimestamp(date: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${pad(nonce++ % 100)}`;
}

// Removes noisy quoting artifacts from the final pretty line.
function removeQuotes(value: string): string {
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
function prettifyIsCdpEvent(event: FlowEvent): boolean {
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
  return typeof value === "string"
    ? prettifyTruncateLine(value, MAX_LINE_LENGTH / 2)
    : value == null
      ? undefined
      : prettifyTruncateLine(prettifyFormatValue(value), MAX_LINE_LENGTH / 2);
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

// Finds the nearest event in the current parent chain that satisfies the given predicate.
// Pretty tags use this to recover agent/stagehand/action/llm ancestry.
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
  const payload: unknown =
    event.eventType === "CdpCallEvent"
      ? data.params
      : data.error
        ? { error: data.error }
        : event.eventType === "CdpMessageEvent"
          ? data.params
          : data.result;

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
async function prettifyEvent(
  store: Pick<EventStoreApi, "query">,
  event: FlowEvent,
): Promise<string | null> {
  const recentEvents = await store.query({
    limit: DEFAULT_IN_MEMORY_EVENT_LIMIT,
  });
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
  let timestamp = formatTimestamp(createdAt);
  if (Number.isNaN(createdAt.getTime())) {
    timestamp = formatTimestamp(new Date());
  }
  const line = `${timestamp} ${tags.join(" ")} ${details}`;
  const cleaned = removeQuotes(line);
  let processed = cleaned;
  if (prettifyIsCdpEvent(event)) {
    processed = truncateCdpIds(cleaned);
  }
  return prettifyTruncateLine(processed, MAX_LINE_LENGTH);
}

function prettifyColorStderrLine(line: string): string {
  const purple = chalkStderr.hex("#a855f7");
  const colors = { "🅰": chalkStderr.cyan, "🆂": chalkStderr.yellow, "🆄": chalkStderr.green, "🅻": purple, "🅲": chalkStderr.gray } as const;
  return line
    .replace(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{5})/, (_, timestamp) => chalkStderr.dim(timestamp))
    .replace(/\[([🅰🆂🆄🅻🅲])([^\]]*)\]/gu, (_, icon, rest) => (colors[icon as keyof typeof colors] ?? ((value: string) => value))(`[${icon}${rest}]`))
    .replace(/ in (\d+(?:\.\d+)?s)/g, (_, duration) => ` ${chalkStderr.dim("in")} ${chalkStderr.dim(duration)}`)
    .replace(/▷/g, chalkStderr.cyanBright("▷"))
    .replace(/⏴/g, chalkStderr.cyanBright("⏴"))
    .replace(/↳/g, purple("↳"))
    .replace(/ꜛ/g, chalkStderr.yellow("ꜛ"))
    .replace(/ꜜ/g, purple("ꜜ"))
    .replace(/…/g, chalkStderr.blueBright("…"))
    .replace(/[(){}=]/g, (char) => chalkStderr.blueBright(char))
    .replace(/([A-Za-z])(\.)([A-Za-z])/g, (_, left, dot, right) => `${left}${chalkStderr.blueBright(dot)}${right}`)
    .replace(/ ✓ /g, ` ${chalkStderr.green("✓")} `)
    .replace(/ ✕ /g, ` ${chalkStderr.red("✕")} `);
}

// =============================================================================
// Sink Implementations
// =============================================================================

abstract class FileEventSink implements EventSink {
  private readonly streamPromise: Promise<fs.WriteStream | null>; // Lazily opens the one file stream owned by this sink when the session directory resolves.

  // Creates a best-effort file sink bound to a single session directory.
  constructor(sessionDirPromise: Promise<string | null>, fileName: string) {
    this.streamPromise = sessionDirPromise.then((sessionDir) =>
      sessionDir
        ? fs.createWriteStream(path.join(sessionDir, fileName), { flags: "a" })
        : null,
    );
  }

  protected abstract serialize(event: FlowEvent): Promise<string | null>;

  // Serializes and appends a single event. File sinks are intentionally best-effort and never allowed to affect library execution flow.
  async emit(event: FlowEvent): Promise<void> {
    try {
      const stream = await this.streamPromise;
      if (!isWritable(stream)) {
        return;
      }

      const serialized = await this.serialize(event);
      if (!serialized) {
        return;
      }

      await writeToStream(stream, serialized);
    } catch {
      // best effort only
    }
  }

  // File sinks are write-only and do not support query reads.
  async query(): Promise<FlowEvent[]> {
    return [];
  }

  // Closes the underlying file stream when the owning store shuts down.
  async destroy(): Promise<void> {
    const stream = await this.streamPromise.catch((): null => null);
    if (!isWritable(stream)) {
      return;
    }

    await new Promise<void>((resolve) => {
      stream.end(resolve);
    });
  }
}

export class JsonlFileEventSink extends FileEventSink {
  // Writes full verbatim events to `session_events.jsonl`.
  constructor(sessionDirPromise: Promise<string | null>) {
    super(sessionDirPromise, "session_events.jsonl");
  }

  // Serializes the full event for lossless machine-readable storage.
  protected async serialize(event: FlowEvent): Promise<string> {
    return `${JSON.stringify(event)}\n`;
  }
}

export class PrettyLogFileEventSink extends FileEventSink {
  // Writes human-readable pretty lines to `session_events.log`.
  constructor(
    sessionDirPromise: Promise<string | null>,
    private readonly store: Pick<EventStoreApi, "query">, // Queried during prettification so each line can recover recent ancestry tags.
  ) {
    super(sessionDirPromise, "session_events.log");
  }

  // Pretty-prints the event using recent in-memory ancestry.
  protected async serialize(event: FlowEvent): Promise<string | null> {
    const line = await prettifyEvent(this.store, prettifySanitizeEvent(event));
    return line ? `${line}\n` : null;
  }
}

export class PrettyStderrEventSink implements EventSink {
  // Writes pretty lines to stderr for verbose local debugging. CDP events are intentionally omitted here to keep stderr high-signal.
  constructor(private readonly store: Pick<EventStoreApi, "query">) {} // Queried during prettification so stderr lines can include recent ancestry tags.

  // Best-effort stderr writer used only for interactive debugging output.
  async emit(event: FlowEvent): Promise<void> {
    try {
      if (prettifyIsCdpEvent(event)) {
        return;
      }

      const line = await prettifyEvent(
        this.store,
        prettifySanitizeEvent(event),
      );
      if (!line) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        try {
          process.stderr.write(
            `${prettifyColorStderrLine(line)}\n`,
            (error?: Error | null) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            },
          );
        } catch (error) {
          reject(error);
        }
      });
    } catch {
      // best effort only
    }
  }

  // Stderr sink is write-only and does not support query reads.
  async query(): Promise<FlowEvent[]> {
    return [];
  }

  // No teardown is required for stderr.
  async destroy(): Promise<void> {}
}

export class InMemoryEventSink implements EventSink {
  // Retains recent events for query lookups. Tests usually attach this sink explicitly when they need full historical payloads.
  constructor(protected readonly limit = Infinity) {}

  protected readonly events: FlowEvent[] = []; // Retained history; `emit()` appends to it and trims old entries when `limit` is exceeded.

  // Gives subclasses a hook to transform events before they are retained.
  protected storeEvent(event: FlowEvent): FlowEvent {
    return event;
  }

  // Stores a new event and trims the oldest retained entries once the sink exceeds its configured limit.
  async emit(event: FlowEvent): Promise<void> {
    this.events.push(this.storeEvent(event));
    if (this.events.length > this.limit) {
      this.events.splice(0, this.events.length - this.limit);
    }
  }

  // Returns retained events that match the query, ordered by creation time.
  async query(query: EventStoreQuery): Promise<FlowEvent[]> {
    const filtered = this.events.filter((event) => matchesQuery(event, query));
    filtered.sort((left, right) => {
      const createdAtOrder = left.eventCreatedAt.localeCompare(
        right.eventCreatedAt,
      );
      if (createdAtOrder !== 0) {
        return createdAtOrder;
      }

      return left.eventId.localeCompare(right.eventId);
    });
    return query.limit ? filtered.slice(-query.limit) : filtered;
  }

  // Clears retained history when the owning store shuts down.
  async destroy(): Promise<void> {
    this.events.length = 0;
  }
}

export class ShallowInMemoryEventSink extends InMemoryEventSink {
  // Retains only ancestry metadata for the default query sink so verbose or long-running sessions do not hold onto large payloads such as screenshots.
  protected override storeEvent(event: FlowEvent): FlowEvent {
    return new FlowEvent({
      eventType: event.eventType,
      eventId: event.eventId,
      eventCreatedAt: event.eventCreatedAt,
      sessionId: event.sessionId,
      eventParentIds: [...event.eventParentIds],
      data: {},
    });
  }
}

// =============================================================================
// Event Store
// =============================================================================

// Per-session flow event sink manager.
// This is not an event bus. V3 forwards already-emitted FlowEvents into it so
// the store can fan them out to configured sinks, answer `query()` calls from
// its one query sink, and tear down its sinks when the session closes.
// We keep this as a separate object instead of wiring sinks directly with
// `v3.bus.on("*", sink.emit)` because pretty sinks need access to a shared
// query interface while rendering. Prettified lines often need to look up
// related parent/child events to recover the readable ancestry tags and labels.
// Passing sinks into each other to share that state gets messy quickly, so the
// EventStore contains the circular dependency: all sinks live here, and any
// sink that needs historical context can call the one `EventStore.query()`
// entrypoint backed by the main query sink for this session.
export class EventStore implements EventStoreApi {
  private readonly sinks = new Set<EventSink>(); // All sinks attached for this session; constructor registers them here and `destroy()` tears them down.
  private destroyed = false; // Flipped by `destroy()` so later emits and teardown calls become no-ops.
  public query: (query: EventStoreQuery) => Promise<FlowEvent[]>; // Always reads from the one query sink chosen at construction time.

  // Creates the per-instance store owned by a single V3 session. This store is intentionally single-session; it ignores events for other session ids.
  constructor(
    // Usually matches `browserbaseSessionId` today, but it is the store's own Stagehand session identifier and may diverge in the future.
    public readonly sessionId: string,
    options?: V3Options,
    querySink: EventSink = new ShallowInMemoryEventSink(
      DEFAULT_IN_MEMORY_EVENT_LIMIT,
    ),
  ) {
    const sessionDirPromise = createSessionDir(sessionId, options);

    this.registerSink(querySink);
    this.query = async (query) => {
      if (query.sessionId && query.sessionId !== this.sessionId) {
        return [];
      }

      return querySink.query({
        ...query,
        sessionId: this.sessionId,
      });
    };

    if (getConfigDir()) {
      const jsonlSink = new JsonlFileEventSink(sessionDirPromise);
      const prettyLogSink = new PrettyLogFileEventSink(sessionDirPromise, this);
      this.registerSink(jsonlSink);
      this.registerSink(prettyLogSink);
    }

    if (options?.verbose === 2 || FLOW_LOGS_ENABLED) {
      const stderrSink = new PrettyStderrEventSink(this);
      this.registerSink(stderrSink);
    }
  }

  // Adds a sink to the direct fanout list used by `emit()`.
  private registerSink(sink: EventSink): void {
    this.sinks.add(sink);
  }

  // Emits an event to all attached sinks when it belongs to this store's single session.
  async emit(event: FlowEvent): Promise<void> {
    if (this.destroyed || event.sessionId !== this.sessionId) {
      return;
    }

    await Promise.all(
      [...this.sinks].map(async (sink) => {
        await sink.emit(event);
      }),
    );
  }

  // Tears down all sinks when the V3 instance is closed.
  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    await Promise.all(
      [...this.sinks].map((sink) =>
        sink.destroy().catch(() => {
          // best effort cleanup
        }),
      ),
    );

    this.sinks.clear();
  }
}
