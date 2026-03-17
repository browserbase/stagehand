import fs from "node:fs";
import path from "node:path";
import type { EventEmitter } from "node:events";

import { toTitleCase } from "../utils.js";
import type { V3Options } from "./types/public/index.js";
import { FlowEvent } from "./flowLogger.js";

const MAX_LINE_LENGTH = 160; // Maximum width for a prettified log line.
const DEFAULT_IN_MEMORY_EVENT_LIMIT = 500; // Default retained event count for shallow ancestry lookups.
const CONFIG_DIR = process.env.BROWSERBASE_CONFIG_DIR || ""; // Enables on-disk session sinks when set.
const SENSITIVE_KEYS =
  /apikey|api_key|key|secret|token|password|passwd|pwd|credential|auth/i; // Keys that should be redacted in session.json.

// =============================================================================
// Query Types
// =============================================================================

export interface EventStoreQuery {
  sessionId?: string;
  eventId?: string;
  eventType?: string;
  limit?: number;
}

export type EventStoreListener = (event: FlowEvent) => void;

export interface EventSink {
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

// Shortens 32-character CDP ids so pretty logs stay readable while still leaving enough information to correlate related targets.
function truncateCdpIds(value: string): string {
  return value.replace(
    /([iI]d:?"?)([0-9A-F]{32})(?="?[,})\s]|$)/g,
    (_, prefix: string, id: string) =>
      `${prefix}${id.slice(0, 4)}…${id.slice(-4)}`,
  );
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

// Predicate used when building pretty ancestry tags.
function prettifyIsAgentEvent(event: FlowEvent): boolean {
  return prettifyEventName(event.eventType).startsWith("Agent");
}

// Predicate used when building pretty ancestry tags.
function prettifyIsStagehandEvent(event: FlowEvent): boolean {
  return prettifyEventName(event.eventType).startsWith("Stagehand");
}

// Predicate used when building pretty ancestry tags.
function prettifyIsActionEvent(event: FlowEvent): boolean {
  const name = prettifyEventName(event.eventType);
  return name.startsWith("Page") || name.startsWith("Understudy");
}

// Predicate used to route events to the CDP pretty formatter.
function prettifyIsCdpEvent(event: FlowEvent): boolean {
  return prettifyEventName(event.eventType).startsWith("Cdp");
}

// Predicate used to route events to the LLM pretty formatter.
function prettifyIsLlmEvent(event: FlowEvent): boolean {
  return prettifyEventName(event.eventType).startsWith("Llm");
}

// Predicate used when deciding whether tags should describe the event itself or its nearest started ancestor.
function prettifyIsCompletedEvent(event: FlowEvent): boolean {
  return event.eventType.endsWith("CompletedEvent");
}

// Predicate used when deciding whether tags should describe the event itself or its nearest started ancestor.
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
  if (typeof durationMs !== "number") {
    return null;
  }

  return `${(durationMs / 1000).toFixed(2)}s`;
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

