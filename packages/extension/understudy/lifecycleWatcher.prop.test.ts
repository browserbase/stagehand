import type { Protocol } from "devtools-protocol";
import type { LoadState } from "@browserbasehq/stagehand-protocol/types";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeoutError } from "../errors.js";
import { DEFAULT_IDLE_WAIT, IGNORED_RESOURCE_TYPES } from "../types/private/network.js";
import type { CDPSessionLike } from "./cdp.js";
import { LifecycleWatcher } from "./lifecycleWatcher.js";
import { NetworkManager } from "./networkManager.js";
import type { Page } from "./page.js";

class MockSession implements CDPSessionLike {
  readonly id = "main";
  readonly handlers = new Map<string, Set<(event: unknown) => void>>();

  async send<R = unknown>(): Promise<R> {
    return {} as R;
  }

  on<P = unknown>(event: string, handler: (params: P) => void): void {
    const set = this.handlers.get(event) ?? new Set<(event: unknown) => void>();
    set.add(handler as (event: unknown) => void);
    this.handlers.set(event, set);
  }

  off<P = unknown>(event: string, handler: (params: P) => void): void {
    this.handlers.get(event)?.delete(handler as (event: unknown) => void);
  }

  emit(event: string, payload: unknown): void {
    const snapshot = [...(this.handlers.get(event) ?? [])];
    for (const handler of snapshot) {
      handler(payload);
    }
  }

  listenerCount(): number {
    let total = 0;
    for (const set of this.handlers.values()) total += set.size;
    return total;
  }

  async close(): Promise<void> {}
}

type PendingLoadWait = {
  state: LoadState;
  resolve: () => void;
  reject: (error: Error) => void;
  settled: boolean;
  timer: ReturnType<typeof setTimeout>;
};

class MockLifecyclePage {
  latestCommandId = 1;
  currentMainFrameId = "main-frame";
  readonly registry: {
    frames: Map<string, { lastSeen?: { id: string; loaderId?: string } }>;
  };
  readonly pendingLoadWaits: PendingLoadWait[] = [];

  constructor(initialLoaderId?: string) {
    this.registry = {
      frames: new Map(
        initialLoaderId
          ? [
              [
                this.currentMainFrameId,
                { lastSeen: { id: this.currentMainFrameId, loaderId: initialLoaderId } },
              ],
            ]
          : [],
      ),
    };
  }

  mainFrameId(): string {
    return this.currentMainFrameId;
  }

  isCurrentNavigationCommand(id: number): boolean {
    return this.latestCommandId === id;
  }

  waitForMainLoadState(state: LoadState, timeout: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const entry: PendingLoadWait = {
        state,
        settled: false,
        resolve: () => {
          if (entry.settled) return;
          entry.settled = true;
          clearTimeout(entry.timer);
          resolve();
        },
        reject: (error: Error) => {
          if (entry.settled) return;
          entry.settled = true;
          clearTimeout(entry.timer);
          reject(error);
        },
        timer: setTimeout(
          () => {
            entry.reject(new TimeoutError(`waitForMainLoadState(${state})`, timeout));
          },
          Math.max(0, timeout),
        ),
      };
      this.pendingLoadWaits.push(entry);
    });
  }

  fireLoadState(state: "domcontentloaded" | "load"): boolean {
    let fired = false;
    for (const entry of this.pendingLoadWaits) {
      if (!entry.settled && entry.state === state) {
        entry.resolve();
        fired = true;
      }
    }
    return fired;
  }

  clearPendingTimers(): void {
    for (const entry of this.pendingLoadWaits) {
      clearTimeout(entry.timer);
      entry.settled = true;
    }
    this.pendingLoadWaits.length = 0;
  }
}

type WatcherCommand =
  | { kind: "frameNavigated"; frameId: string; loaderId: string }
  | { kind: "navigatedWithinDocument"; frameId: string }
  | { kind: "frameDetached"; frameId: string; reason: "remove" | "swap" }
  | { kind: "supersede" }
  | { kind: "fireLoadState"; state: "domcontentloaded" | "load" }
  | {
      kind: "requestStart";
      requestId: string;
      loaderId: string | undefined;
      frameId: string;
      resourceType: Protocol.Network.ResourceType;
    }
  | { kind: "requestFinish"; requestId: string }
  | { kind: "requestFail"; requestId: string }
  | { kind: "advance"; ms: number }
  | { kind: "dispose" };

