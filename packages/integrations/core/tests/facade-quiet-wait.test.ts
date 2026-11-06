import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RUN_PRELUDE, RUNTIME_SOURCE } from "../src/facade/batch-sources.js";
import { RUN_OPTIONS } from "../src/facade/contract.js";
import {
  createPlaywrightCompatRuntime,
  type PlaywrightCompatRuntimeOptions,
} from "../src/facade/runtime.js";

type CompatPage = { waitForTimeout(ms: number): Promise<void> };
/**
 * What the page reports on one poll of the quiet predicate: its state, a
 * navigation in progress (page.waitForFunction retries in the next document),
 * a predicate error (it rejects), or a wait that never settles.
 */
type Probe = { readyState: string; quietMs: number } | "navigating" | "error" | "hang";
type WaitOptions = { polling?: "raf" | number; timeout?: number };

const isCleanup = (expression: unknown) =>
  typeof expression === "string" && expression.includes("observer.disconnect()");
/** The document key a predicate or cleanup expression uses. */
const keyOf = (expression: unknown) => /const key = "([^"]+)"/.exec(String(expression))?.[1];

/**
 * A raw page whose page.waitForFunction polls `probe(now, key)` on the (fake)
 * clock the way the extension's does: every `polling` ms, through navigations,
 * until the predicate holds, it throws, or `timeout` passes. Its
 * waitForTimeout sleeps on the same clock.
 */
