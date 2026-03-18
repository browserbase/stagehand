import fs from "node:fs";
import path from "node:path";
import type { V3Options } from "../types/public/index.js";
import {
  EventSink,
  JsonlFileEventSink,
  PrettyLogFileEventSink,
  PrettyStderrEventSink,
  ShallowInMemoryEventSink,
} from "./EventSink.js";
import { FlowEvent } from "./FlowLogger.js";

const DEFAULT_IN_MEMORY_EVENT_LIMIT = 500; // Per-session ancestry window retained by the default shallow query sink.
const CONFIG_DIR = process.env.BROWSERBASE_CONFIG_DIR || ""; // Base directory for session metadata + file-backed flow logs.
const FLOW_LOGS_ENABLED = process.env.BROWSERBASE_FLOW_LOGS === "1"; // Force-enables the pretty stderr flow sink even when `verbose !== 2`.
const SENSITIVE_KEYS =
  /key|secret|token|api-key|apikey|api_key|password|passwd|pwd|credential|auth/i; // Redacts obvious secrets before session options are written to disk.

// =============================================================================
// Public Contracts
// =============================================================================

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

// =============================================================================
// Filesystem Helpers
// =============================================================================

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
      this.registerSink(new JsonlFileEventSink(sessionDirPromise));
      this.registerSink(new PrettyLogFileEventSink(sessionDirPromise, this));
    }

    if (FLOW_LOGS_ENABLED) {
      this.registerSink(new PrettyStderrEventSink(this));
    }
  }

  // Adds a sink to the direct fanout list used by `emit()`.
  private registerSink(sink: EventSink): void {
    this.sinks.add(sink);
  }

  // Emits an event to all attached sinks when it belongs to this store's single session.
  emit = async (event: FlowEvent): Promise<void> => {
    if (!(event instanceof FlowEvent)) {
      return;
    }

    if (this.destroyed || event.sessionId !== this.sessionId) {
      return;
    }

    await Promise.allSettled([...this.sinks].map((sink) => sink.emit(event)));
  };

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