const frameIdArb = fc.constantFrom("main-frame", "sub-frame");
const loaderIdArb = fc.constantFrom("loader-1", "loader-2", "loader-3");
const optionalLoaderIdArb = fc.constantFrom<string | undefined>("loader-1", "loader-2", undefined);
const requestIdArb = fc.constantFrom("r1", "r2", "r3");
const resourceTypeArb = fc.constantFrom<Protocol.Network.ResourceType>(
  "XHR",
  "Fetch",
  "Script",
  "WebSocket",
  "EventSource",
);

const watcherCommandArb: fc.Arbitrary<WatcherCommand> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant("frameNavigated" as const),
      frameId: frameIdArb,
      loaderId: loaderIdArb,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("navigatedWithinDocument" as const),
      frameId: frameIdArb,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("frameDetached" as const),
      frameId: frameIdArb,
      reason: fc.constantFrom("remove" as const, "swap" as const),
    }),
  },
  { weight: 1, arbitrary: fc.constant<WatcherCommand>({ kind: "supersede" }) },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant("fireLoadState" as const),
      state: fc.constantFrom("domcontentloaded" as const, "load" as const),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant("requestStart" as const),
      requestId: requestIdArb,
      loaderId: optionalLoaderIdArb,
      frameId: frameIdArb,
      resourceType: resourceTypeArb,
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant("requestFinish" as const),
      requestId: requestIdArb,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("requestFail" as const),
      requestId: requestIdArb,
    }),
  },
  {
    weight: 5,
    arbitrary: fc.record({
      kind: fc.constant("advance" as const),
      ms: fc.integer({ min: 1, max: 300 }),
    }),
  },
  { weight: 1, arbitrary: fc.constant<WatcherCommand>({ kind: "dispose" }) },
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

