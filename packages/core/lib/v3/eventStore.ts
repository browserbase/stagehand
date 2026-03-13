import fs from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import type { EventEmitter } from "node:events";
import pino from "pino";

import type { V3Options } from "./types/public/index.js";
import { type FlowEvent } from "./flowLogger.js";

const MAX_LINE_LENGTH = 160;
const CONFIG_DIR = process.env.BROWSERBASE_CONFIG_DIR || "";

export interface FlowEventAggregateMetrics {
  llmRequests: number;
  inputTokens: number;
  outputTokens: number;
  cdpEvents: number;
}

export interface EventStoreQuery {
  sessionId?: string;
  eventId?: string;
  eventType?: string;
  limit?: number;
}

export type EventStoreListener = (event: FlowEvent) => void;

export interface EventStore {
  initializeSession(sessionId: string, v3Options?: V3Options): Promise<void>;
  appendEvent(event: FlowEvent): Promise<void>;
  attachBus(sessionId: string, bus: EventEmitter): () => void;
  listEvents(query: EventStoreQuery): Promise<FlowEvent[]>;
  subscribe(query: EventStoreQuery, listener: EventStoreListener): () => void;
  destroy(): Promise<void>;
}

// helper to take a list of events and compute aggregate metrics
export function aggregateFlowEventMetrics(
  events: FlowEvent[],
): FlowEventAggregateMetrics {
  return events.reduce<FlowEventAggregateMetrics>(
    (totals, event) => {
      if (event.eventType === "LlmRequestEvent") {
        totals.llmRequests += 1;
      }

      if (event.eventType === "LlmResponseEvent") {
        const data = event.data as {
          inputTokens?: number;
          outputTokens?: number;
        };
        totals.inputTokens += data?.inputTokens ?? 0;
        totals.outputTokens += data?.outputTokens ?? 0;
      }

      if (event.eventType === "CdpCallEvent") {
        totals.cdpEvents += 1;
      }

      return totals;
    },
    {
      llmRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cdpEvents: 0,
    },
  );
}

interface SessionContext {
  logger: pino.Logger | null;
  sessionId: string;
  sessionDir: string;
  configDir: string;
  initPromise: Promise<void>;
  initialized: boolean;
  fileStreams: {
    pretty: fs.WriteStream | null;
    jsonl: fs.WriteStream | null;
  };
}

interface EventSubscriber {
  listener: EventStoreListener;
  query: EventStoreQuery;
}

function truncateCdpIds(value: string): string {
  return value.replace(
    /([iI]d:?"?)([0-9A-F]{32})(?="?[,})\s]|$)/g,
    (_, prefix: string, id: string) =>
      `${prefix}${id.slice(0, 4)}…${id.slice(-4)}`,
  );
}

function sanitizeSinkValue(value: unknown): unknown {
  if (typeof value === "string") {
    return truncateCdpIds(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeSinkValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeSinkValue(entry)]),
    );
  }

  return value;
}

function sanitizeEventForFileStore(event: FlowEvent): FlowEvent {
  if (!event.eventType.startsWith("Cdp")) {
    return event;
  }

  return {
    ...event,
    data: sanitizeSinkValue(event.data) as Record<string, unknown>,
  };
}

