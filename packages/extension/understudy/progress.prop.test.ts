import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeoutError } from "../errors.js";
import { Progress, runLocatorStep, runWithProgress } from "./progress.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const MAX_OP_TIMEOUT_MS = 150;
const MAX_DELAY_MS = 120;
const CLEANUP_TIMEOUT_MS = 1_000;
const SETTLE_DRAIN_MS = MAX_OP_TIMEOUT_MS + MAX_DELAY_MS + CLEANUP_TIMEOUT_MS + 100;
const LATE_CLEANUP_DRAIN_MS = CLEANUP_TIMEOUT_MS + 100;

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

type TokenValue = string | number | undefined | false;

type ScheduledOp =
  | { kind: "advance"; ms: number }
  | { kind: "startRun"; valueKind: "string" | "zero" | "undefined" | "false"; syncThrow: boolean }
  | { kind: "settleRun"; idx: number; outcome: "resolve" | "reject" }
  | { kind: "startDelay"; ms: number }
  | { kind: "cleanup"; mode: "fast-resolve" | "fast-reject" | "sync-throw" | "hang" }
  | { kind: "dispose" };

type TrackedRun = {
  id: number;
  deferred: Deferred<TokenValue>;
  token: TokenValue;
  deliveredValue?: TokenValue;
  syncThrow: boolean;
  workStarted: boolean;
  settledInput: "pending" | "resolved" | "rejected";
  outcome: "pending" | "fulfilled" | "rejected";
  resolvedWhileAborted: boolean;
  lateResults: TokenValue[];
  promise: Promise<void>;
};

const opArb: fc.Arbitrary<ScheduledOp> = fc.oneof(
  fc.integer({ min: 0, max: 60 }).map((ms) => ({ kind: "advance" as const, ms })),
  fc
    .record({
      valueKind: fc.constantFrom<"string" | "zero" | "undefined" | "false">(
        "string",
        "zero",
        "undefined",
        "false",
      ),
      syncThrow: fc.boolean(),
    })
    .map((r) => ({ kind: "startRun" as const, ...r })),
  fc
    .record({
      idx: fc.integer({ min: 0, max: 8 }),
      outcome: fc.constantFrom<"resolve" | "reject">("resolve", "reject"),
    })
    .map((r) => ({ kind: "settleRun" as const, ...r })),
  fc.integer({ min: 0, max: MAX_DELAY_MS }).map((ms) => ({ kind: "startDelay" as const, ms })),
  fc
    .constantFrom<"fast-resolve" | "fast-reject" | "sync-throw" | "hang">(
      "fast-resolve",
      "fast-reject",
      "sync-throw",
      "hang",
    )
    .map((mode) => ({ kind: "cleanup" as const, mode })),
  fc.constant({ kind: "dispose" as const }),
);

