import fs from "node:fs";
import path from "node:path";
import type { EventEmitter } from "node:events";

import { toTitleCase } from "../utils.js";
import type { V3Options } from "./types/public/index.js";
import { FlowEvent } from "./flowLogger.js";

const MAX_LINE_LENGTH = 160;
const DEFAULT_IN_MEMORY_EVENT_LIMIT = 500;
const CONFIG_DIR = process.env.BROWSERBASE_CONFIG_DIR || "";
const SENSITIVE_KEYS =
  /apikey|api_key|key|secret|token|password|passwd|pwd|credential|auth/i;

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

function isWritable(stream: fs.WriteStream | null): stream is fs.WriteStream {
  return !!(stream && !stream.destroyed && stream.writable);
}

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

export function getConfigDir(): string {
  return CONFIG_DIR ? path.resolve(CONFIG_DIR) : "";
}

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

function truncateCdpIds(value: string): string {
  return value.replace(
    /([iI]d:?"?)([0-9A-F]{32})(?="?[,})\s]|$)/g,
    (_, prefix: string, id: string) =>
      `${prefix}${id.slice(0, 4)}…${id.slice(-4)}`,
  );
}

// Pretty event formatting.
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

function prettifySanitizeEvent(event: FlowEvent): FlowEvent {
  if (!event.eventType.startsWith("Cdp")) {
    return event;
  }

  return {
    ...event,
    data: prettifySanitizeValue(event.data) as Record<string, unknown>,
  };
}

function prettifyTruncateLine(value: string, maxLen: number): string {
  const collapsed = value.replace(/[\r\n\t]+/g, " ");
  if (collapsed.length <= maxLen) {
    return collapsed;
  }

  const endLen = Math.floor(maxLen * 0.3);
  const startLen = maxLen - endLen - 1;
  return `${collapsed.slice(0, startLen)}…${collapsed.slice(-endLen)}`;
}

