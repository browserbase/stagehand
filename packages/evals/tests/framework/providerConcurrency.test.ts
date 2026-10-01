import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ABORTED_ROW,
  DEFAULT_PROVIDER_WIDTH,
  PROVIDER_CONCURRENCY_ENV,
  ProviderConcurrency,
  Semaphore,
  THROTTLE_WINDOW_MS,
  classifyResultThrottle,
  classifyThrottle,
  describeProviderWidths,
  formatConcurrencyQueueLine,
  parseProviderConcurrencyEnv,
  providerFromModel,
  runGatedRow,
} from "../../framework/providerConcurrency.js";
import type { TaskResult } from "../../framework/types.js";

// Drain microtasks only — several tests run under fake timers, where a
// setTimeout-based flush would never fire.
const flush = async () => {
  for (let i = 0; i < 16; i++) await Promise.resolve();
};

describe("Semaphore", () => {
  it("grants up to width and parks the rest", async () => {
    const semaphore = new Semaphore("openai", 2);
    const releaseA = await semaphore.acquire();
    const releaseB = await semaphore.acquire();
    let granted = false;
    const third = semaphore.acquire().then((release) => {
      granted = true;
      return release;
    });
    await flush();
    expect(granted).toBe(false);
    expect(semaphore.waiting).toBe(1);

    releaseA();
    const releaseC = await third;
    expect(granted).toBe(true);
    expect(semaphore.active).toBe(2);
    releaseB();
    releaseC();
    expect(semaphore.active).toBe(0);
  });

  it("release is idempotent", async () => {
    const semaphore = new Semaphore("openai", 1);
    const release = await semaphore.acquire();
    release();
    release();
    expect(semaphore.active).toBe(0);
  });

  it("shrinking the width never evicts holders and applies to the next acquire", async () => {
    const semaphore = new Semaphore("openai", 4);
    const releases = await Promise.all([
      semaphore.acquire(),
      semaphore.acquire(),
      semaphore.acquire(),
    ]);
    semaphore.setWidth(1);
    expect(semaphore.active).toBe(3);
    let granted = false;
    const waiter = semaphore.acquire().then(() => (granted = true));
    releases[0]();
    releases[1]();
    await flush();
    expect(granted).toBe(false);
    releases[2]();
    await waiter;
    expect(granted).toBe(true);
  });

  it("growing the width drains waiters", async () => {
    const semaphore = new Semaphore("openai", 1);
    await semaphore.acquire();
    const waiting = [semaphore.acquire(), semaphore.acquire()];
    await flush();
    semaphore.setWidth(3);
    await Promise.all(waiting);
    expect(semaphore.active).toBe(3);
  });

  it("rejects a parked acquire when the signal aborts", async () => {
    const semaphore = new Semaphore("openai", 1);
    await semaphore.acquire();
    const controller = new AbortController();
    const parked = semaphore.acquire(controller.signal);
    await flush();
    controller.abort();
    await expect(parked).rejects.toThrow(/aborted while waiting/);
    expect(semaphore.waiting).toBe(0);
  });

  it("rejects non-positive widths", () => {
    expect(() => new Semaphore("openai", 0)).toThrow(/positive integer/);
  });
});

describe("parseProviderConcurrencyEnv", () => {
  it("parses a comma list with whitespace and lower-cases names", () => {
    expect(parseProviderConcurrencyEnv(" openai=3, Anthropic = 4 ,google=2 ")).toEqual({
      openai: 3,
      anthropic: 4,
      google: 2,
    });
  });

  it("returns an empty map for unset or blank", () => {
    expect(parseProviderConcurrencyEnv(undefined)).toEqual({});
    expect(parseProviderConcurrencyEnv("   ")).toEqual({});
    expect(parseProviderConcurrencyEnv(",,")).toEqual({});
  });

  it("throws on malformed entries so a typo fails at plan time", () => {
    expect(() => parseProviderConcurrencyEnv("openai=three")).toThrow(
      new RegExp(`Invalid ${PROVIDER_CONCURRENCY_ENV} entry "openai=three"`),
    );
    expect(() => parseProviderConcurrencyEnv("openai")).toThrow(/Invalid/);
    expect(() => parseProviderConcurrencyEnv("openai=0")).toThrow(/Invalid/);
  });
});

describe("providerFromModel", () => {
  it("takes the prefix before the first slash", () => {
    expect(providerFromModel("openai/gpt-5.4-mini")).toBe("openai");
    expect(providerFromModel("Anthropic/claude-sonnet-4-6")).toBe("anthropic");
  });

  it("returns undefined for bare model ids", () => {
    expect(providerFromModel("gpt-4.1-mini")).toBeUndefined();
    expect(providerFromModel(undefined)).toBeUndefined();
    expect(providerFromModel("/weird")).toBeUndefined();
  });
});

