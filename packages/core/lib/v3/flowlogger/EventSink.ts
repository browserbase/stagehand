import fs from "node:fs";
import path from "node:path";
import { FlowEvent } from "./FlowLogger.js";
import type { EventStoreApi, EventStoreQuery } from "./EventStore.js";
import {
  prettifyColorStderrLine,
  prettifyEvent,
  prettifyIsCdpEvent,
  prettifySanitizeEvent,
} from "./prettify.js";

// =============================================================================
// Event Sink Contracts
// =============================================================================

export interface EventSink {
  emit(event: FlowEvent): Promise<void>;
  query(query: EventStoreQuery): Promise<FlowEvent[]>;
  destroy(): Promise<void>;
}

// Checks whether an event matches a query used by queryable sinks. `eventId` matches both the event itself and descendants of that event.
function matchesEventStoreQuery(
  event: FlowEvent,
  query: EventStoreQuery,
): boolean {
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
// File Sink Helpers
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

// =============================================================================
// Event Sink Implementations
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
    const filtered = this.events.filter((event) =>
      matchesEventStoreQuery(event, query),
    );
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