// Finds the nearest event in the current parent chain that satisfies the given predicate. Pretty tags use this to recover agent/stagehand/action ancestry.
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
      prettifyFormatTag("LLM", requestId ?? llmEvent?.eventId, "🧠"),
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

  if (name.startsWith("Stagehand")) {
    const method = prettifyEventAction(event.eventType);
    return prettifyFormatMethodCall("Stagehand", method, data.params);
  }

  if (name.startsWith("Page")) {
    const method = prettifyEventAction(event.eventType);
    return prettifyFormatMethodCall("Page", method, data.params);
  }

  if (name.startsWith("Understudy")) {
    const method = prettifyEventAction(event.eventType);
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
  const label =
    prettifyEventAction(event.eventType).toUpperCase() || event.eventType;
  const duration = prettifyFormatDuration(event.data.durationMs);
  let prefix = `${label} completed`;
  if (prettifyIsAgentEvent(event)) {
    prefix = "Agent.execute() completed";
  }

  if (prettifyIsErrorEvent(event)) {
    const message =
      typeof event.data.error === "string" ? ` ERROR ${event.data.error}` : "";
    return `✕ ${prefix}${duration ? ` in ${duration}` : ""}${message}`;
  }

  return `✓ ${prefix}${duration ? ` in ${duration}` : ""}`;
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
  let payload: unknown = data.result;
  if (event.eventType === "CdpCallEvent") {
    payload = data.params;
  } else if (data.error) {
    payload = { error: data.error };
  } else if (event.eventType === "CdpMessageEvent") {
    payload = data.params;
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

  let tokenInfo = "";
  if (data.inputTokens !== undefined || data.outputTokens !== undefined) {
    tokenInfo = ` ꜛ${data.inputTokens ?? 0} ꜜ${data.outputTokens ?? 0}`;
  }
  const output = prettifySummarizePrompt(data.output);
  return output ? `${model} ↳${tokenInfo} ${output}` : `${model} ↳${tokenInfo}`;
}

// Converts a flow event into a single pretty log line by combining the current event payload with recent shallow ancestry fetched from the store query sink.
async function prettifyEvent(
  store: Pick<EventStore, "query">,
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

  const createdAt = new Date(event.createdAt);
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

// =============================================================================
// Sink Implementations
// =============================================================================

abstract class FileEventSink implements EventSink {
  private readonly streamPromise: Promise<fs.WriteStream | null>;

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
    private readonly store: Pick<EventStore, "query">,
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
  constructor(private readonly store: Pick<EventStore, "query">) {}

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
          process.stderr.write(`${line}\n`, (error?: Error | null) => {
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

  protected readonly events: FlowEvent[] = [];

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
      const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
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
      createdAt: event.createdAt,
      sessionId: event.sessionId,
      eventParentIds: [...event.eventParentIds],
      data: {},
    });
  }
}

// =============================================================================
// Event Store
// =============================================================================

export class EventStore {
  private readonly listeners = new Set<(event: FlowEvent) => Promise<void>>();
  private readonly sinkDetachers = new Map<EventSink, () => void>();
  private readonly ownedSinks = new Set<EventSink>();
  private querySink: EventSink | null = null;
  private destroyed = false;

  // Creates the per-instance store owned by a single V3 session. This store is intentionally single-session; it ignores events for other session ids.
  constructor(
    // Usually matches `browserbaseSessionId` today, but it is the store's own Stagehand session identifier and may diverge in the future.
    public readonly sessionId: string,
    options?: V3Options,
  ) {
    const sessionDirPromise = createSessionDir(sessionId, options);
    const defaultQuerySink = new ShallowInMemoryEventSink(
      DEFAULT_IN_MEMORY_EVENT_LIMIT,
    );

    this.ownedSinks.add(defaultQuerySink);
    this.attachSink(defaultQuerySink);
    this.querySink = defaultQuerySink;

    if (getConfigDir()) {
      const jsonlSink = new JsonlFileEventSink(sessionDirPromise);
      const prettyLogSink = new PrettyLogFileEventSink(sessionDirPromise, this);
      this.ownedSinks.add(jsonlSink);
      this.ownedSinks.add(prettyLogSink);
      this.attachSink(jsonlSink);
      this.attachSink(prettyLogSink);
    }

    if (options?.verbose === 2) {
      const stderrSink = new PrettyStderrEventSink(this);
      this.ownedSinks.add(stderrSink);
      this.attachSink(stderrSink);
    }
  }

  // Attaches a sink so every future emitted event is forwarded to it.
  attachSink(sink: EventSink): () => void {
    const existing = this.sinkDetachers.get(sink);
    if (existing) {
      return existing;
    }

    const unsubscribe = this.subscribe({}, async (event) => {
      await sink.emit(event);
    });

    const detach = () => {
      unsubscribe();
      this.sinkDetachers.delete(sink);
      if (this.querySink === sink) {
        this.querySink = null;
      }
    };

    this.sinkDetachers.set(sink, detach);
    return detach;
  }

  // Attaches the single queryable sink used by `EventStore.query()`. Tests use this to replace the default shallow history with a full in-memory sink.
  attachStore(sink: EventSink): () => void {
    if (this.querySink && this.querySink !== sink) {
      if (!this.ownedSinks.has(this.querySink)) {
        throw new Error(
          "A queryable event sink is already attached. Detach it before attaching another.",
        );
      }

      // The default shallow sink is owned by the store, so replacing it means
      // detaching and destroying it immediately to avoid retaining duplicate
      // history in memory.
      const previousQuerySink = this.querySink;
      this.sinkDetachers.get(previousQuerySink)?.();
      this.ownedSinks.delete(previousQuerySink);
      void previousQuerySink.destroy().catch(() => {
        // best effort cleanup
      });
    }

    const wasAttached = this.sinkDetachers.has(sink);
    let detachSink: () => void;
    if (wasAttached) {
      detachSink = this.sinkDetachers.get(sink) as () => void;
    } else {
      detachSink = this.attachSink(sink);
    }

    // `query()` always reads from exactly one sink so ancestry lookups stay
    // deterministic even when other write-only sinks are attached.
    this.querySink = sink;

    return () => {
      if (this.querySink === sink) {
        this.querySink = null;
      }
      if (!wasAttached) {
        detachSink();
      }
    };
  }

  // Subscribes a listener to future events matching the provided query.
  subscribe(query: EventStoreQuery, listener: EventStoreListener): () => void {
    const wrapped = async (event: FlowEvent): Promise<void> => {
      if (matchesQuery(event, query)) {
        listener(event);
      }
    };

    this.listeners.add(wrapped);
    return () => {
      this.listeners.delete(wrapped);
    };
  }

  // Emits an event to all attached sinks and listeners when it belongs to this store's single session.
  async emit(event: FlowEvent): Promise<void> {
    if (this.destroyed || event.sessionId !== this.sessionId) {
      return;
    }

    await Promise.all([...this.listeners].map((listener) => listener(event)));
  }

  // Hooks the store into the shared session event bus by forwarding any emitted `FlowEvent` for this store's session into `EventStore.emit()`.
  attachBus(bus: EventEmitter): () => void {
    const originalEmit = bus.emit.bind(bus);
    bus.emit = ((eventName: string | symbol, ...args: [FlowEvent]) => {
      const [event] = args;
      // Forward matching FlowEvents into the store before preserving the bus's
      // original emit behavior for every other listener.
      if (event?.sessionId === this.sessionId) {
        void this.emit(event);
      }
      return originalEmit(eventName, ...args);
    }) as typeof bus.emit;

    return () => {
      bus.emit = originalEmit;
    };
  }

  // Queries the currently attached query sink for events from this store's session only.
  async query(query: EventStoreQuery): Promise<FlowEvent[]> {
    if (query.sessionId && query.sessionId !== this.sessionId) {
      return [];
    }

    return (
      (await this.querySink?.query({
        ...query,
        sessionId: this.sessionId,
      })) ?? []
    );
  }

  // Detaches listeners and tears down all owned sinks when the V3 instance is closed.
  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    const ownedSinks = [...this.ownedSinks];
    // Detach first so no new events race into sinks while teardown is running.
    for (const detach of [...this.sinkDetachers.values()]) {
      detach();
    }

    // Only owned sinks are destroyed here; externally attached sinks keep their
    // own lifecycle and are merely unsubscribed above.
    await Promise.all(
      ownedSinks.map((sink) =>
        sink.destroy().catch(() => {
          // best effort cleanup
        }),
      ),
    );

    this.querySink = null;
    this.listeners.clear();
    this.sinkDetachers.clear();
    this.ownedSinks.clear();
  }
}