function tokenFor(id: number, kind: "string" | "zero" | "undefined" | "false"): TokenValue {
  switch (kind) {
    case "string":
      return `token-${id}`;
    case "zero":
      return 0;
    case "undefined":
      return undefined;
    case "false":
      return false;
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unhandled token kind: ${String(_exhaustive)}`);
    }
  }
}

describe("Progress stateful properties", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
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

  it("never leaks fake timers, never resolves run() after abort, and invokes onLateResult exactly for abandoned resolutions", async () => {
    const scenarioArb = fc.record({
      timeout: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: MAX_OP_TIMEOUT_MS })),
      ops: fc.array(opArb, { minLength: 1, maxLength: 30 }),
    });

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ timeout, ops }) => {
        const progress = new Progress("prop.op", timeout);
        const runs: TrackedRun[] = [];
        const delays: Array<Promise<void>> = [];
        const cleanups: Array<Promise<void>> = [];
        let nextRunId = 0;

        for (const op of ops) {
          switch (op.kind) {
            case "advance": {
              await vi.advanceTimersByTimeAsync(op.ms);
              break;
            }
            case "startRun": {
              const id = nextRunId++;
              const deferred = createDeferred<TokenValue>();
              const token = tokenFor(id, op.valueKind);
              const tracked: TrackedRun = {
                id,
                deferred,
                token,
                syncThrow: op.syncThrow,
                workStarted: false,
                settledInput: "pending",
                outcome: "pending",
                resolvedWhileAborted: false,
                lateResults: [],
                promise: Promise.resolve(),
              };

              tracked.promise = progress
                .run(
                  `phase-${id}`,
                  () => {
                    tracked.workStarted = true;
                    if (op.syncThrow) {
                      tracked.settledInput = "rejected";
                      throw new Error(`sync-fail-${id}`);
                    }
                    return deferred.promise;
                  },
                  (lateValue) => {
                    tracked.lateResults.push(lateValue);
                  },
                )
                .then((delivered) => {
                  tracked.outcome = "fulfilled";
                  tracked.deliveredValue = delivered;
                  if (progress.signal.aborted) {
                    tracked.resolvedWhileAborted = true;
                  }
                })
                .catch(() => {
                  tracked.outcome = "rejected";
                });

              runs.push(tracked);
              await flushMicrotasks();
              break;
            }
            case "settleRun": {
              const pendingRuns = runs.filter((r) => r.settledInput === "pending" && !r.syncThrow);
              if (pendingRuns.length === 0) break;
              const target = pendingRuns[op.idx % pendingRuns.length]!;
              if (op.outcome === "resolve") {
                target.settledInput = "resolved";
                target.deferred.resolve(target.token);
              } else {
                target.settledInput = "rejected";
                target.deferred.reject(new Error(`async-fail-${target.id}`));
              }
              await flushMicrotasks();
              break;
            }
            case "startDelay": {
              const p = progress.delay(op.ms).catch(() => {});
              delays.push(p);
              await Promise.resolve();
              break;
            }
            case "cleanup": {
              let p: Promise<void>;
              switch (op.mode) {
                case "fast-resolve":
                  p = progress.cleanup(async () => {});
                  break;
                case "fast-reject":
                  p = progress.cleanup(() => Promise.reject(new Error("cleanup-reject")));
                  break;
                case "sync-throw":
                  p = progress.cleanup(() => {
                    throw new Error("cleanup-throw");
                  });
                  break;
                case "hang":
                  p = progress.cleanup(() => new Promise<void>(() => {}));
                  break;
                default: {
                  const _exhaustive: never = op.mode;
                  throw new Error(`Unhandled cleanup mode: ${String(_exhaustive)}`);
                }
              }
              cleanups.push(p);
              await Promise.resolve();
              break;
            }
            case "dispose": {
              progress.dispose();
              break;
            }
            default: {
              const _exhaustive: never = op;
              throw new Error(`Unhandled op: ${String(_exhaustive)}`);
            }
          }
        }

        for (const tracked of runs) {
          if (tracked.settledInput === "pending" && !tracked.syncThrow) {
            tracked.settledInput = "resolved";
            tracked.deferred.resolve(tracked.token);
          }
        }

        await vi.advanceTimersByTimeAsync(SETTLE_DRAIN_MS);
        progress.dispose();
        await Promise.all([...runs.map((r) => r.promise), ...delays, ...cleanups]);
        await vi.advanceTimersByTimeAsync(LATE_CLEANUP_DRAIN_MS);

        for (const tracked of runs) {
          expect(
            tracked.resolvedWhileAborted,
            `run #${tracked.id} resolved after signal.aborted`,
          ).toBe(false);

          if (tracked.outcome === "fulfilled") {
            expect(tracked.deliveredValue).toBe(tracked.token);
            expect(
              tracked.lateResults,
              `delivered run #${tracked.id} must not invoke onLateResult`,
            ).toHaveLength(0);
          } else if (
            tracked.outcome === "rejected" &&
            tracked.workStarted &&
            tracked.settledInput === "resolved"
          ) {
            expect(
              tracked.lateResults,
              `abandoned run #${tracked.id} whose work resolved must invoke onLateResult once`,
            ).toStrictEqual([tracked.token]);
          } else {
            expect(
              tracked.lateResults,
              `run #${tracked.id} without a resolved work result must not invoke onLateResult`,
            ).toHaveLength(0);
          }
        }

        expect(vi.getTimerCount()).toBe(0);
      }),
      { seed: 20261140, numRuns: 150 },
    );
  });

  it("handles late results arriving after clock jump (before deadline timer fires) and clears all timers", async () => {
    const scenarioArb = fc.record({
      timeout: fc.integer({ min: 5, max: 100 }),
      jumpOvershootMs: fc.integer({ min: 0, max: 50 }),
      resolveOrder: fc.constantFrom<"during-work" | "after-rejection">(
        "during-work",
        "after-rejection",
      ),
    });

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ timeout, jumpOvershootMs, resolveOrder }) => {
        const start = performance.now();
        const progress = new Progress("clock-jump.op", timeout);
        const lateResults: string[] = [];
        const gate = createDeferred<string>();
        let resolvedAfterAbort = false;

        const spy = vi.spyOn(performance, "now");
        const pending = progress
          .run(
            "clock-jump-phase",
            () => {
              if (resolveOrder === "during-work") {
                spy.mockReturnValue(start + timeout + jumpOvershootMs);
                return Promise.resolve("val-during");
              }
              return gate.promise;
            },
            (val) => {
              lateResults.push(val);
            },
          )
          .then((val) => {
            if (progress.signal.aborted) resolvedAfterAbort = true;
            return { ok: true as const, val };
          })
          .catch((error: unknown) => ({ ok: false as const, error }));

        if (resolveOrder === "after-rejection") {
          await vi.advanceTimersByTimeAsync(timeout);
        }

        const outcome = await pending;
        if (resolveOrder === "after-rejection") {
          gate.resolve("val-after");
          await vi.advanceTimersByTimeAsync(0);
        }

        spy.mockRestore();
        progress.dispose();
        await vi.advanceTimersByTimeAsync(1_100);

        expect(resolvedAfterAbort).toBe(false);
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
          expect(outcome.error).toBeInstanceOf(TimeoutError);
        }
        expect(progress.signal.aborted).toBe(true);
        expect(lateResults).toStrictEqual([
          resolveOrder === "during-work" ? "val-during" : "val-after",
        ]);
        expect(vi.getTimerCount()).toBe(0);
      }),
      { seed: 20261141, numRuns: 100 },
    );
  });

  it("runWithProgress always disposes owned timers and preserves parent timers across nested calls", async () => {
    const scenarioArb = fc.record({
      outerTimeout: fc.oneof(fc.constant(0), fc.integer({ min: 10, max: 120 })),
      nestedSteps: fc.array(
        fc.record({
          delayMs: fc.integer({ min: 0, max: 40 }),
          shouldThrow: fc.boolean(),
        }),
        { minLength: 1, maxLength: 6 },
      ),
    });

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ outerTimeout, nestedSteps }) => {
        const outcome = runWithProgress(
          { name: "outer", timeout: outerTimeout },
          async (progress) => {
            for (const step of nestedSteps) {
              await runWithProgress(progress, async (child) => {
                expect(child).toBe(progress);
                await child.delay(step.delayMs);
                if (step.shouldThrow) throw new Error("nested-error");
              }).catch((err: unknown) => {
                if (err instanceof TimeoutError) throw err;
              });
            }
            return "completed";
          },
        );

        const settled = outcome
          .then((val) => ({ ok: true as const, val }))
          .catch((error: unknown) => ({ ok: false as const, error }));

        const totalDelay = nestedSteps.reduce((acc, s) => acc + s.delayMs, 0);
        await vi.advanceTimersByTimeAsync(Math.max(outerTimeout, totalDelay) + 100);
        const result = await settled;

        if (outerTimeout === 0 || totalDelay < outerTimeout) {
          expect(result).toStrictEqual({ ok: true, val: "completed" });
        } else if (totalDelay > outerTimeout) {
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error).toBeInstanceOf(TimeoutError);
          }
        } else if (!result.ok) {
          expect(result.error).toBeInstanceOf(TimeoutError);
        }

        expect(vi.getTimerCount()).toBe(0);
      }),
      { seed: 20261142, numRuns: 100 },
    );
  });

  it("handles multi-interval deadlines (> MAX_TIMER_MS) and throwing/hanging onLateResult callbacks without leaking timers", async () => {
    const maxTimerMs = 2_147_483_647;
    const scenarioArb = fc.record({
      extraMs: fc.integer({ min: 1, max: 500 }),
      lateHandlerMode: fc.constantFrom<"resolve" | "reject" | "sync-throw" | "hang">(
        "resolve",
        "reject",
        "sync-throw",
        "hang",
      ),
      lateArrivalOffsetMs: fc.integer({ min: 0, max: 50 }),
    });

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ extraMs, lateHandlerMode, lateArrivalOffsetMs }) => {
        const timeout = maxTimerMs + extraMs;
        const progress = new Progress("long.op", timeout);
        const gate = createDeferred<string>();
        const lateSeen: string[] = [];

        const pending = progress
          .run(
            "long-phase",
            () => gate.promise,
            (val) => {
              lateSeen.push(val);
              switch (lateHandlerMode) {
                case "resolve":
                  return Promise.resolve();
                case "reject":
                  return Promise.reject(new Error("late-reject"));
                case "sync-throw":
                  throw new Error("late-sync-throw");
                case "hang":
                  return new Promise<void>(() => {});
                default: {
                  const _exhaustive: never = lateHandlerMode;
                  throw new Error(`Unhandled mode: ${String(_exhaustive)}`);
                }
              }
            },
          )
          .then((v) => ({ ok: true as const, v }))
          .catch((error: unknown) => ({ ok: false as const, error }));

        await vi.advanceTimersByTimeAsync(maxTimerMs);
        expect(progress.signal.aborted).toBe(false);
        expect(progress.remainingMs()).toBe(extraMs);

        await vi.advanceTimersByTimeAsync(extraMs);
        const outcome = await pending;
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) expect(outcome.error).toBeInstanceOf(TimeoutError);

        await vi.advanceTimersByTimeAsync(lateArrivalOffsetMs);
        gate.resolve("late-resource");
        await vi.advanceTimersByTimeAsync(1_050);

        expect(lateSeen).toStrictEqual(["late-resource"]);
        progress.dispose();
        expect(vi.getTimerCount()).toBe(0);
      }),
      { seed: 20261143, numRuns: 60 },
    );
  });

  it("runLocatorStep preserves late-result delivery and timer hygiene with or without Progress", async () => {
    const scenarioArb = fc.record({
      withProgress: fc.boolean(),
      timeout: fc.integer({ min: 10, max: 80 }),
      resolveAtMs: fc.integer({ min: 0, max: 120 }),
    });

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ withProgress, timeout, resolveAtMs }) => {
        const progress = withProgress ? new Progress("locator.step", timeout) : undefined;
        const gate = createDeferred<string>();
        const lateResults: string[] = [];

        const step = runLocatorStep(
          progress,
          "substep",
          () => gate.promise,
          (v) => {
            lateResults.push(v);
          },
        )
          .then((value) => ({
            ok: true as const,
            value,
            abortedAtResolve: progress?.signal.aborted ?? false,
          }))
          .catch((error: unknown) => ({ ok: false as const, error }));

        const timer = setTimeout(() => {
          gate.resolve("res");
        }, resolveAtMs);

        await vi.advanceTimersByTimeAsync(Math.max(timeout, resolveAtMs) + 1_100);
        clearTimeout(timer);
        const outcome = await step;
        progress?.dispose();

        if (!withProgress || resolveAtMs < timeout) {
          expect(outcome).toStrictEqual({ ok: true, value: "res", abortedAtResolve: false });
          expect(lateResults).toHaveLength(0);
        } else if (outcome.ok) {
          expect(outcome.abortedAtResolve).toBe(false);
          expect(lateResults).toHaveLength(0);
        } else {
          expect(outcome.error).toBeInstanceOf(TimeoutError);
          expect(lateResults).toStrictEqual(["res"]);
        }

        expect(vi.getTimerCount()).toBe(0);
      }),
      { seed: 20261144, numRuns: 100 },
    );
  });
});
