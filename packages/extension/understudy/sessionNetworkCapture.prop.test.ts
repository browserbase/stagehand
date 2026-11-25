import type { Protocol } from "devtools-protocol";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "./cdp.js";
import { SessionNetworkCapture, type SessionNetworkHandlers } from "./sessionNetworkCapture.js";

type CaptureEventName = keyof SessionNetworkHandlers;

const CAPTURE_EVENT_NAMES: readonly CaptureEventName[] = [
  "Network.requestWillBeSent",
  "Network.loadingFinished",
  "Network.loadingFailed",
  "Network.requestServedFromCache",
  "Network.responseReceived",
  "Page.frameStoppedLoading",
  "Page.frameNavigated",
];

type RecordedDelivery = {
  name: CaptureEventName;
  seq: number;
  receivedAt: number;
};

type ReentrantPlan =
  | { kind: "none" }
  | { kind: "emit"; name: CaptureEventName }
  | { kind: "dispose" }
  | { kind: "throw" };

type CaptureCommand =
  | { kind: "emit"; name: CaptureEventName; advanceMs: number; reentrant: ReentrantPlan }
  | { kind: "attach" }
  | { kind: "dispose" }
  | { kind: "advance"; ms: number };

class FakeSession implements CDPSessionLike {
  readonly id = "capture-session";
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  async send<R = unknown>(): Promise<R> {
    return {} as R;
  }

  on<P = unknown>(event: string, handler: (params: P) => void): void {
    const set = this.listeners.get(event) ?? new Set<(event: unknown) => void>();
    set.add(handler as (event: unknown) => void);
    this.listeners.set(event, set);
  }

  off<P = unknown>(event: string, handler: (params: P) => void): void {
    this.listeners.get(event)?.delete(handler as (event: unknown) => void);
  }

  emit(event: string, payload: unknown): void {
    const snapshot = [...(this.listeners.get(event) ?? [])];
    for (const handler of snapshot) {
      handler(payload);
    }
  }

  listenerCount(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  async close(): Promise<void> {}
}

type TaggedPayload = {
  seq: number;
  reentrant: ReentrantPlan;
};

const eventNameArb = fc.constantFrom<CaptureEventName>(...CAPTURE_EVENT_NAMES);

const reentrantPlanArb: fc.Arbitrary<ReentrantPlan> = fc.oneof(
  { weight: 6, arbitrary: fc.constant<ReentrantPlan>({ kind: "none" }) },
  {
    weight: 2,
    arbitrary: eventNameArb.map((name): ReentrantPlan => ({ kind: "emit", name })),
  },
  { weight: 1, arbitrary: fc.constant<ReentrantPlan>({ kind: "dispose" }) },
  { weight: 1, arbitrary: fc.constant<ReentrantPlan>({ kind: "throw" }) },
);

const commandArb: fc.Arbitrary<CaptureCommand> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant("emit" as const),
      name: eventNameArb,
      advanceMs: fc.integer({ min: 0, max: 50 }),
      reentrant: reentrantPlanArb,
    }),
  },
  { weight: 2, arbitrary: fc.constant<CaptureCommand>({ kind: "attach" }) },
  { weight: 2, arbitrary: fc.constant<CaptureCommand>({ kind: "dispose" }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("advance" as const),
      ms: fc.integer({ min: 1, max: 100 }),
    }),
  },
);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  try {
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});