describe("LifecycleWatcher stateful properties", () => {
  it("respects load-state ordering, networkidle debounce, abort/dispose settlement, and zero timer/listener leaks", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<LoadState>("domcontentloaded", "load", "networkidle"),
        fc.boolean(),
        fc.option(fc.constantFrom("loader-1", "loader-2"), { nil: undefined }),
        fc.array(watcherCommandArb, { minLength: 1, maxLength: 35 }),
        async (waitUntil, isPassive, initialLoaderId, commands) => {
          vi.useFakeTimers();
          vi.setSystemTime(10_000);

          const session = new MockSession();
          const page = new MockLifecyclePage(isPassive ? initialLoaderId : undefined);
          const manager = new NetworkManager(page as unknown as Page);
          manager.trackSession(session);
          const baseSessionListeners = session.listenerCount();

          const watcher = new LifecycleWatcher({
            page: page as unknown as Page,
            mainSession: session,
            networkManager: manager,
            waitUntil,
            timeout: 3_000,
            ...(isPassive ? {} : { navigationCommandId: 1 }),
          });

          const outcomeBox: {
            current:
              | { status: "pending" }
              | { status: "resolved" }
              | { status: "rejected"; error: unknown };
          } = { current: { status: "pending" } };
          const waitPromise = watcher.wait().then(
            () => {
              outcomeBox.current = { status: "resolved" };
            },
            (error: unknown) => {
              outcomeBox.current = { status: "rejected", error };
            },
          );

          let dclFired = false;
          let loadFired = false;
          let sameDocFired = false;
          let aborted = false;

          try {
            for (const cmd of commands) {
              if (outcomeBox.current.status !== "pending") break;

              switch (cmd.kind) {
                case "frameNavigated": {
                  if (cmd.frameId === "main-frame" && !isPassive && page.latestCommandId !== 1) {
                    aborted = true;
                  }
                  session.emit("Page.frameNavigated", {
                    frame: { id: cmd.frameId, loaderId: cmd.loaderId },
                  });
                  break;
                }
                case "navigatedWithinDocument": {
                  if (cmd.frameId === "main-frame") {
                    if (!isPassive && page.latestCommandId !== 1) {
                      aborted = true;
                    } else if (!watcher.navigationStarted) {
                      sameDocFired = true;
                    }
                  }
                  session.emit("Page.navigatedWithinDocument", {
                    frameId: cmd.frameId,
                    url: "https://example.test/#hash",
                  });
                  break;
                }
                case "frameDetached": {
                  if (cmd.frameId === "main-frame" && cmd.reason !== "swap") {
                    aborted = true;
                  }
                  session.emit("Page.frameDetached", {
                    frameId: cmd.frameId,
                    reason: cmd.reason,
                  });
                  break;
                }
                case "supersede": {
                  page.latestCommandId += 1;
                  break;
                }
                case "fireLoadState": {
                  const didFire = page.fireLoadState(cmd.state);
                  if (didFire) {
                    if (cmd.state === "domcontentloaded") dclFired = true;
                    if (cmd.state === "load") loadFired = true;
                  }
                  break;
                }
                case "requestStart": {
                  session.emit("Network.requestWillBeSent", {
                    requestId: cmd.requestId,
                    frameId: cmd.frameId,
                    loaderId: cmd.loaderId,
                    type: cmd.resourceType,
                    request: { url: `https://example.test/${cmd.requestId}` },
                  });
                  break;
                }
                case "requestFinish": {
                  session.emit("Network.loadingFinished", { requestId: cmd.requestId });
                  break;
                }
                case "requestFail": {
                  session.emit("Network.loadingFailed", {
                    requestId: cmd.requestId,
                    errorText: "net::ERR_FAILED",
                  });
                  break;
                }
                case "advance": {
                  await vi.advanceTimersByTimeAsync(cmd.ms);
                  break;
                }
                case "dispose": {
                  watcher.dispose();
                  break;
                }
                default: {
                  const exhaustive: never = cmd;
                  throw new Error(`Unhandled watcher command: ${String(exhaustive)}`);
                }
              }

              await Promise.resolve();
              await Promise.resolve();
            }

            if (outcomeBox.current.status === "pending") {
              watcher.dispose();
              await waitPromise;
            }

            if (outcomeBox.current.status === "resolved") {
              expect(aborted).toBe(false);
              if (!sameDocFired) {
                if (waitUntil === "domcontentloaded") expect(dclFired).toBe(true);
                if (waitUntil === "load" || waitUntil === "networkidle") {
                  expect(loadFired).toBe(true);
                }
              }
            }

            expect(watcher.disposed).toBe(true);
            expect(session.listenerCount()).toBe(baseSessionListeners);
          } finally {
            watcher.dispose();
            await waitPromise;
            page.clearPendingTimers();
            manager.dispose();
            expect(session.listenerCount()).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
          }
        },
      ),
      { seed: 0x4c570001, numRuns: 150 },
    );
  });

  it("enforces exact 500ms networkidle quiet-window debounce across overlapping requests and redirects", async () => {
    type RequestOp = {
      requestId: string;
      startDelayMs: number;
      durationMs: number;
      matchesLoader: boolean;
      ignoredType: boolean;
      fail: boolean;
    };

    const requestOpArb: fc.Arbitrary<RequestOp> = fc.record({
      requestId: fc.constantFrom("r1", "r2", "r3", "r4"),
      startDelayMs: fc.integer({ min: 0, max: 450 }),
      durationMs: fc.integer({ min: 10, max: 400 }),
      matchesLoader: fc.boolean(),
      ignoredType: fc.boolean(),
      fail: fc.boolean(),
    });

    await fc.assert(
      fc.asyncProperty(fc.array(requestOpArb, { minLength: 1, maxLength: 6 }), async (ops) => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);

        const session = new MockSession();
        const page = new MockLifecyclePage("loader-main");
        const manager = new NetworkManager(page as unknown as Page);
        manager.trackSession(session);

        const watcher = new LifecycleWatcher({
          page: page as unknown as Page,
          mainSession: session,
          networkManager: manager,
          waitUntil: "networkidle",
          timeout: 15_000,
          navigationCommandId: 1,
        });
        watcher.setExpectedLoaderId("loader-main");

        let settled = false;
        let rejectedError: unknown = null;
        const waitPromise = watcher.wait().then(
          () => {
            settled = true;
          },
          (err: unknown) => {
            rejectedError = err;
          },
        );

        session.emit("Page.frameNavigated", {
          frame: { id: "main-frame", loaderId: "loader-main" },
        });
        for (let i = 0; i < 6 && page.pendingLoadWaits.length === 0; i += 1) {
          await Promise.resolve();
        }
        expect(page.fireLoadState("load")).toBe(true);
        for (let i = 0; i < 6 && !watcher.idleHandle; i += 1) {
          await Promise.resolve();
        }
        expect(watcher.idleHandle).not.toBeNull();

        const activeRelevant = new Set<string>();
        let now = 0;
        let quietSince: number | null = 0;

        try {
          const timeline: Array<{ at: number; kind: "start" | "end"; op: RequestOp; key: string }> =
            [];
          ops.forEach((op, idx) => {
            const key = `${op.requestId}-${idx}`;
            const startAt = op.startDelayMs;
            timeline.push({ at: startAt, kind: "start", op, key });
            timeline.push({ at: startAt + op.durationMs, kind: "end", op, key });
          });
          timeline.sort((a, b) => a.at - b.at || (a.kind === "start" ? -1 : 1));

          for (const step of timeline) {
            const delta = step.at - now;
            if (delta > 0) {
              await vi.advanceTimersByTimeAsync(delta);
              now = step.at;
            }
            if (settled) {
              expect(activeRelevant.size).toBe(0);
              expect(quietSince).not.toBeNull();
              expect(now - quietSince!).toBeGreaterThanOrEqual(DEFAULT_IDLE_WAIT);
              break;
            }

            const resourceType: Protocol.Network.ResourceType = step.op.ignoredType
              ? "WebSocket"
              : "XHR";
            const isRelevant = step.op.matchesLoader && !IGNORED_RESOURCE_TYPES.has(resourceType);

            if (step.kind === "start") {
              session.emit("Network.requestWillBeSent", {
                requestId: step.key,
                frameId: "main-frame",
                loaderId: step.op.matchesLoader ? "loader-main" : "other-loader",
                type: resourceType,
                request: { url: `https://example.test/${step.key}` },
              });
              if (isRelevant) {
                activeRelevant.add(step.key);
                quietSince = null;
              }
            } else {
              session.emit(step.op.fail ? "Network.loadingFailed" : "Network.loadingFinished", {
                requestId: step.key,
                errorText: "net::ERR_FAILED",
              });
              if (isRelevant && activeRelevant.delete(step.key) && activeRelevant.size === 0) {
                quietSince = now;
              }
            }

            await Promise.resolve();
            if (activeRelevant.size > 0) {
              expect(settled).toBe(false);
            }
          }

          if (!settled) {
            expect(activeRelevant.size).toBe(0);
            expect(quietSince).not.toBeNull();
            const remainingQuiet = DEFAULT_IDLE_WAIT - (now - quietSince!);
            expect(remainingQuiet).toBeGreaterThan(0);
            await vi.advanceTimersByTimeAsync(remainingQuiet - 1);
            expect(settled).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            expect(settled).toBe(true);
          }

          expect(rejectedError).toBeNull();
          await waitPromise;
          expect(vi.getTimerCount()).toBe(0);
        } finally {
          watcher.dispose();
          await waitPromise;
          page.clearPendingTimers();
          manager.dispose();
          expect(session.listenerCount()).toBe(0);
          expect(vi.getTimerCount()).toBe(0);
        }
      }),
      { seed: 0x4c570002, numRuns: 120 },
    );
  });

  it("handles abort or dispose before wait() without unhandled rejections, false resolutions, or timer leaks", async () => {
    type PreWaitEvent =
      | "detach"
      | "supersede-nav"
      | "supersede-same-doc"
      | "same-doc-then-detach"
      | "dispose";

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<LoadState>("domcontentloaded", "load", "networkidle"),
        fc.constantFrom<PreWaitEvent>(
          "detach",
          "supersede-nav",
          "supersede-same-doc",
          "same-doc-then-detach",
          "dispose",
        ),
        async (waitUntil, preEvent) => {
          vi.useFakeTimers();
          vi.setSystemTime(1_000);

          const session = new MockSession();
          const page = new MockLifecyclePage();
          const manager = new NetworkManager(page as unknown as Page);
          manager.trackSession(session);

          const watcher = new LifecycleWatcher({
            page: page as unknown as Page,
            mainSession: session,
            networkManager: manager,
            waitUntil,
            timeout: 5_000,
            navigationCommandId: 1,
          });

          try {
            switch (preEvent) {
              case "detach":
                session.emit("Page.frameDetached", { frameId: "main-frame", reason: "remove" });
                break;
              case "supersede-nav":
                page.latestCommandId = 2;
                session.emit("Page.frameNavigated", {
                  frame: { id: "main-frame", loaderId: "loader-2" },
                });
                break;
              case "supersede-same-doc":
                page.latestCommandId = 2;
                session.emit("Page.navigatedWithinDocument", {
                  frameId: "main-frame",
                  url: "https://example.test/#x",
                });
                break;
              case "same-doc-then-detach":
                session.emit("Page.navigatedWithinDocument", {
                  frameId: "main-frame",
                  url: "https://example.test/#x",
                });
                session.emit("Page.frameDetached", { frameId: "main-frame", reason: "remove" });
                break;
              case "dispose":
                watcher.dispose();
                break;
              default: {
                const exhaustive: never = preEvent;
                throw new Error(`Unhandled preWait event: ${String(exhaustive)}`);
              }
            }

            await Promise.resolve();
            await expect(watcher.wait()).rejects.toThrow();
            expect(page.pendingLoadWaits).toHaveLength(0);
            expect(vi.getTimerCount()).toBe(0);
          } finally {
            watcher.dispose();
            page.clearPendingTimers();
            manager.dispose();
            expect(session.listenerCount()).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
          }
        },
      ),
      { seed: 0x4c570003, numRuns: 50 },
    );
  });

  it("restarts load and networkidle waits across follow-up navigations within the shared deadline", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 50, max: 400 }),
        fc.boolean(),
        async (followupCount, delayBeforeFollowupMs, exceedBudget) => {
          vi.useFakeTimers();
          vi.setSystemTime(1_000);

          const session = new MockSession();
          const page = new MockLifecyclePage();
          const manager = new NetworkManager(page as unknown as Page);
          manager.trackSession(session);

          const timeout = exceedBudget ? delayBeforeFollowupMs * followupCount + 100 : 10_000;
          const watcher = new LifecycleWatcher({
            page: page as unknown as Page,
            mainSession: session,
            networkManager: manager,
            waitUntil: "networkidle",
            timeout,
            navigationCommandId: 1,
          });
          watcher.setExpectedLoaderId("loader-0");

          let status: "pending" | "resolved" | "rejected" = "pending";
          let caughtError: unknown = null;
          const waitPromise = watcher.wait().then(
            () => {
              status = "resolved";
            },
            (err: unknown) => {
              status = "rejected";
              caughtError = err;
            },
          );

          try {
            session.emit("Page.frameNavigated", {
              frame: { id: "main-frame", loaderId: "loader-0" },
            });
            for (let hop = 0; hop <= followupCount; hop += 1) {
              for (let i = 0; i < 6 && page.pendingLoadWaits.every((w) => w.settled); i += 1) {
                await Promise.resolve();
              }
              if (status !== "pending") break;
              page.fireLoadState("load");
              for (let i = 0; i < 6 && !watcher.idleHandle && status === "pending"; i += 1) {
                await Promise.resolve();
              }
              if (status !== "pending") break;

              if (hop < followupCount) {
                await vi.advanceTimersByTimeAsync(delayBeforeFollowupMs);
                if (status !== "pending") break;
                expect(status).toBe("pending");
                session.emit("Page.frameNavigated", {
                  frame: { id: "main-frame", loaderId: `loader-${hop + 1}` },
                });
                await Promise.resolve();
              } else if (exceedBudget) {
                session.emit("Network.requestWillBeSent", {
                  requestId: "stuck-req",
                  frameId: "main-frame",
                  loaderId: `loader-${hop}`,
                  type: "XHR",
                  request: { url: "https://example.test/stuck" },
                });
                await vi.advanceTimersByTimeAsync(timeout);
              } else {
                await vi.advanceTimersByTimeAsync(DEFAULT_IDLE_WAIT - 1);
                expect(status).toBe("pending");
                await vi.advanceTimersByTimeAsync(1);
              }
            }

            await waitPromise;
            if (exceedBudget) {
              expect(status).toBe("rejected");
              expect(caughtError).toBeInstanceOf(TimeoutError);
            } else {
              expect(status).toBe("resolved");
            }
            expect(vi.getTimerCount()).toBe(0);
          } finally {
            watcher.dispose();
            await waitPromise;
            page.clearPendingTimers();
            manager.dispose();
            expect(session.listenerCount()).toBe(0);
            expect(vi.getTimerCount()).toBe(0);
          }
        },
      ),
      { seed: 0x4c570004, numRuns: 80 },
    );
  });
});
