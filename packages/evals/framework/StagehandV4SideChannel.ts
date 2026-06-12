import type {
  StagehandV4BusSnapshot,
  StagehandV4NativeRuntime,
} from "./StagehandV4Types.js";

export type StagehandV4BusRecord = {
  attributes?: Record<string, unknown>;
  endTime?: string;
  error?: string;
  name: string;
  parentSpanId?: string;
  result?: unknown;
  spanId: string;
  startTime?: string;
};

export type StagehandV4SideChannelOptions = {
  onRecord: (record: StagehandV4BusRecord) => void | Promise<void>;
  pollIntervalMs?: number;
  stagehandV4: StagehandV4NativeRuntime;
  warn?: (message: string) => void;
};

export class StagehandV4SideChannel {
  private busName = "StagehandSession";
  private flush = Promise.resolve();
  private interval: ReturnType<typeof setInterval> | undefined;
  private started = false;
  private stopped = false;

  constructor(private readonly options: StagehandV4SideChannelOptions) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    await this.capture({ full: true, warnOnError: true });
    this.interval = setInterval(() => {
      void this.capture();
    }, this.options.pollIntervalMs ?? 5000);
    this.interval.unref?.();
  }

  async stop(): Promise<void> {
    if (!this.started || this.stopped) return;
    this.stopped = true;
    if (this.interval != null) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    await this.capture({ full: true, warnOnError: true });
  }

  capture(
    options: { full?: boolean; warnOnError?: boolean } = {},
  ): Promise<void> {
    this.flush = this.flush.catch(() => {}).then(() => this.read(options));
    return this.flush;
  }

  private async read(options: {
    full?: boolean;
    warnOnError?: boolean;
  }): Promise<void> {
    try {
      const snapshot = await this.options.stagehandV4.busSnapshot(
        options.full
          ? { include_json: true, past: true, future: false }
          : { past: 5, future: false },
      );
      const snapshotRecords =
        options.full && snapshot.json !== undefined
          ? recordsFromBusSnapshot(snapshot, this.busName)
          : {
              busName: this.busName,
              records: recordsFromBusEvents(snapshot.events, this.busName),
            };
      this.busName = snapshotRecords.busName;
      const records = snapshotRecords.records;
      if (process.env.STAGEHAND_V4_TRACE_DEBUG === "1") {
        const matchingRecords = records
          .filter((record) =>
            /BrowserPageGotoEvent|BrowserPageDOMSummaryEvent/u.test(
              record.name,
            ),
          )
          .map((record) => record.name);
        this.options.warn?.(
          `v4 trace debug full=${Boolean(options.full)} event_count=${snapshot.event_count} records=${records.length} matching=${JSON.stringify(matchingRecords)}`,
        );
      }
      for (const record of records) await this.options.onRecord(record);
    } catch (error) {
      if (options.warnOnError) {
        this.options.warn?.(
          `Unable to read v4 event bus trace: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}

function recordsFromBusSnapshot(
  snapshot: StagehandV4BusSnapshot,
  fallbackBusName: string,
): { busName: string; records: StagehandV4BusRecord[] } {
  const bus = recordValue(snapshot.json);
  const busName =
    typeof bus?.name === "string" && bus.name.length > 0
      ? bus.name
      : fallbackBusName;
  const events = recordValue(bus?.event_history);
  if (events == null) return { busName, records: [] };
  return {
    busName,
    records: recordsFromBusEvents(Object.values(events), busName),
  };
}

function recordsFromBusEvents(
  events: unknown[],
  busName: string,
): StagehandV4BusRecord[] {
  const records: StagehandV4BusRecord[] = [];
  for (const event of events.filter(isRecord).sort(compareBusEvents)) {
    const eventId = stringValue(event, "event_id");
    const eventType = stringValue(event, "event_type");
    if (eventId == null || eventType == null) continue;
    const method = stringValue(event, "method");
    const emittedByHandlerId = stringValue(
      event,
      "event_emitted_by_handler_id",
    );
    const parentEventId = stringValue(event, "event_parent_id");
    const parentSpanId =
      emittedByHandlerId != null && parentEventId != null
        ? handlerRecordId(parentEventId, emittedByHandlerId)
        : parentEventId != null && parentEventId !== eventId
          ? parentEventId
          : undefined;
    records.push({
      spanId: eventId,
      ...(parentSpanId == null ? {} : { parentSpanId }),
      name: `${busName}.emit(${busEventLabel(eventType, method)})`,
      startTime:
        stringValue(event, "event_started_at") ??
        stringValue(event, "event_created_at"),
      endTime: stringValue(event, "event_completed_at"),
      attributes: busEventAttributes(event, busName),
    });

    const eventResults = recordValue(event.event_results);
    if (eventResults == null) continue;
    for (const [handlerId, result] of Object.entries(eventResults)) {
      const handler = recordValue(result);
      if (handler == null) continue;
      records.push({
        spanId: handlerRecordId(eventId, handlerId),
        parentSpanId: eventId,
        name: `${stringValue(handler, "handler_name") ?? handlerId}(${busEventLabel(eventType, method)})`,
        startTime: stringValue(handler, "started_at"),
        endTime: stringValue(handler, "completed_at"),
        attributes: busHandlerAttributes(handler),
        result: handler.result,
        error: handler.error == null ? undefined : String(handler.error),
      });
    }
  }
  return records;
}

function busEventLabel(eventType: string, method: string | undefined): string {
  return method == null ? eventType : `${eventType}(${method})`;
}

function handlerRecordId(eventId: string, handlerId: string): string {
  return `${eventId}:${handlerId}`;
}

function busEventAttributes(
  event: Record<string, unknown>,
  busName: string,
): Record<string, unknown> {
  return compactAttributes({
    "abxbus.event_bus.name": busName,
    ...Object.fromEntries(
      Object.entries(event).filter(
        ([key]) => !key.startsWith("event_") && key !== "event_results",
      ),
    ),
  });
}

function busHandlerAttributes(
  handler: Record<string, unknown>,
): Record<string, unknown> {
  return compactAttributes(
    Object.fromEntries(
      Object.entries(handler).filter(
        ([key]) =>
          key !== "result" && key !== "error" && key !== "event_children",
      ),
    ),
  );
}

function compareBusEvents(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): number {
  return String(left.event_created_at ?? "").localeCompare(
    String(right.event_created_at ?? ""),
  );
}

function compactAttributes(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, unknown] =>
        entry[1] !== undefined && typeof entry[1] !== "function",
    ),
  );
}

function stringValue(value: unknown, key: string): string | undefined {
  const entry = recordValue(value)?.[key];
  return typeof entry === "string" && entry.length > 0 ? entry : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return recordValue(value) != null;
}