function prettifyFormatValue(value: unknown): string {
  if (typeof value === "string") return `'${value}'`;
  if (value == null || typeof value !== "object") return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

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

function shortId(id: string | null | undefined): string {
  return id ? id.slice(-4) : "-";
}

let nonce = 0;

function formatTimestamp(date: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${pad(nonce++ % 100)}`;
}

function removeQuotes(value: string): string {
  return value
    .replace(/([^\\])["']/g, "$1")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function prettifyEventName(eventType: string): string {
  return eventType
    .replace(/CompletedEvent$/, "")
    .replace(/ErrorEvent$/, "")
    .replace(/Event$/, "");
}

function prettifyEventAction(eventType: string): string {
  return prettifyEventName(eventType)
    .replace(/^Agent/, "")
    .replace(/^Stagehand/, "")
    .replace(/^Understudy/, "")
    .replace(/^Page/, "");
}

function prettifyIsAgentEvent(event: FlowEvent): boolean {
  return prettifyEventName(event.eventType).startsWith("Agent");
}

function prettifyIsStagehandEvent(event: FlowEvent): boolean {
  return prettifyEventName(event.eventType).startsWith("Stagehand");
}

function prettifyIsActionEvent(event: FlowEvent): boolean {
  const name = prettifyEventName(event.eventType);
  return name.startsWith("Page") || name.startsWith("Understudy");
}

function prettifyIsCdpEvent(event: FlowEvent): boolean {
  return prettifyEventName(event.eventType).startsWith("Cdp");
}

function prettifyIsLlmEvent(event: FlowEvent): boolean {
  return prettifyEventName(event.eventType).startsWith("Llm");
}

function prettifyIsCompletedEvent(event: FlowEvent): boolean {
  return event.eventType.endsWith("CompletedEvent");
}

function prettifyIsErrorEvent(event: FlowEvent): boolean {
  return event.eventType.endsWith("ErrorEvent");
}

function prettifyFormatTag(
  label: string | null | undefined,
  id: string | null | undefined,
  icon: string,
): string {
  return id ? `[${icon} #${shortId(id)}${label ? ` ${label}` : ""}]` : "⤑";
}

function prettifyFormatDuration(durationMs?: unknown): string | null {
  if (typeof durationMs !== "number") {
    return null;
  }

  return `${(durationMs / 1000).toFixed(2)}s`;
}

function prettifySummarizePrompt(value: unknown): string | undefined {
  if (typeof value === "string") {
    return prettifyTruncateLine(value, MAX_LINE_LENGTH / 2);
  }

  if (value == null) {
    return undefined;
  }

  return prettifyTruncateLine(prettifyFormatValue(value), MAX_LINE_LENGTH / 2);
}

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

function prettifyFormatEventArgs(args?: unknown | unknown[]): string {
  return prettifyFormatArgs(prettifyCompactValue(args) as unknown | unknown[]);
}

function prettifyShouldUseParentTags(event: FlowEvent): boolean {
  return prettifyIsCompletedEvent(event) || prettifyIsErrorEvent(event);
}

async function prettifyResolveParentMap(
  store: Pick<EventStore, "query">,
): Promise<Map<string, FlowEvent>> {
  const recentEvents = await store.query({
    limit: DEFAULT_IN_MEMORY_EVENT_LIMIT,
  });
  return new Map(recentEvents.map((event) => [event.eventId, event]));
}

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

function prettifyBuildContextTags(
  event: FlowEvent,
  parentMap: Map<string, FlowEvent>,
): string[] {
  const includeSelf = !prettifyShouldUseParentTags(event);
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
  const targetId =
    typeof event.data.targetId === "string" ? event.data.targetId : null;

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
      prettifyFormatTag(
        stagehandEvent
          ? prettifyEventAction(stagehandEvent.eventType).toUpperCase()
          : "",
        stagehandEvent?.eventId,
        "🆂",
      ),
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
      prettifyFormatTag(
        stagehandEvent
          ? prettifyEventAction(stagehandEvent.eventType).toUpperCase()
          : "",
        stagehandEvent?.eventId,
        "🆂",
      ),
      prettifyFormatTag(
        actionEvent
          ? prettifyEventAction(actionEvent.eventType).toUpperCase()
          : "",
        actionEvent?.eventId,
        "🆄",
      ),
      prettifyFormatTag("CDP", targetId, "🅲"),
    ];
  }

  if (prettifyIsLlmEvent(event)) {
    const requestId =
      typeof event.data.requestId === "string" ? event.data.requestId : null;

    return [
      prettifyFormatTag("", agentEvent?.eventId, "🅰"),
      prettifyFormatTag(
        stagehandEvent
          ? prettifyEventAction(stagehandEvent.eventType).toUpperCase()
          : "",
        stagehandEvent?.eventId,
        "🆂",
      ),
      prettifyFormatTag("LLM", requestId ?? llmEvent?.eventId, "🧠"),
    ];
  }

  return [`[#${shortId(event.eventId)}]`];
}

function prettifyFormatStartedDetails(event: FlowEvent): string {
  const data = event.data as {
    params?: unknown[];
    target?: string;
  };
  const name = prettifyEventName(event.eventType);

  if (name.startsWith("Stagehand")) {
    const method = prettifyEventAction(event.eventType);
    return `▷ Stagehand.${method[0].toLowerCase()}${method.slice(1)}(${prettifyFormatEventArgs(data.params)})`;
  }

  if (name.startsWith("Page")) {
    const method = prettifyEventAction(event.eventType);
    return `▷ Page.${method[0].toLowerCase()}${method.slice(1)}(${prettifyFormatEventArgs(data.params)})`;
  }

  if (name.startsWith("Understudy")) {
    const method = prettifyEventAction(event.eventType);
    const args = [
      data.target,
      ...(Array.isArray(data.params) ? data.params : []),
    ].filter((entry) => entry !== undefined);
    return `▷ Understudy.${method[0].toLowerCase()}${method.slice(1)}(${prettifyFormatEventArgs(args)})`;
  }

  if (name.startsWith("Agent")) {
    return `▷ Agent.execute(${prettifyFormatEventArgs(data.params)})`;
  }

  return `${event.eventType}(${prettifyFormatEventArgs(data.params ?? event.data)})`;
}