describe("classifyThrottle", () => {
  it.each([
    "429 Too Many Requests",
    "Request failed with status code 429",
    "HTTP 429",
    "rate_limit_exceeded (429)",
    "Rate limit reached for gpt-5.4-mini",
    "Cannot connect to API: Headers Timeout Error",
    "fetch failed: UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "overloaded_error: Overloaded",
  ])("classifies %j as provider backpressure", (message) => {
    expect(classifyThrottle(message)).toBe("provider");
  });

  it("attributes session-create failures to Browserbase", () => {
    expect(classifyThrottle("Browserbase session creation failed: 429 Too Many Requests")).toBe(
      "browserbase",
    );
  });

  it.each([
    "max_turns",
    "stream closed before first token",
    "HTTP 401 Unauthorized",
    // A bare 429 in ids, step counts or URLs is not backpressure.
    "task took 429 steps",
    "see https://www.browserbase.com/sessions/429b1f00",
    "case 7e6993f2-429-ab",
    "",
    undefined,
    42,
  ])("does not classify %j", (message) => {
    expect(classifyThrottle(message)).toBeUndefined();
  });
});

describe("classifyResultThrottle", () => {
  it("reads the agent's sdk_error stop reason", () => {
    expect(
      classifyResultThrottle({
        _success: false,
        harnessStatus: "sdk_error",
        harnessStopReason: "rate_limit_exceeded (429)",
      }),
    ).toBe("provider");
  });

  it("reads exceptions thrown before the harness ran (no harnessStatus)", () => {
    expect(
      classifyResultThrottle({
        _success: false,
        error: "Browserbase session creation failed: 429 Too Many Requests",
      }),
    ).toBe("browserbase");
  });

  it("never throttles on a verifier failure — a rate-limited judge must not re-run the agent", () => {
    expect(
      classifyResultThrottle({
        _success: false,
        harnessStatus: "completed",
        verifierError: "Google API error 429: Too Many Requests",
        error: "Verification failed: Google API error 429: Too Many Requests",
      }),
    ).toBeUndefined();
    expect(
      classifyResultThrottle({
        _success: false,
        harnessStatus: "sdk_error",
        harnessStopReason: "rate_limit_exceeded (429)",
        verifierError: "judge unavailable",
      }),
    ).toBeUndefined();
  });

  it("ignores completed and max_turns rows and passes", () => {
    expect(
      classifyResultThrottle({
        _success: false,
        harnessStatus: "max_turns",
        error: "429 Too Many",
      }),
    ).toBeUndefined();
    expect(
      classifyResultThrottle({ _success: true, error: "429 Too Many Requests" }),
    ).toBeUndefined();
  });
});

