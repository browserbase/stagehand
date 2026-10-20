import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RUN_PRELUDE, RUNTIME_SOURCE } from "../src/facade/batch-sources.js";
import { RUN_OPTIONS } from "../src/facade/contract.js";
import {
  createPlaywrightCompatRuntime,
  type PlaywrightCompatRuntimeOptions,
} from "../src/facade/runtime.js";

type CompatPage = { waitForTimeout(ms: number): Promise<void> };
type Probe = { readyState: string; quietMs: number } | "throw" | "hang";

const isProbe = (expression: unknown) =>
  typeof expression === "string" && expression.includes("stagehand.facade.quietWait");

/**
 * A raw page whose quiet-wait probe answers with `probe(now)`; its
 * waitForTimeout sleeps on the (fake) clock like the extension's does.
 */
async function fixture(options: PlaywrightCompatRuntimeOptions, probe: (now: number) => Probe) {
  const rawPage = {
    pageId: "test-page",
    url: vi.fn(async () => "https://example.com/"),
    evaluate: vi.fn(async (expression: unknown) => {
      if (!isProbe(expression)) return { width: 800, height: 600 };
      const answer = probe(Date.now());
      if (answer === "throw") throw new Error("Execution context was destroyed.");
      if (answer === "hang") return new Promise(() => undefined);
      return answer;
    }),
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
  const probes = () => rawPage.evaluate.mock.calls.filter(([expression]) => isProbe(expression));
  return { page: runtime.page as CompatPage, rawPage, runtime, probes };
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
    const { page, rawPage, runtime, probes } = await fixture({}, () => ({
      readyState: "complete",
      quietMs: 10_000,
    }));
    expect(await timedWait(page, 5_000)).toBe(5_000);
    expect(rawPage.waitForTimeout.mock.calls).toStrictEqual([[5_000]]);
    expect(probes()).toHaveLength(0);
    expect(runtime.telemetry().calls["page.waitForTimeout"]).toBe(1);
    expect(runtime.telemetry().waits).toStrictEqual({
      count: 1,
      requestedMs: 5_000,
      waitedMs: 5_000,
      earlyReturns: 0,
    });
  });

  it("passes non-numeric waits through unchanged when off", async () => {
    const { page, rawPage, runtime } = await fixture({ quietWait: false }, () => "throw");
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
    const { page, runtime } = await fixture({ quietWait: true }, (now) => {
      installedAt ??= now;
      return { readyState: "complete", quietMs: now - installedAt };
    });
    const waited = await timedWait(page, 5_000);
    expect(waited).toBeGreaterThanOrEqual(RUN_OPTIONS.quietWait.windowMs);
    expect(waited).toBeLessThan(RUN_OPTIONS.quietWait.windowMs + 2 * RUN_OPTIONS.quietWait.pollMs);
    expect(runtime.telemetry().calls["page.waitForTimeout"]).toBe(1);
    expect(runtime.telemetry().waits).toStrictEqual({
      count: 1,
      requestedMs: 5_000,
      waitedMs: waited,
      earlyReturns: 1,
    });
  });

  it("waits out the cap while the DOM keeps mutating", async () => {
    const { page, runtime, probes } = await fixture({ quietWait: true }, () => ({
      readyState: "complete",
      quietMs: 20,
    }));
    expect(await timedWait(page, 2_000)).toBe(2_000);
    expect(probes().length).toBeGreaterThan(10);
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
    const { page, rawPage, runtime, probes } = await fixture({ quietWait: true }, () => ({
      readyState: "complete",
      quietMs: 10_000,
    }));
    expect(await timedWait(page, RUN_OPTIONS.quietWait.windowMs)).toBe(
      RUN_OPTIONS.quietWait.windowMs,
    );
    expect(await timedWait(page, 50)).toBe(50);
    expect(rawPage.waitForTimeout.mock.calls).toStrictEqual([[400], [50]]);
    expect(probes()).toHaveLength(0);
    expect(runtime.telemetry().waits).toStrictEqual({
      count: 2,
      requestedMs: 450,
      waitedMs: 450,
      earlyReturns: 0,
    });
  });

  it("keeps polling when the probe throws mid-wait (navigation) and respects the cap", async () => {
    const { page, runtime } = await fixture({ quietWait: true }, () => "throw");
    expect(await timedWait(page, 1_200)).toBe(1_200);
    expect(runtime.telemetry().waits).toStrictEqual({
      count: 1,
      requestedMs: 1_200,
      waitedMs: 1_200,
      earlyReturns: 0,
    });
  });

  it("recovers after a navigation and still returns early", async () => {
    // Probe errors for the first 300 ms, then a fresh document installs its observer.
    let startedAt: number | undefined;
    let installedAt: number | undefined;
    const { page, runtime } = await fixture({ quietWait: true }, (now) => {
      startedAt ??= now;
      if (now - startedAt < 300) return "throw";
      installedAt ??= now;
      return { readyState: "interactive", quietMs: now - installedAt };
    });
    const waited = await timedWait(page, 5_000);
    expect(waited).toBeGreaterThanOrEqual(700);
    expect(waited).toBeLessThan(1_000);
    expect(runtime.telemetry().waits.earlyReturns).toBe(1);
  });

  it("respects the cap when a probe never answers", async () => {
    const { page, runtime } = await fixture({ quietWait: true }, () => "hang");
    expect(await timedWait(page, 1_000)).toBe(1_000);
    expect(runtime.telemetry().waits).toStrictEqual({
      count: 1,
      requestedMs: 1_000,
      waitedMs: 1_000,
      earlyReturns: 0,
    });
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