describe("SessionNetworkCapture stateful properties", () => {
  it("preserves FIFO order, arrival timestamps, listener isolation, and disposal invariants", () => {
    fc.assert(
      fc.property(fc.array(commandArb, { minLength: 1, maxLength: 40 }), (commands) => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);

        const session = new FakeSession();
        let unrelatedCount = 0;
        const unrelatedHandler = () => {
          unrelatedCount += 1;
        };
        session.on("Network.requestWillBeSent", unrelatedHandler);

        const capture = new SessionNetworkCapture(session);
        expect(session.listenerCount()).toBe(CAPTURE_EVENT_NAMES.length + 1);

        let attached = false;
        let disposed = false;
        let nextSeq = 1;
        let expectedUnrelated = 0;
        const modelQueue: Array<{
          name: CaptureEventName;
          seq: number;
          receivedAt: number;
          reentrant: ReentrantPlan;
        }> = [];
        const expectedDeliveries: RecordedDelivery[] = [];
        const actualDeliveries: RecordedDelivery[] = [];

        const enqueueModel = (
          name: CaptureEventName,
          seq: number,
          receivedAt: number,
          reentrant: ReentrantPlan,
        ) => {
          if (disposed) return;
          modelQueue.push({ name, seq, receivedAt, reentrant });
        };

        const drainModel = (): boolean => {
          let threw = false;
          while (!disposed && modelQueue.length > 0) {
            const next = modelQueue.shift()!;
            expectedDeliveries.push({
              name: next.name,
              seq: next.seq,
              receivedAt: next.receivedAt,
            });
            switch (next.reentrant.kind) {
              case "none":
                break;
              case "emit": {
                const reSeq = nextSeq++;
                const reName = next.reentrant.name;
                if (reName === "Network.requestWillBeSent") expectedUnrelated += 1;
                enqueueModel(reName, reSeq, Date.now(), { kind: "none" });
                break;
              }
              case "dispose":
                disposed = true;
                modelQueue.length = 0;
                break;
              case "throw":
                threw = true;
                return threw;
              default: {
                const exhaustive: never = next.reentrant;
                throw new Error(`Unhandled reentrant plan: ${String(exhaustive)}`);
              }
            }
          }
          return threw;
        };

        let reentrantSeqBase = 0;
        const makeHandlers = (): SessionNetworkHandlers => {
          const handle = (name: CaptureEventName) => (event: unknown, receivedAt: number) => {
            const payload = event as TaggedPayload;
            actualDeliveries.push({ name, seq: payload.seq, receivedAt });
            switch (payload.reentrant.kind) {
              case "none":
                break;
              case "emit": {
                const reSeq = reentrantSeqBase++;
                session.emit(payload.reentrant.name, {
                  seq: reSeq,
                  reentrant: { kind: "none" },
                } satisfies TaggedPayload);
                break;
              }
              case "dispose":
                capture.dispose();
                break;
              case "throw":
                throw new Error(`consumer boom ${payload.seq}`);
              default: {
                const exhaustive: never = payload.reentrant;
                throw new Error(`Unhandled reentrant plan: ${String(exhaustive)}`);
              }
            }
          };

          return {
            "Network.requestWillBeSent": handle("Network.requestWillBeSent"),
            "Network.loadingFinished": handle("Network.loadingFinished"),
            "Network.loadingFailed": handle("Network.loadingFailed"),
            "Network.requestServedFromCache": handle("Network.requestServedFromCache"),
            "Network.responseReceived": handle("Network.responseReceived"),
            "Page.frameStoppedLoading": handle("Page.frameStoppedLoading"),
            "Page.frameNavigated": handle("Page.frameNavigated"),
          };
        };

        for (const cmd of commands) {
          switch (cmd.kind) {
            case "advance": {
              vi.advanceTimersByTime(cmd.ms);
              break;
            }
            case "emit": {
              vi.advanceTimersByTime(cmd.advanceMs);
              const seq = nextSeq++;
              reentrantSeqBase = nextSeq;
              if (cmd.name === "Network.requestWillBeSent") expectedUnrelated += 1;
              enqueueModel(cmd.name, seq, Date.now(), cmd.reentrant);
              let modelThrew = false;
              if (attached && !disposed) {
                modelThrew = drainModel();
              }
              let actualThrew = false;
              try {
                session.emit(cmd.name, {
                  seq,
                  reentrant: cmd.reentrant,
                } satisfies TaggedPayload);
              } catch {
                actualThrew = true;
              }
              expect(actualThrew).toBe(modelThrew);
              break;
            }
            case "attach": {
              reentrantSeqBase = nextSeq;
              if (disposed) {
                expect(() => capture.attach(makeHandlers())).toThrow("disposed");
              } else if (attached) {
                expect(() => capture.attach(makeHandlers())).toThrow("already has a consumer");
              } else {
                attached = true;
                const modelThrew = drainModel();
                let actualThrew = false;
                try {
                  capture.attach(makeHandlers());
                } catch {
                  actualThrew = true;
                }
                expect(actualThrew).toBe(modelThrew);
              }
              break;
            }
            case "dispose": {
              disposed = true;
              modelQueue.length = 0;
              capture.dispose();
              break;
            }
            default: {
              const exhaustive: never = cmd;
              throw new Error(`Unhandled command: ${String(exhaustive)}`);
            }
          }

          expect(actualDeliveries).toEqual(expectedDeliveries);
          expect(unrelatedCount).toBe(expectedUnrelated);
          expect(session.listenerCount()).toBe(disposed ? 1 : CAPTURE_EVENT_NAMES.length + 1);
        }

        capture.dispose();
        expect(session.listenerCount()).toBe(1);
        session.off("Network.requestWillBeSent", unrelatedHandler);
        expect(session.listenerCount()).toBe(0);
      }),
      { seed: 0x51a9e2b1, numRuns: 150 },
    );
  });

  it("rolls back all installed listeners when session.on throws at any registration index", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: CAPTURE_EVENT_NAMES.length - 1 }), (failAtIndex) => {
        const session = new FakeSession();
        const unrelated = () => {};
        session.on("Page.frameNavigated", unrelated);
        const realOn = session.on.bind(session);
        let calls = 0;
        vi.spyOn(session, "on").mockImplementation((event, handler) => {
          if (calls++ === failAtIndex) {
            throw new Error(`registration failed at ${failAtIndex}`);
          }
          realOn(event, handler);
        });

        expect(() => new SessionNetworkCapture(session)).toThrow(
          `registration failed at ${failAtIndex}`,
        );
        expect(session.listenerCount()).toBe(1);
        session.off("Page.frameNavigated", unrelated);
        expect(session.listenerCount()).toBe(0);
      }),
      { seed: 0x51a9e2b2, numRuns: 50 },
    );
  });

  it("delivers remaining queued events even if a prior handler throws without disposing", () => {
    const session = new FakeSession();
    const capture = new SessionNetworkCapture(session);
    const seen: string[] = [];

    session.emit("Network.requestWillBeSent", {
      requestId: "r1",
    } as Protocol.Network.RequestWillBeSentEvent);
    session.emit("Network.loadingFinished", {
      requestId: "r1",
    } as Protocol.Network.LoadingFinishedEvent);

    let failFirst = true;
    expect(() =>
      capture.attach({
        "Network.requestWillBeSent": (e) => {
          seen.push(`start:${e.requestId}`);
          if (failFirst) {
            failFirst = false;
            throw new Error("handler error");
          }
        },
        "Network.loadingFinished": (e) => seen.push(`finish:${e.requestId}`),
        "Network.loadingFailed": (e) => seen.push(`fail:${e.requestId}`),
        "Network.requestServedFromCache": () => {},
        "Network.responseReceived": () => {},
        "Page.frameStoppedLoading": () => {},
        "Page.frameNavigated": () => {},
      }),
    ).toThrow("handler error");

    session.emit("Network.loadingFailed", {
      requestId: "r2",
    } as Protocol.Network.LoadingFailedEvent);
    expect(seen).toEqual(["start:r1", "finish:r1", "fail:r2"]);
    capture.dispose();
    expect(session.listenerCount()).toBe(0);
  });
});