async function fixture(
  options: PlaywrightCompatRuntimeOptions,
  probe: (now: number, key: string) => Probe,
) {
  const rawPage = {
    pageId: "test-page",
    url: vi.fn(async () => "https://example.com/"),
    evaluate: vi.fn(async (expression: unknown) => {
      if (isCleanup(expression)) return undefined;
      return { width: 800, height: 600 };
    }),
    waitForFunction: vi.fn(
      (expression: string, _arg: undefined, waitOptions: WaitOptions = {}) =>
        new Promise<unknown>((resolve, reject) => {
          const key = keyOf(expression)!;
          const deadline = Date.now() + (waitOptions.timeout ?? 0);
          const interval = typeof waitOptions.polling === "number" ? waitOptions.polling : 16;
          const poll = () => {
            const answer = probe(Date.now(), key);
            if (answer === "hang") return;
            if (answer === "error") return reject(new Error("predicate failed"));
            if (
              answer !== "navigating" &&
              answer.readyState !== "loading" &&
              answer.quietMs >= RUN_OPTIONS.quietWait.windowMs
            ) {
              return resolve(true);
            }
            if (waitOptions.timeout && Date.now() >= deadline) {
              return reject(new Error("waitForFunction timed out"));
            }
            setTimeout(poll, interval);
          };
          poll();
        }),
    ),
    waitForTimeout: vi.fn((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
  };
  const rawContext = { pages: vi.fn(async () => [rawPage]) };
  // Exercise the same self-contained serialization boundary as callback batches.
  const create = new Function(
    `return (${createPlaywrightCompatRuntime.toString()})`,
  )() as typeof createPlaywrightCompatRuntime;
  const runtime = await create(
    { page: rawPage, context: rawContext } as unknown as Parameters<
      typeof createPlaywrightCompatRuntime
    >[0],
    options,
  );
  const waits = () => rawPage.waitForFunction.mock.calls;
  const cleanups = () =>
    rawPage.evaluate.mock.calls.filter(([expression]) => isCleanup(expression));
  return { page: runtime.page as CompatPage, rawPage, runtime, waits, cleanups };
}

/** Runs page.waitForTimeout(ms) on the fake clock and reports when it resolved. */
async function timedWait(page: CompatPage, ms: number, horizonMs = ms + 1_000) {
  const startedAt = Date.now();
  let resolvedAfter: number | undefined;
  const wait = page.waitForTimeout(ms).then(() => {
    resolvedAfter = Date.now() - startedAt;
  });
  await vi.advanceTimersByTimeAsync(horizonMs);
  await wait;
  return resolvedAfter!;
}

describe("facade page.waitForTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sleeps exactly the requested time when quietWait is off", async () => {
    const { page, rawPage, runtime, waits } = await fixture({}, () => ({
      readyState: "complete",
      quietMs: 10_000,
    }));
    expect(await timedWait(page, 5_000)).toBe(5_000);
    expect(rawPage.waitForTimeout.mock.calls).toStrictEqual([[5_000]]);
    expect(waits()).toHaveLength(0);
    expect(runtime.telemetry().calls["page.waitForTimeout"]).toBe(1);
    expect(runtime.telemetry().waits).toStrictEqual({
      count: 1,
      requestedMs: 5_000,
      waitedMs: 5_000,
      earlyReturns: 0,
    });
  });

  it("passes non-numeric waits through unchanged when off", async () => {
    const { page, rawPage, runtime } = await fixture({ quietWait: false }, () => "error");
    await timedWait(page, Number.NaN, 10);
    expect(rawPage.waitForTimeout.mock.calls).toStrictEqual([[Number.NaN]]);
    expect(runtime.telemetry().waits).toStrictEqual({
      count: 1,
      requestedMs: 0,
      waitedMs: 0,
      earlyReturns: 0,
    });
  });

  it("returns once the page has been quiet for the window", async () => {
    // The probe installs its observer on the first call; nothing mutates after.
    let installedAt: number | undefined;
    const { page, rawPage, runtime } = await fixture({ quietWait: true }, (now) => {
      installedAt ??= now;
      return { readyState: "complete", quietMs: now - installedAt };
    });
    const waited = await timedWait(page, 5_000);
    expect(waited).toBeGreaterThanOrEqual(RUN_OPTIONS.quietWait.windowMs);
    expect(waited).toBeLessThan(RUN_OPTIONS.quietWait.windowMs + 2 * RUN_OPTIONS.quietWait.pollMs);
    expect(runtime.telemetry().calls["page.waitForTimeout"]).toBe(1);
    // One in-page wait per call, polled every pollMs and capped at the requested time.
    expect(rawPage.waitForFunction).toHaveBeenCalledTimes(1);
    const [[expression, arg, waitOptions]] = rawPage.waitForFunction.mock.calls;
    expect(expression).toContain(`>= ${RUN_OPTIONS.quietWait.windowMs}`);
    expect(arg).toBeUndefined();
    expect(waitOptions).toStrictEqual({ polling: RUN_OPTIONS.quietWait.pollMs, timeout: 5_000 });
    expect(runtime.telemetry().waits).toStrictEqual({
      count: 1,
      requestedMs: 5_000,
      waitedMs: waited,
      earlyReturns: 1,
    });
  });

  it("waits out the cap while the DOM keeps mutating", async () => {
    const { page, runtime } = await fixture({ quietWait: true }, () => ({
      readyState: "complete",
      quietMs: 20,
    }));
    expect(await timedWait(page, 2_000)).toBe(2_000);
    expect(runtime.telemetry().waits).toStrictEqual({
      count: 1,
      requestedMs: 2_000,
      waitedMs: 2_000,
      earlyReturns: 0,
    });
  });

  it("does not return early while the document is still loading", async () => {
    const { page, runtime } = await fixture({ quietWait: true }, () => ({
      readyState: "loading",
      quietMs: 10_000,
    }));
    expect(await timedWait(page, 1_500)).toBe(1_500);
    expect(runtime.telemetry().waits.earlyReturns).toBe(0);
  });

  it("just sleeps for waits at or below the window", async () => {
    const { page, rawPage, runtime, waits } = await fixture({ quietWait: true }, () => ({
      readyState: "complete",
      quietMs: 10_000,
    }));
    expect(await timedWait(page, RUN_OPTIONS.quietWait.windowMs)).toBe(
      RUN_OPTIONS.quietWait.windowMs,
    );
    expect(await timedWait(page, 50)).toBe(50);
    expect(rawPage.waitForTimeout.mock.calls).toStrictEqual([[400], [50]]);
    expect(waits()).toHaveLength(0);
    expect(runtime.telemetry().waits).toStrictEqual({
      count: 2,
      requestedMs: 450,
      waitedMs: 450,
      earlyReturns: 0,
    });
  });

  it("waits out the cap while navigations keep replacing the document", async () => {
    const { page, runtime } = await fixture({ quietWait: true }, () => "navigating");
    expect(await timedWait(page, 1_200)).toBe(1_200);
    expect(runtime.telemetry().waits).toStrictEqual({
      count: 1,
      requestedMs: 1_200,
      waitedMs: 1_200,
      earlyReturns: 0,
    });
  });

  it("sleeps out the rest of the cap when the in-page wait fails", async () => {
    const { page, rawPage, runtime } = await fixture({ quietWait: true }, () => "error");
    expect(await timedWait(page, 1_200)).toBe(1_200);
    expect(rawPage.waitForTimeout).toHaveBeenCalledTimes(1);
    expect(runtime.telemetry().waits).toStrictEqual({
      count: 1,
      requestedMs: 1_200,
      waitedMs: 1_200,
      earlyReturns: 0,
    });
  });

  it("just sleeps when the page has no waitForFunction", async () => {
    const { page, rawPage, runtime } = await fixture({ quietWait: true }, () => ({
      readyState: "complete",
      quietMs: 10_000,
    }));
    delete (rawPage as { waitForFunction?: unknown }).waitForFunction;
    expect(await timedWait(page, 1_000)).toBe(1_000);
    expect(rawPage.waitForTimeout.mock.calls).toStrictEqual([[1_000]]);
    expect(runtime.telemetry().waits.earlyReturns).toBe(0);
  });

  it("recovers after a navigation and still returns early", async () => {
    // Probe errors for the first 300 ms, then a fresh document installs its observer.
    let startedAt: number | undefined;
    let installedAt: number | undefined;
    const { page, runtime } = await fixture({ quietWait: true }, (now) => {
      startedAt ??= now;
      if (now - startedAt < 300) return "navigating";
      installedAt ??= now;
      return { readyState: "interactive", quietMs: now - installedAt };
    });
    const waited = await timedWait(page, 5_000);
    expect(waited).toBeGreaterThanOrEqual(700);
    expect(waited).toBeLessThan(1_000);
    expect(runtime.telemetry().waits.earlyReturns).toBe(1);
  });

  it("respects the cap on the host clock when the in-page wait never settles", async () => {
    const { page, runtime } = await fixture({ quietWait: true }, () => "hang");
    expect(await timedWait(page, 1_000)).toBe(1_000);
    expect(runtime.telemetry().waits).toStrictEqual({
      count: 1,
      requestedMs: 1_000,
      waitedMs: 1_000,
      earlyReturns: 0,
    });
  });

  it("measures each wait's quiet window from that wait, not an earlier one", async () => {
    // A probe installs an observer per key; the page last mutated 500 ms into
    // the second wait (the effect of an action taken before it).
    const installs = new Map<string, number>();
    let secondWaitAt: number | undefined;
    const { page, runtime, waits, cleanups } = await fixture({ quietWait: true }, (now, key) => {
      if (!installs.has(key)) installs.set(key, now);
      const mutatedAt = secondWaitAt === undefined ? 0 : secondWaitAt + 500;
      return {
        readyState: "complete",
        quietMs: now - Math.max(installs.get(key)!, Math.min(mutatedAt, now)),
      };
    });
    const first = await timedWait(page, 3_000);
    expect(first).toBeGreaterThanOrEqual(RUN_OPTIONS.quietWait.windowMs);
    await vi.advanceTimersByTimeAsync(10_000);
    secondWaitAt = Date.now();
    const second = await timedWait(page, 3_000);
    expect(second).toBeGreaterThanOrEqual(500 + RUN_OPTIONS.quietWait.windowMs);
    expect(second).toBeLessThan(
      500 + RUN_OPTIONS.quietWait.windowMs + 2 * RUN_OPTIONS.quietWait.pollMs,
    );
    expect(installs.size).toBe(2);
    // Each wait removes its own observer once it ends.
    expect(cleanups().map(([expression]) => keyOf(expression))).toStrictEqual([...installs.keys()]);
    expect(waits().map(([expression]) => keyOf(expression))).toStrictEqual([...installs.keys()]);
    expect(runtime.telemetry().waits.earlyReturns).toBe(2);
  });

  it("keeps the predicate's document key out of the page's registry", async () => {
    const { page, waits } = await fixture({ quietWait: true }, () => ({
      readyState: "complete",
      quietMs: 10_000,
    }));
    await timedWait(page, 1_000);
    const [[expression]] = waits();
    expect(expression).not.toContain("Symbol.for");
    expect(keyOf(expression)).not.toMatch(/stagehand/i);
  });

  it("adds every wait to the run's telemetry", async () => {
    let installedAt: number | undefined;
    const { page, runtime } = await fixture({ quietWait: true }, (now) => {
      installedAt ??= now;
      return { readyState: "complete", quietMs: now - installedAt };
    });
    const first = await timedWait(page, 3_000);
    const second = await timedWait(page, 200);
    expect(runtime.telemetry().calls["page.waitForTimeout"]).toBe(2);
    expect(runtime.telemetry().waits).toStrictEqual({
      count: 2,
      requestedMs: 3_200,
      waitedMs: first + second,
      earlyReturns: 1,
    });
  });
});

describe("quietWait wiring", () => {
  it("keeps the runtime's constants in step with contract.runOptions", () => {
    expect(RUN_OPTIONS).toStrictEqual({
      quietWait: { default: false, windowMs: 400, pollMs: 100 },
    });
    expect(RUNTIME_SOURCE).toContain(`QUIET_WAIT_WINDOW_MS = ${RUN_OPTIONS.quietWait.windowMs};`);
    expect(RUNTIME_SOURCE).toContain(`QUIET_WAIT_POLL_MS = ${RUN_OPTIONS.quietWait.pollMs};`);
  });

  it("turns quietWait on only for a literal true in the run input", () => {
    expect(RUN_PRELUDE).toContain("quietWait: input.quietWait === true");
  });
});
