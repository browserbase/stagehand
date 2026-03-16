import fs from "node:fs";
import path from "node:path";
import type { EventEmitter } from "node:events";

import type { V3Options } from "./types/public/index.js";
import { type FlowEvent } from "./flowLogger.js";

const MAX_LINE_LENGTH = 160;
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

function sanitizePrettyValue(value: unknown): unknown {
  if (typeof value === "string") {
    return truncateCdpIds(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePrettyValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sanitizePrettyValue(entry),
      ]),
    );
  }

  return value;
}

function sanitizePrettyEvent(event: FlowEvent): FlowEvent {
  if (!event.eventType.startsWith("Cdp")) {
    return event;
  }

  return {
    ...event,
    data: sanitizePrettyValue(event.data) as Record<string, unknown>,
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

function prettifyEvent(event: FlowEvent): string | null {
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
  const durationSec = data?.durationMs
    ? (data.durationMs / 1000).toFixed(2)
    : null;
  const hasTokens =
    data?.inputTokens !== undefined || data?.outputTokens !== undefined;
  const details = [
    event.eventType,
    formatArgs(data?.params ? data.params : event.data)
      ? `(${formatArgs(data?.params ? data.params : event.data)})`
      : "",
    data?.prompt ? ` ${String(data.prompt)}` : "",
    data?.output ? ` ${String(data.output)}` : "",
    hasTokens ? ` ꜛ${data?.inputTokens ?? 0} ꜜ${data?.outputTokens ?? 0}` : "",
    durationSec ? ` ${durationSec}s` : "",
    data?.msg ? ` ${data.msg}` : "",
    data?.error ? ` ERROR ${data.error}` : "",
  ].join("");

  if (!details) {
    return null;
  }

  const createdAt = new Date(event.createdAt);
  const timestamp = Number.isNaN(createdAt.getTime())
    ? formatTimestamp(new Date())
    : formatTimestamp(createdAt);
  const line = `${timestamp} ${"  ".repeat(event.eventParentIds.length)}[#${shortId(event.eventId)}] ${details}`;
  return truncateLine(removeQuotes(line), MAX_LINE_LENGTH);
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

  protected abstract serialize(event: FlowEvent): string | null;

  async emit(event: FlowEvent): Promise<void> {
    const stream = await this.streamPromise;
    if (!isWritable(stream)) {
      return;
    }

    const serialized = this.serialize(event);
    if (!serialized) {
      return;
    }

    await writeToStream(stream, serialized);
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

  protected serialize(event: FlowEvent): string {
    return `${JSON.stringify(event)}\n`;
  }
}

export class PrettyLogFileEventSink extends FileEventSink {
  constructor(sessionDirPromise: Promise<string | null>) {
    super(sessionDirPromise, "session_events.log");
  }

  protected serialize(event: FlowEvent): string | null {
    const line = prettifyEvent(sanitizePrettyEvent(event));
    return line ? `${line}\n` : null;
  }
}

export class PrettyStderrEventSink implements EventSink {
  async emit(event: FlowEvent): Promise<void> {
    const line = prettifyEvent(sanitizePrettyEvent(event));
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
  }

  async query(): Promise<FlowEvent[]> {
    return [];
  }

  async destroy(): Promise<void> {}
}

export class InMemoryEventSink implements EventSink {
  private readonly events: FlowEvent[] = [];

  async emit(event: FlowEvent): Promise<void> {
    this.events.push(event);
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
    return query.limit ? filtered.slice(0, query.limit) : filtered;
  }

  async destroy(): Promise<void> {
    this.events.length = 0;
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

    if (getConfigDir()) {
      this.attachOwnedSink(new JsonlFileEventSink(sessionDirPromise));
      this.attachOwnedSink(new PrettyLogFileEventSink(sessionDirPromise));
    }

    if (options?.verbose === 2) {
      this.attachOwnedSink(new PrettyStderrEventSink());
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
      throw new Error(
        "A queryable event sink is already attached. Detach it before attaching another.",
      );
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