function truncateLine(value: string, maxLen: number): string {
  const collapsed = value.replace(/\s+/g, " ");
  if (collapsed.length <= maxLen) {
    return collapsed;
  }

  const endLen = Math.floor(maxLen * 0.3);
  const startLen = maxLen - endLen - 1;
  return `${collapsed.slice(0, startLen)}…${collapsed.slice(-endLen)}`;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return `'${value}'`;
  if (value == null || typeof value !== "object") return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function formatArgs(args?: unknown | unknown[]): string {
  if (args === undefined) {
    return "";
  }

  return (Array.isArray(args) ? args : [args])
    .filter((entry) => entry !== undefined)
    .map(formatValue)
    .filter((entry) => entry.length > 0)
    .join(", ");
}

function shortId(id: string | null | undefined): string {
  return id ? id.slice(-4) : "-";
}

let nonce = 0;
function formatTimestamp(): string {
  const date = new Date();
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${pad(nonce++ % 100)}`;
}

const SENSITIVE_KEYS =
  /apikey|api_key|key|secret|token|password|passwd|pwd|credential|auth/i;

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

function removeQuotes(value: string): string {
  return value
    .replace(/([^\\])["']/g, "$1")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function formatEventTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return formatTimestamp();
  }

  const pad = (entry: number, width = 2) => String(entry).padStart(width, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${pad(nonce++ % 100)}`;
}

function prettifyEvent(event: FlowEvent): string | null {
  const indent = "  ".repeat(event.eventParentIds.length);
  const tag = `[#${shortId(event.eventId)}]`;
  const data = event.data as {
    params?: unknown;
    prompt?: unknown;
    output?: unknown;
    durationMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    error?: string;
    msg?: string;
  };
  const argsStr = data?.params ? formatArgs(data.params) : formatArgs(event.data);
  const durationSec = data?.durationMs
    ? (data.durationMs / 1000).toFixed(2)
    : null;
  const promptStr = data?.prompt ? ` ${String(data.prompt)}` : "";
  const outputStr = data?.output ? ` ${String(data.output)}` : "";
  const hasTokens =
    data?.inputTokens !== undefined || data?.outputTokens !== undefined;
  const tokenStr = hasTokens
    ? ` ꜛ${data?.inputTokens ?? 0} ꜜ${data?.outputTokens ?? 0}`
    : "";
  const details = [
    event.eventType,
    argsStr ? `(${argsStr})` : "",
    promptStr,
    outputStr,
    tokenStr,
    durationSec ? ` ${durationSec}s` : "",
    data?.msg ? ` ${data.msg}` : "",
    data?.error ? ` ERROR ${data.error}` : "",
  ].join("");

  if (!details) {
    return null;
  }

  const fullLine = `${formatEventTimestamp(event.createdAt)} ${indent}${tag} ${details}`;
  const cleaned = removeQuotes(fullLine);
  return truncateLine(cleaned, MAX_LINE_LENGTH);
}

function isWritable(stream: fs.WriteStream | null): stream is fs.WriteStream {
  return !!(stream && !stream.destroyed && stream.writable);
}

function createJsonlStream(ctx: SessionContext): Writable {
  return new Writable({
    objectMode: true,
    write(chunk: string, _, cb) {
      if (ctx.initialized && isWritable(ctx.fileStreams.jsonl)) {
        ctx.fileStreams.jsonl.write(chunk, cb);
        return;
      }

      cb();
    },
  });
}

function createPrettyStream(ctx: SessionContext): Writable {
  return new Writable({
    objectMode: true,
    write(chunk: string, _, cb) {
      const stream = ctx.fileStreams.pretty;
      if (!ctx.initialized || !isWritable(stream)) {
        cb();
        return;
      }

      try {
        const event = JSON.parse(chunk) as FlowEvent;
        const line = prettifyEvent(event);
        if (line) {
          stream.write(line + "\n", cb);
          return;
        }
      } catch {
        // fall through
      }

      cb();
    },
  });
}

export function getConfigDir(): string {
  return CONFIG_DIR ? path.resolve(CONFIG_DIR) : "";
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

export class FileEventStore implements EventStore {
  private readonly sessionContexts = new Map<string, SessionContext>();
  private readonly eventsBySession = new Map<string, FlowEvent[]>();
  private readonly subscribers = new Set<EventSubscriber>();

  async initializeSession(
    sessionId: string,
    v3Options?: V3Options,
  ): Promise<void> {
    const existing = this.sessionContexts.get(sessionId);
    if (existing) {
      await existing.initPromise;
      return;
    }

    const configDir = getConfigDir();
    const sessionDir = configDir
      ? path.join(configDir, "sessions", sessionId)
      : "";

    const ctx: SessionContext = {
      logger: null,
      sessionId,
      sessionDir,
      configDir,
      initPromise: Promise.resolve(),
      initialized: false,
      fileStreams: {
        pretty: null,
        jsonl: null,
      },
    };

    ctx.initPromise = this.initSessionContext(ctx, v3Options);
    this.sessionContexts.set(sessionId, ctx);
    await ctx.initPromise;
  }

  private async initSessionContext(
    ctx: SessionContext,
    v3Options?: V3Options,
  ): Promise<void> {
    if (!ctx.configDir) {
      ctx.initialized = true;
      return;
    }

    await fs.promises.mkdir(ctx.sessionDir, { recursive: true });

    if (v3Options) {
      const sessionJsonPath = path.join(ctx.sessionDir, "session.json");
      await fs.promises.writeFile(
        sessionJsonPath,
        JSON.stringify(sanitizeOptions(v3Options), null, 2),
        "utf-8",
      );
    }

    const latestLink = path.join(ctx.configDir, "sessions", "latest");
    try {
      try {
        await fs.promises.unlink(latestLink);
      } catch {
        // ignore missing link
      }
      await fs.promises.symlink(ctx.sessionId, latestLink, "dir");
    } catch {
      // symlink best effort only
    }

    ctx.fileStreams.pretty = fs.createWriteStream(
      path.join(ctx.sessionDir, "session_events.log"),
      { flags: "a" },
    );
    ctx.fileStreams.jsonl = fs.createWriteStream(
      path.join(ctx.sessionDir, "session_events.jsonl"),
      { flags: "a" },
    );

    ctx.initialized = true;
    ctx.logger = pino(
      { level: "info" },
      pino.multistream([
        { stream: createJsonlStream(ctx) },
        { stream: createPrettyStream(ctx) },
      ]),
    );
  }

  async appendEvent(event: FlowEvent): Promise<void> {
    const storedEvent = sanitizeEventForFileStore(event);
    const existing = this.eventsBySession.get(storedEvent.sessionId) ?? [];
    existing.push(storedEvent);
    this.eventsBySession.set(storedEvent.sessionId, existing);

    for (const subscriber of this.subscribers) {
      if (matchesQuery(storedEvent, subscriber.query)) {
        subscriber.listener(storedEvent);
      }
    }

    const ctx = this.sessionContexts.get(storedEvent.sessionId);
    if (!ctx) {
      return;
    }

    await ctx.initPromise;
    ctx.logger?.info(storedEvent);
  }

  attachBus(sessionId: string, bus: EventEmitter): () => void {
    const emit = bus.emit.bind(bus);
    bus.emit = ((eventName: string | symbol, ...args: [FlowEvent]) => {
      const [event] = args;
      if (event.sessionId === sessionId) {
        void this.appendEvent(event);
      }
      return emit(eventName, ...args);
    }) as typeof bus.emit;

    return () => {
      bus.emit = emit;
    };
  }

  async listEvents(query: EventStoreQuery): Promise<FlowEvent[]> {
    const sourceEvents = query.sessionId
      ? [...(this.eventsBySession.get(query.sessionId) ?? [])]
      : [...this.eventsBySession.values()].flat();

    const filtered = sourceEvents.filter((event) => matchesQuery(event, query));
    filtered.sort((left, right) => {
      const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
      if (createdAtOrder !== 0) {
        return createdAtOrder;
      }

      return left.eventId.localeCompare(right.eventId);
    });

    if (!query.limit) {
      return filtered;
    }

    return filtered.slice(0, query.limit);
  }

  subscribe(query: EventStoreQuery, listener: EventStoreListener): () => void {
    const subscriber: EventSubscriber = { query, listener };
    this.subscribers.add(subscriber);

    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  async destroy(): Promise<void> {
    this.subscribers.clear();
    this.eventsBySession.clear();

    await Promise.all(
      [...this.sessionContexts.values()].flatMap((ctx) =>
        Object.values(ctx.fileStreams)
          .filter(Boolean)
          .map(
            (stream) =>
              new Promise<void>((resolve) => {
                stream!.end(resolve);
              }),
          ),
      ),
    ).catch(() => {});

    this.sessionContexts.clear();
  }
}

let eventStore: EventStore | null = null;

export function setEventStore(store: EventStore): void {
  eventStore = store;
}

export function getEventStore(): EventStore {
  if (!eventStore) {
    eventStore = new FileEventStore();
  }

  return eventStore;
}

export async function destroyEventStore(): Promise<void> {
  if (!eventStore) {
    return;
  }

  await eventStore.destroy();
  eventStore = null;
}