function prettifyFormatCompletedDetails(event: FlowEvent): string {
  const label =
    prettifyEventAction(event.eventType).toUpperCase() || event.eventType;
  const duration = prettifyFormatDuration(event.data.durationMs);
  const prefix = prettifyIsAgentEvent(event)
    ? "Agent.execute() completed"
    : `${label} completed`;

  if (prettifyIsErrorEvent(event)) {
    const message =
      typeof event.data.error === "string" ? ` ERROR ${event.data.error}` : "";
    return `✕ ${prefix}${duration ? ` in ${duration}` : ""}${message}`;
  }

  return `✓ ${prefix}${duration ? ` in ${duration}` : ""}`;
}

function prettifyFormatCdpDetails(event: FlowEvent): string {
  const data = event.data as {
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: string;
  };
  const method = data.method ?? "unknown";
  const icon = event.eventType === "CdpCallEvent" ? "⏵" : "⏴";
  const payload =
    event.eventType === "CdpCallEvent"
      ? data.params
      : data.error
        ? { error: data.error }
        : event.eventType === "CdpMessageEvent"
          ? data.params
          : data.result;

  return `${icon} ${method}(${prettifyFormatEventArgs(payload)})`;
}

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
    data.inputTokens !== undefined || data.outputTokens !== undefined
      ? ` ꜛ${data.inputTokens ?? 0} ꜜ${data.outputTokens ?? 0}`
      : "";
  const output = prettifySummarizePrompt(data.output);
  return output ? `${model} ↳${tokenInfo} ${output}` : `${model} ↳${tokenInfo}`;
}

async function prettifyEvent(
  store: Pick<EventStore, "query">,
  event: FlowEvent,
): Promise<string | null> {
  const parentMap = await prettifyResolveParentMap(store);
  const tags = prettifyBuildContextTags(event, parentMap);
  const details = prettifyIsCdpEvent(event)
    ? prettifyFormatCdpDetails(event)
    : prettifyIsLlmEvent(event)
      ? prettifyFormatLlmDetails(event)
      : prettifyIsCompletedEvent(event) || prettifyIsErrorEvent(event)
        ? prettifyFormatCompletedDetails(event)
        : prettifyFormatStartedDetails(event);

  if (!details) {
    return null;
  }

  const createdAt = new Date(event.createdAt);
  const timestamp = Number.isNaN(createdAt.getTime())
    ? formatTimestamp(new Date())
    : formatTimestamp(createdAt);
  const line = `${timestamp} ${tags.join(" ")} ${details}`;
  const cleaned = removeQuotes(line);
  const processed = prettifyIsCdpEvent(event)
    ? truncateCdpIds(cleaned)
    : cleaned;
  return prettifyTruncateLine(processed, MAX_LINE_LENGTH);
}

abstract class FileEventSink implements EventSink {
  private readonly streamPromise: Promise<fs.WriteStream | null>;

  constructor(sessionDirPromise: Promise<string | null>, fileName: string) {
    this.streamPromise = sessionDirPromise.then((sessionDir) =>
      sessionDir
        ? fs.createWriteStream(path.join(sessionDir, fileName), { flags: "a" })
        : null,
    );
  }

  protected abstract serialize(event: FlowEvent): Promise<string | null>;

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

  async query(): Promise<FlowEvent[]> {
    return [];
  }

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
  constructor(sessionDirPromise: Promise<string | null>) {
    super(sessionDirPromise, "session_events.jsonl");
  }

  protected async serialize(event: FlowEvent): Promise<string> {
    return `${JSON.stringify(event)}\n`;
  }
}

export class PrettyLogFileEventSink extends FileEventSink {
  constructor(
    sessionDirPromise: Promise<string | null>,
    private readonly store: Pick<EventStore, "query">,
  ) {
    super(sessionDirPromise, "session_events.log");
  }

  protected async serialize(event: FlowEvent): Promise<string | null> {
    const line = await prettifyEvent(this.store, prettifySanitizeEvent(event));
    return line ? `${line}\n` : null;
  }
}