describe("ProviderConcurrency", () => {
  let now = 1_000_000;
  const clock = () => now;
  beforeEach(() => {
    now = 1_000_000;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("defaults every provider to 3 and clamps to the global cap", () => {
    expect(new ProviderConcurrency({ globalConcurrency: 2 }).configuredWidth("openai")).toBe(2);
    const wide = new ProviderConcurrency({ globalConcurrency: 10 });
    expect(wide.configuredWidth("openai")).toBe(DEFAULT_PROVIDER_WIDTH);
    expect(
      new ProviderConcurrency({ globalConcurrency: 10, widths: { anthropic: 40 } }).configuredWidth(
        "Anthropic",
      ),
    ).toBe(10);
  });

  it("fromEnv layers EVAL_PROVIDER_CONCURRENCY over config widths", () => {
    const scheduler = ProviderConcurrency.fromEnv(10, {
      env: { [PROVIDER_CONCURRENCY_ENV]: "openai=2" },
      configWidths: { openai: 6, anthropic: 4 },
    });
    expect(scheduler.configuredWidth("openai")).toBe(2);
    expect(scheduler.configuredWidth("anthropic")).toBe(4);
  });

  it("gates rows per provider independently", async () => {
    const scheduler = new ProviderConcurrency({
      globalConcurrency: 10,
      widths: { openai: 1, anthropic: 2 },
    });
    scheduler.setTotal(4);
    const order: string[] = [];
    const gate = (name: string) => {
      let open!: () => void;
      const opened = new Promise<void>((resolve) => (open = resolve));
      return {
        run: async () => {
          order.push(`start ${name}`);
          await opened;
        },
        open: () => open(),
      };
    };
    const [a, b, c, d] = ["openai-1", "openai-2", "anthropic-1", "anthropic-2"].map(gate);
    const runs = [
      scheduler.withProvider("openai", a.run),
      scheduler.withProvider("openai", b.run),
      scheduler.withProvider("anthropic", c.run),
      scheduler.withProvider("anthropic", d.run),
    ];
    await flush();
    expect(order).toEqual(["start openai-1", "start anthropic-1", "start anthropic-2"]);
    expect(scheduler.snapshot()).toMatchObject({ running: 3, queued: 1 });
    a.open();
    await flush();
    expect(order).toContain("start openai-2");
    b.open();
    c.open();
    d.open();
    await Promise.all(runs);
    expect(scheduler.snapshot().running).toBe(0);
  });

  it("halves once per window: a burst of 429s extends instead of collapsing to 1", () => {
    const scheduler = new ProviderConcurrency({
      globalConcurrency: 10,
      widths: { openai: 6 },
      now: clock,
    });
    const first = scheduler.throttle("openai", "429");
    expect(first).toMatchObject({ semaphore: "openai", widthBefore: 6, widthAfter: 3 });
    expect(first.extended).toBeUndefined();

    now += 10_000;
    const second = scheduler.throttle("openai", "429 again");
    expect(second).toMatchObject({ widthBefore: 3, widthAfter: 3, extended: true });
    expect(scheduler.snapshot().semaphores.openai.throttledUntil).toBe(now + THROTTLE_WINDOW_MS);

    vi.advanceTimersByTime(THROTTLE_WINDOW_MS - 1);
    expect(scheduler.snapshot().semaphores.openai.width).toBe(3);
    vi.advanceTimersByTime(1);
    expect(scheduler.snapshot().semaphores.openai).toMatchObject({ width: 6 });
    expect(scheduler.snapshot().semaphores.openai.throttledUntil).toBeUndefined();
    expect(scheduler.snapshot().throttled).toBe(2);

    // After the window, a fresh signal halves again.
    now += THROTTLE_WINDOW_MS;
    expect(scheduler.throttle("openai", "429").widthAfter).toBe(3);
    scheduler.dispose();
  });
});

describe("runGatedRow", () => {
  const throttledRow: TaskResult = {
    _success: false,
    harnessStatus: "sdk_error",
    harnessStopReason: "rate_limit_exceeded (429)",
    metrics: { harness_total_tokens: { count: 1, value: 10 } },
  };

  it("returns an untouched row when nothing throttles", async () => {
    const scheduler = new ProviderConcurrency({ globalConcurrency: 4 });
    scheduler.setTotal(1);
    const execute = vi.fn(async (): Promise<TaskResult> => ({ _success: true }));
    expect(await runGatedRow({ scheduler, modelName: "openai/gpt-5.4-mini", execute })).toEqual({
      _success: true,
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(scheduler.snapshot()).toMatchObject({ running: 0, queued: 0, throttled: 0 });
  });

  it("halves the provider, retries once, and tags the row", async () => {
    const scheduler = new ProviderConcurrency({ globalConcurrency: 8, widths: { openai: 4 } });
    const execute = vi
      .fn<(attempt: number) => Promise<TaskResult>>()
      .mockResolvedValueOnce(throttledRow)
      .mockResolvedValueOnce({
        _success: true,
        metrics: { harness_total_tokens: { count: 1, value: 20 } },
      });
    const onThrottle = vi.fn();
    const onStart = vi.fn();
    const result = await runGatedRow({
      scheduler,
      modelName: "openai/gpt-5.4-mini",
      execute,
      onThrottle,
      onStart,
    });
    expect(execute.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2]);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onThrottle.mock.calls[0][0]).toMatchObject({ semaphore: "openai", widthAfter: 2 });
    expect(result).toMatchObject({
      _success: true,
      providerThrottled: { source: "provider", semaphore: "openai", throttles: 1, retried: true },
      metrics: {
        harness_total_tokens: { count: 1, value: 20 },
        provider_throttled: { count: 1, value: 1 },
      },
    });
    scheduler.dispose();
  });

  it("gives up after the single retry and keeps the second failure", async () => {
    const scheduler = new ProviderConcurrency({ globalConcurrency: 8, widths: { openai: 4 } });
    const execute = vi.fn(async (): Promise<TaskResult> => throttledRow);
    const result = await runGatedRow({ scheduler, modelName: "openai/gpt-5.4-mini", execute });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      _success: false,
      harnessStatus: "sdk_error",
      providerThrottled: { throttles: 2, retried: true },
    });
    // The second signal lands inside the window: extended, not halved again.
    expect(scheduler.snapshot().semaphores.openai.width).toBe(2);
    scheduler.dispose();
  });

  it("retries a Browserbase create 429 after a delay without touching any width", async () => {
    const scheduler = new ProviderConcurrency({ globalConcurrency: 8, widths: { openai: 4 } });
    const sleep = vi.fn(async () => {});
    const execute = vi
      .fn<(attempt: number) => Promise<TaskResult>>()
      .mockResolvedValueOnce({
        _success: false,
        error: "Browserbase session creation failed: 429 Too Many Requests",
      })
      .mockResolvedValueOnce({ _success: true });
    const result = await runGatedRow({
      scheduler,
      modelName: "openai/gpt-5.4-mini",
      execute,
      sleep,
      browserbaseRetryDelayMs: 1234,
    });
    expect(sleep).toHaveBeenCalledWith(1234);
    expect(result).toMatchObject({
      _success: true,
      providerThrottled: { source: "browserbase", throttles: 1, retried: true },
    });
    expect(scheduler.snapshot().semaphores.openai.width).toBe(4);
    expect(scheduler.snapshot().throttled).toBe(0);
  });

  it("does not re-run the agent when only the judge was rate limited", async () => {
    const scheduler = new ProviderConcurrency({ globalConcurrency: 8 });
    const execute = vi.fn(
      async (): Promise<TaskResult> => ({
        _success: false,
        harnessStatus: "completed",
        verifierError: "Google API error 429",
        error: "Verification failed: Google API error 429",
      }),
    );
    const result = await runGatedRow({ scheduler, modelName: "openai/gpt-5.4-mini", execute });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.providerThrottled).toBeUndefined();
    expect(scheduler.snapshot().throttled).toBe(0);
  });

  it("returns an aborted row when the run stops while this row waits for a slot", async () => {
    const scheduler = new ProviderConcurrency({ globalConcurrency: 8, widths: { openai: 1 } });
    scheduler.setTotal(2);
    const controller = new AbortController();
    let finishFirst!: () => void;
    const first = runGatedRow({
      scheduler,
      modelName: "openai/gpt-5.4-mini",
      signal: controller.signal,
      execute: () => new Promise((resolve) => (finishFirst = () => resolve({ _success: true }))),
    });
    const onStart = vi.fn();
    const second = runGatedRow({
      scheduler,
      modelName: "openai/gpt-5.4-mini",
      signal: controller.signal,
      onStart,
      execute: async () => ({ _success: true }),
    });
    await flush();
    controller.abort("cooperative");
    expect(await second).toEqual(ABORTED_ROW);
    expect(onStart).not.toHaveBeenCalled();
    finishFirst();
    await first;
    expect(scheduler.snapshot()).toMatchObject({ running: 0, queued: 0 });
  });

  it("does not retry ordinary failures", async () => {
    const scheduler = new ProviderConcurrency({ globalConcurrency: 8 });
    const execute = vi.fn(
      async (): Promise<TaskResult> => ({ _success: false, harnessStatus: "max_turns" }),
    );
    const result = await runGatedRow({ scheduler, modelName: "openai/gpt-5.4-mini", execute });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.providerThrottled).toBeUndefined();
  });

  it("marks the row finished even when execute throws", async () => {
    const scheduler = new ProviderConcurrency({ globalConcurrency: 8 });
    scheduler.setTotal(2);
    await expect(
      runGatedRow({
        scheduler,
        modelName: "openai/gpt-5.4-mini",
        execute: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
    expect(scheduler.snapshot()).toMatchObject({ running: 0, queued: 1 });
  });
});

describe("queue line formatting", () => {
  it("renders running/queued, each semaphore, and throttled count", () => {
    expect(
      formatConcurrencyQueueLine({
        running: 6,
        queued: 41,
        total: 92,
        throttled: 1,
        semaphores: {
          anthropic: { active: 4, width: 4, baseWidth: 4, waiting: 3 },
          openai: { active: 2, width: 3, baseWidth: 6, waiting: 10, throttledUntil: 1 },
        },
      }),
    ).toBe("running 6 · queued 41 · anthropic 4/4 · openai 2/3↓ · throttled 1");
    expect(
      formatConcurrencyQueueLine({ running: 1, queued: 0, throttled: 0, semaphores: {} }),
    ).toBe("running 1 · queued 0");
  });

  it("describes configured widths for the run header", () => {
    const scheduler = new ProviderConcurrency({ globalConcurrency: 10, widths: { openai: 6 } });
    expect(describeProviderWidths(scheduler, ["openai", "anthropic", undefined, "openai"])).toBe(
      "anthropic 3 · openai 6",
    );
    expect(describeProviderWidths(scheduler, [undefined])).toBe("");
  });
});