export class PrettyStderrEventSink implements EventSink {
  constructor(private readonly store: Pick<EventStore, "query">) {}

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

  async query(): Promise<FlowEvent[]> {
    return [];
  }

  async destroy(): Promise<void> {}
}

export class InMemoryEventSink implements EventSink {
  constructor(protected readonly limit = Infinity) {}

  protected readonly events: FlowEvent[] = [];

  protected storeEvent(event: FlowEvent): FlowEvent {
    return event;
  }

  async emit(event: FlowEvent): Promise<void> {
    this.events.push(this.storeEvent(event));
    if (this.events.length > this.limit) {
      this.events.splice(0, this.events.length - this.limit);
    }
  }

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

  async destroy(): Promise<void> {
    this.events.length = 0;
  }
}

export class ShallowInMemoryEventSink extends InMemoryEventSink {
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

export class EventStore {
  private readonly listeners = new Set<(event: FlowEvent) => Promise<void>>();
  private readonly sinkDetachers = new Map<EventSink, () => void>();
  private readonly ownedSinks = new Set<EventSink>();
  private querySink: EventSink | null = null;
  private destroyed = false;

  constructor(
    public readonly sessionId: string,
    options?: V3Options,
  ) {
    const sessionDirPromise = createSessionDir(sessionId, options);
    const defaultQuerySink = new ShallowInMemoryEventSink(
      DEFAULT_IN_MEMORY_EVENT_LIMIT,
    );

    this.attachOwnedSink(defaultQuerySink);
    this.querySink = defaultQuerySink;

    if (getConfigDir()) {
      this.attachOwnedSink(new JsonlFileEventSink(sessionDirPromise));
      this.attachOwnedSink(new PrettyLogFileEventSink(sessionDirPromise, this));
    }

    if (options?.verbose === 2) {
      this.attachOwnedSink(new PrettyStderrEventSink(this));
    }
  }

  private attachOwnedSink(sink: EventSink): void {
    this.ownedSinks.add(sink);
    this.attachSink(sink);
  }

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

  attachStore(sink: EventSink): () => void {
    if (this.querySink && this.querySink !== sink) {
      if (!this.ownedSinks.has(this.querySink)) {
        throw new Error(
          "A queryable event sink is already attached. Detach it before attaching another.",
        );
      }

      const previousQuerySink = this.querySink;
      this.sinkDetachers.get(previousQuerySink)?.();
      this.ownedSinks.delete(previousQuerySink);
      void previousQuerySink.destroy().catch(() => {
        // best effort cleanup
      });
    }

    const wasAttached = this.sinkDetachers.has(sink);
    const detachSink = wasAttached
      ? (this.sinkDetachers.get(sink) as () => void)
      : this.attachSink(sink);

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

  subscribe(query: EventStoreQuery, listener: EventStoreListener): () => void {
    const normalizedQuery =
      query.sessionId === undefined
        ? query
        : { ...query, sessionId: query.sessionId };

    const wrapped = async (event: FlowEvent): Promise<void> => {
      if (matchesQuery(event, normalizedQuery)) {
        listener(event);
      }
    };

    this.listeners.add(wrapped);
    return () => {
      this.listeners.delete(wrapped);
    };
  }

  async emit(event: FlowEvent): Promise<void> {
    if (this.destroyed || event.sessionId !== this.sessionId) {
      return;
    }

    await Promise.all([...this.listeners].map((listener) => listener(event)));
  }

  attachBus(bus: EventEmitter): () => void {
    const originalEmit = bus.emit.bind(bus);
    bus.emit = ((eventName: string | symbol, ...args: [FlowEvent]) => {
      const [event] = args;
      if (event?.sessionId === this.sessionId) {
        void this.emit(event);
      }
      return originalEmit(eventName, ...args);
    }) as typeof bus.emit;

    return () => {
      bus.emit = originalEmit;
    };
  }

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

  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    const ownedSinks = [...this.ownedSinks];
    for (const detach of [...this.sinkDetachers.values()]) {
      detach();
    }

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
