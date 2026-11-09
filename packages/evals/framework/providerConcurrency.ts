/**
 * Per-provider concurrency under the global Braintrust cap.
 *
 * Braintrust's `maxConcurrency` is the ceiling for how many rows are in
 * flight, but a 10-wide run against one provider is 10-wide against that
 * provider. This module gates what actually runs with one semaphore per model
 * provider (`openai`, `anthropic`, …), keyed by the `provider/` prefix of the
 * row's model id — the same derivation the bench planner uses for
 * `BenchMatrixRow.provider`.
 *
 * Scope: one `evals run` process. Separately launched runs do not share these
 * limits; running several cells under one cap is the matrix planner's job.
 *
 * By default there is no per-provider cap: the global `-c` is the only
 * limit, and rows are interleaved across providers (see
 * `interleaveByProvider`), so the slots split evenly between them. A cap is
 * opt-in: `EVAL_PROVIDER_CONCURRENCY` (`openai=6,anthropic=4`) over
 * `providers.<p>.concurrency` in config, clamped to the global cap. Capped
 * providers get their width; the others share what is left.
 *
 * Throttling: when the agent's own provider call fails with a 429 / connect
 * timeout, that provider's width is halved for `THROTTLE_WINDOW_MS` (further
 * signals inside the window only extend it) and the row gets one retry with
 * a fresh session after `PROVIDER_RETRY_DELAY_MS`, so the retry doesn't hit
 * the provider again milliseconds after the 429. A Browserbase session-create 429 gets the same single
 * retry after `BROWSERBASE_RETRY_DELAY_MS`, without touching any width:
 * Browserbase limits concurrent sessions, which the global cap already
 * bounds. Retried rows are tagged (`metrics.provider_throttled`,
 * `providerThrottled`) so they can be excluded from comparisons.
 */

import type { MetricValue } from "./harnesses/externalRunner.js";
import type { TaskResult } from "./types.js";

export const PROVIDER_CONCURRENCY_ENV = "EVAL_PROVIDER_CONCURRENCY";
export const THROTTLE_WINDOW_MS = 60_000;
export const BROWSERBASE_RETRY_DELAY_MS = 20_000;
export const PROVIDER_RETRY_DELAY_MS = 10_000;

export type ThrottleSource = "provider" | "browserbase";

/**
 * Backpressure signatures. A bare "429" is only trusted next to a status
 * word, so ids, step counts and URLs that happen to contain 429 don't match.
 */
const THROTTLE_PATTERNS: RegExp[] = [
  /\b(?:status|code|http|error)[\s:=]*429\b/i,
  /\b429\b[^\n]{0,40}(?:too many|rate)/i,
  /\(429\)/,
  /too many requests/i,
  /rate[ _-]?limit/i,
  /headers timeout/i,
  /UND_ERR_(?:HEADERS|CONNECT)_TIMEOUT/,
  /connect timeout/i,
  /cannot connect to api/i,
  /\boverloaded(?:_error)?\b/i,
];

/** Prefix `launchRunnerProvidedBrowserbaseChrome` puts on create failures. */
const BROWSERBASE_CREATE_FAILURE = /^Browserbase session creation failed/;

/** Classify an error message: the throttle source, or `undefined` for anything else. */
export function classifyThrottle(message: unknown): ThrottleSource | undefined {
  if (typeof message !== "string" || !message) return undefined;
  if (!THROTTLE_PATTERNS.some((pattern) => pattern.test(message))) return undefined;
  return BROWSERBASE_CREATE_FAILURE.test(message) ? "browserbase" : "provider";
}

/**
 * Read the throttle signal off a finished row. Only the agent's side counts:
 * an `sdk_error` stop reason, or an exception thrown before the harness ran
 * (session creation). A verifier failure — a rate-limited judge — never
 * throttles the agent's provider or re-runs the agent.
 */
export function classifyResultThrottle(result: TaskResult): ThrottleSource | undefined {
  if (result._success) return undefined;
  if (result.verifierError !== undefined) return undefined;
  if (result.harnessStatus === "sdk_error") {
    return (
      classifyThrottle(result.harnessStopReason) ??
      classifyThrottle(typeof result.error === "string" ? result.error : undefined)
    );
  }
  if (result.harnessStatus === undefined) {
    return classifyThrottle(typeof result.error === "string" ? result.error : undefined);
  }
  return undefined;
}

/**
 * Parse `openai=3,anthropic=3`. Whitespace-tolerant; entries that are not
 * `name=positive-int` throw so a typo fails the run at plan time instead of
 * silently falling back to the default width.
 */
export function parseProviderConcurrencyEnv(
  value: string | undefined,
  envKey: string = PROVIDER_CONCURRENCY_ENV,
): Record<string, number> {
  const widths: Record<string, number> = {};
  if (value === undefined || value.trim() === "") return widths;
  for (const rawEntry of value.split(",")) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const match = /^([A-Za-z0-9_.-]+)\s*=\s*(\d+)$/.exec(entry);
    const width = match ? Number(match[2]) : NaN;
    if (!match || !Number.isInteger(width) || width < 1) {
      throw new Error(
        `Invalid ${envKey} entry "${entry}". Expected provider=positive-integer, e.g. openai=3,anthropic=3.`,
      );
    }
    widths[match[1].toLowerCase()] = width;
  }
  return widths;
}

/** `provider/model` → `provider`; models without a prefix have no provider gate. */
export function providerFromModel(modelName: string | undefined): string | undefined {
  if (!modelName) return undefined;
  const slash = modelName.indexOf("/");
  return slash > 0 ? modelName.slice(0, slash).toLowerCase() : undefined;
}

/**
 * Interleave rows across providers, keeping each provider's own order.
 *
 * Braintrust admits rows in data order up to the global cap, and the provider
 * gate runs inside the task. Planned model by model, every global slot goes to
 * the first provider's rows, which then queue on that provider's semaphore
 * while the next provider's rows can't start: `-c 10` over openai and
 * anthropic ran ~3-wide instead of ~6. Each round takes up to `widthOf(p)`
 * rows from every provider, so the first slots split in proportion to the
 * provider widths and a narrow provider's queue doesn't strand slots a wider
 * one could use. Rows without a provider form their own group.
 */
export function interleaveByProvider<T>(
  rows: T[],
  modelOf: (row: T) => string | undefined,
  widthOf: (provider: string | undefined) => number = () => 1,
): T[] {
  const groups = new Map<string | undefined, T[]>();
  for (const row of rows) {
    const provider = providerFromModel(modelOf(row));
    const group = groups.get(provider);
    if (group) group.push(row);
    else groups.set(provider, [row]);
  }
  if (groups.size < 2) return rows;
  const queues = [...groups].map(([provider, queue]) => ({
    queue,
    take: Math.max(1, Math.floor(widthOf(provider))),
    next: 0,
  }));
  const interleaved: T[] = [];
  while (interleaved.length < rows.length) {
    for (const group of queues) {
      const end = Math.min(group.next + group.take, group.queue.length);
      for (; group.next < end; group.next++) interleaved.push(group.queue[group.next]);
    }
  }
  return interleaved;
}

/** gcd(a, b); with 0 as the identity, so it folds over a list. */
export function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

export interface SemaphoreSnapshot {
  /** Slots currently held. */
  active: number;
  /** Effective width right now (halved while throttled). */
  width: number;
  /** Configured width. */
  baseWidth: number;
  /** Acquirers parked behind the semaphore. */
  waiting: number;
  /** Epoch ms until which the width stays halved, if throttled. */
  throttledUntil?: number;
  /** No per-provider cap was set: only the global cap limits this provider. */
  uncapped?: boolean;
}

/**
 * Counting semaphore with a resizable width. Shrinking never evicts holders;
 * the new width simply applies to the next acquire.
 */
export class Semaphore {
  private activeCount = 0;
  private waiters: Array<() => void> = [];
  private currentWidth: number;

  constructor(
    public readonly name: string,
    private base: number,
  ) {
    if (!Number.isInteger(base) || base < 1) {
      throw new Error(`Semaphore "${name}" width must be a positive integer, received ${base}.`);
    }
    this.currentWidth = base;
  }

  get width(): number {
    return this.currentWidth;
  }

  get baseWidth(): number {
    return this.base;
  }

  get active(): number {
    return this.activeCount;
  }

  get waiting(): number {
    return this.waiters.length;
  }

  setWidth(width: number): void {
    this.currentWidth = Math.max(1, Math.floor(width));
    this.drain();
  }

  /** Resolve with a release function once a slot is free. Release is idempotent. */
  acquire(signal?: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const grant = () => {
        this.activeCount++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.activeCount = Math.max(0, this.activeCount - 1);
          this.drain();
        });
      };
      if (this.activeCount < this.currentWidth) {
        grant();
        return;
      }
      if (signal?.aborted) {
        reject(new AbortedWhileQueued());
        return;
      }
      const waiter = () => {
        signal?.removeEventListener("abort", onAbort);
        grant();
      };
      const onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new AbortedWhileQueued());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private drain(): void {
    while (this.activeCount < this.currentWidth && this.waiters.length > 0) {
      const next = this.waiters.shift();
      next?.();
    }
  }
}

/** The run was aborted while this row was still waiting for its provider slot. */
export class AbortedWhileQueued extends Error {
  constructor() {
    super("aborted while waiting for a provider slot");
    this.name = "AbortedWhileQueued";
  }
}

export interface ConcurrencyQueueSnapshot {
  /** Rows currently executing (holding their provider slot or ungated). */
  running: number;
  /** Executions not yet finished and not running (waiting for a slot or undispatched). */
  queued: number;
  /** Planned executions (testcases × trials), when known. */
  total?: number;
  /** Throttle signals seen so far. */
  throttled: number;
  /** Per-provider state, insertion ordered. */
  semaphores: Record<string, SemaphoreSnapshot>;
}

export interface ProviderConcurrencyOptions {
  /** Global Braintrust cap. Every semaphore is clamped to it. */
  globalConcurrency: number;
  /** Explicit widths (from env or config). Keys are lower-cased provider names. */
  widths?: Record<string, number>;
  throttleWindowMs?: number;
  now?: () => number;
  /** Fired after every state transition; the TUI queue line reads from this. */
  onChange?: (snapshot: ConcurrencyQueueSnapshot) => void;
}

export interface ThrottleRecord {
  source: ThrottleSource;
  /** Provider semaphore that was halved; absent for Browserbase retries. */
  semaphore?: string;
  reason: string;
  widthBefore?: number;
  widthAfter?: number;
  /** True when the provider was already throttled and only the window moved. */
  extended?: boolean;
}

export interface ProviderShare {
  /** The provider's cap, or its even share of what the caps leave. */
  width: number;
  capped: boolean;
  /** Rows per interleave round; the weights never add up to more than the global cap. */
  weight: number;
}

/** Per-provider gating for one `runEvals` call. */
export class ProviderConcurrency {
  readonly globalConcurrency: number;
  private readonly widths: Record<string, number>;
  private readonly throttleWindowMs: number;
  private readonly now: () => number;
  private readonly onChange?: (snapshot: ConcurrencyQueueSnapshot) => void;
  private readonly semaphores = new Map<string, Semaphore>();
  private readonly throttledUntil = new Map<string, number>();
  private readonly restoreTimers = new Map<string, NodeJS.Timeout>();
  private running = 0;
  private finished = 0;
  private total?: number;
  private throttled = 0;

  constructor(options: ProviderConcurrencyOptions) {
    if (!Number.isInteger(options.globalConcurrency) || options.globalConcurrency < 1) {
      throw new Error(
        `Global concurrency must be a positive integer, received ${options.globalConcurrency}.`,
      );
    }
    this.globalConcurrency = options.globalConcurrency;
    this.widths = Object.fromEntries(
      Object.entries(options.widths ?? {}).map(([key, width]) => [key.toLowerCase(), width]),
    );
    this.throttleWindowMs = options.throttleWindowMs ?? THROTTLE_WINDOW_MS;
    this.now = options.now ?? Date.now;
    this.onChange = options.onChange;
    // Materialize configured semaphores up front so the queue line can show
    // `anthropic 0/4` before the first row lands.
    for (const name of Object.keys(this.widths)) this.semaphore(name);
  }

  /** Build from env + global cap; env widths layer over config widths. */
  static fromEnv(
    globalConcurrency: number,
    options: Omit<ProviderConcurrencyOptions, "globalConcurrency" | "widths"> & {
      env?: NodeJS.ProcessEnv;
      configWidths?: Record<string, number>;
    } = {},
  ): ProviderConcurrency {
    const { env = process.env, configWidths, ...rest } = options;
    return new ProviderConcurrency({
      ...rest,
      globalConcurrency,
      widths: { ...configWidths, ...parseProviderConcurrencyEnv(env[PROVIDER_CONCURRENCY_ENV]) },
    });
  }

  /** Configured width for a provider, clamped to the global cap. */
  configuredWidth(name: string): number {
    const explicit = this.widths[name.toLowerCase()];
    return Math.min(explicit ?? this.globalConcurrency, this.globalConcurrency);
  }

  /** Whether a per-provider cap was set (env or config) for this provider. */
  isCapped(name: string): boolean {
    return this.widths[name.toLowerCase()] !== undefined;
  }

  /**
   * How the global cap splits across the providers of a run.
   *
   * `width` is what the header shows: a capped provider's cap, or an uncapped
   * one's even share of what the caps leave (the remainder goes to the first
   * ones, at least 1 each). Nothing enforces an uncapped share; uncapped
   * providers take freed slots.
   *
   * `weight` is what the interleave uses: the widths, scaled down when they
   * add up to more than the global cap (caps of 8 and 6 under `-c 10` weigh
   * 6 and 4), so one round of the interleave never exceeds the cap and the
   * first slots split in proportion.
   */
  shares(providers: Iterable<string | undefined>): Map<string, ProviderShare> {
    const names = new Set<string>();
    for (const provider of providers) if (provider) names.add(provider.toLowerCase());
    const sorted = [...names].sort();
    const uncapped = sorted.filter((name) => !this.isCapped(name));
    const cappedTotal = sorted
      .filter((name) => this.isCapped(name))
      .reduce((sum, name) => sum + this.configuredWidth(name), 0);
    const remaining = Math.max(0, this.globalConcurrency - cappedTotal);
    const each = Math.floor(remaining / Math.max(1, uncapped.length));
    const extra = remaining % Math.max(1, uncapped.length);
    const widths = sorted.map((name) =>
      this.isCapped(name)
        ? this.configuredWidth(name)
        : Math.max(1, each + (uncapped.indexOf(name) < extra ? 1 : 0)),
    );

    let weights = widths;
    const total = widths.reduce((sum, width) => sum + width, 0);
    if (total > this.globalConcurrency) {
      // Largest-remainder scaling to the global cap, at least 1 each.
      const exact = widths.map((width) => (width * this.globalConcurrency) / total);
      weights = exact.map((value) => Math.max(1, Math.floor(value)));
      let leftover = this.globalConcurrency - weights.reduce((sum, weight) => sum + weight, 0);
      const byFraction = exact
        .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
        .sort((a, b) => b.fraction - a.fraction);
      for (const { index } of byFraction) {
        if (leftover <= 0) break;
        weights[index] += 1;
        leftover -= 1;
      }
    }

    return new Map(
      sorted.map((name, index) => [
        name,
        { width: widths[index], capped: this.isCapped(name), weight: weights[index] },
      ]),
    );
  }

  /** Planned executions (testcases × trials) for the queued count. */
  setTotal(total: number): void {
    this.total = total;
    this.emit();
  }

  /**
   * Run `fn` while holding the provider's slot. Rows whose model has no
   * `provider/` prefix run ungated (the global cap still applies).
   */
  async withProvider<T>(
    provider: string | undefined,
    fn: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const release = provider ? await this.semaphore(provider).acquire(signal) : () => {};
    this.running++;
    this.emit();
    try {
      return await fn();
    } finally {
      release();
      this.running--;
      this.emit();
    }
  }

  /** Mark an execution finished for the queued count. Called once per row, retries included. */
  markFinished(): void {
    this.finished++;
    this.emit();
  }

  /**
   * Halve a provider's width for the throttle window. Several rows usually
   * fail together when a provider pushes back; only the first halves, the
   * rest extend the window, so a burst doesn't collapse the width to 1.
   */
  throttle(provider: string | undefined, reason: string): ThrottleRecord {
    const name = provider ?? "unknown";
    const semaphore = this.semaphore(name);
    const widthBefore = semaphore.width;
    const alreadyThrottled = (this.throttledUntil.get(name) ?? 0) > this.now();
    if (!alreadyThrottled) {
      // A capped provider halves its cap. An uncapped one has no cap to
      // halve, so it halves what it was actually running (the throttled row
      // has released its slot, hence the + 1).
      const from = this.isCapped(name)
        ? semaphore.baseWidth
        : Math.min(semaphore.baseWidth, semaphore.active + 1);
      semaphore.setWidth(Math.max(1, Math.floor(from / 2)));
    }
    this.throttledUntil.set(name, this.now() + this.throttleWindowMs);
    this.throttled++;

    const existing = this.restoreTimers.get(name);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.restoreTimers.delete(name);
      this.throttledUntil.delete(name);
      semaphore.setWidth(semaphore.baseWidth);
      this.emit();
    }, this.throttleWindowMs);
    timer.unref?.();
    this.restoreTimers.set(name, timer);
    this.emit();
    return {
      source: "provider",
      semaphore: name,
      reason,
      widthBefore,
      widthAfter: semaphore.width,
      ...(alreadyThrottled && { extended: true }),
    };
  }

  snapshot(): ConcurrencyQueueSnapshot {
    const semaphores: Record<string, SemaphoreSnapshot> = {};
    for (const [name, semaphore] of this.semaphores) {
      semaphores[name] = {
        active: semaphore.active,
        width: semaphore.width,
        baseWidth: semaphore.baseWidth,
        waiting: semaphore.waiting,
        ...(this.throttledUntil.has(name) && { throttledUntil: this.throttledUntil.get(name) }),
        ...(!this.isCapped(name) && { uncapped: true }),
      };
    }
    const queued =
      this.total === undefined ? 0 : Math.max(0, this.total - this.finished - this.running);
    return {
      running: this.running,
      queued,
      ...(this.total !== undefined && { total: this.total }),
      throttled: this.throttled,
      semaphores,
    };
  }

  /** Clear restore timers. Widths are left as-is; the instance is per run. */
  dispose(): void {
    for (const timer of this.restoreTimers.values()) clearTimeout(timer);
    this.restoreTimers.clear();
  }

  private semaphore(name: string): Semaphore {
    const key = name.toLowerCase();
    let semaphore = this.semaphores.get(key);
    if (!semaphore) {
      semaphore = new Semaphore(key, this.configuredWidth(key));
      this.semaphores.set(key, semaphore);
    }
    return semaphore;
  }

  private emit(): void {
    this.onChange?.(this.snapshot());
  }
}

/**
 * Format the live queue line:
 * `running 6 · queued 41 · anthropic 4/4 · openai 2 · google 3/8↓ · throttled 1`
 * A capped provider shows `active/width`; an uncapped one only its active
 * count, since nothing but the global cap limits it. Throttled semaphores
 * show their halved width with `↓`.
 */
export function formatConcurrencyQueueLine(snapshot: ConcurrencyQueueSnapshot): string {
  const parts = [`running ${snapshot.running}`, `queued ${snapshot.queued}`];
  for (const [name, semaphore] of Object.entries(snapshot.semaphores)) {
    const throttled = semaphore.throttledUntil !== undefined;
    parts.push(
      semaphore.uncapped && !throttled
        ? `${name} ${semaphore.active}`
        : `${name} ${semaphore.active}/${semaphore.width}${throttled ? "↓" : ""}`,
    );
  }
  if (snapshot.throttled > 0) parts.push(`throttled ${snapshot.throttled}`);
  return parts.join(" · ");
}

/**
 * Describe how the cap splits for the run header:
 * `anthropic 4 (capped) · google ~23 · openai ~23`. Uncapped shares are
 * approximate (`~`): they are what the interleave aims for, not a limit.
 * Empty when one uncapped provider has the whole cap to itself.
 */
export function describeProviderWidths(
  scheduler: ProviderConcurrency,
  providers: Iterable<string | undefined>,
): string {
  const shares = [...scheduler.shares(providers)];
  if (shares.length === 1 && !shares[0][1].capped) return "";
  return shares
    .map(([name, share]) =>
      share.capped ? `${name} ${share.width} (capped)` : `${name} ~${share.width}`,
    )
    .join(" · ");
}

// ---------------------------------------------------------------------------
// Row execution: provider slot + throttle-aware single retry.
// ---------------------------------------------------------------------------

export interface ThrottledRowInfo {
  source: ThrottleSource;
  semaphore?: string;
  /** Message from the most recent throttled attempt. */
  reason: string;
  /** Attempts that ended in a throttle signal. */
  throttles: number;
  /** Whether the row was re-run after the first throttle. */
  retried: boolean;
}

export interface RunGatedRowOptions {
  scheduler: ProviderConcurrency;
  modelName: string | undefined;
  execute: (attempt: number) => Promise<TaskResult>;
  signal?: AbortSignal;
  /** Called once, when the first attempt acquires its provider slot. */
  onStart?: () => void;
  /** Called when a throttle is detected, before any retry. */
  onThrottle?: (record: ThrottleRecord, attempt: number) => void;
  maxRetries?: number;
  /** Delay before retrying a Browserbase session-create 429. */
  browserbaseRetryDelayMs?: number;
  /** Delay before retrying a provider 429 / connect timeout. */
  providerRetryDelayMs?: number;
  /** Injectable for tests. Resolves early when the signal aborts. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    // Kept referenced: a retry wait must not let an otherwise idle process
    // exit before the retry runs.
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });

/** Row returned when the run is aborted before this row got a slot. */
export const ABORTED_ROW: TaskResult = {
  _success: false,
  error: "stopped before it ran",
  stoppedByUser: true,
  logs: [],
};

/**
 * Execute a row under its provider slot, retrying once on backpressure (see
 * the module doc). `execute` owns session creation, so a retry is a fresh
 * session. The final row carries `providerThrottled` and
 * `metrics.provider_throttled` whenever a throttle was observed.
 */
export async function runGatedRow(options: RunGatedRowOptions): Promise<TaskResult> {
  const { scheduler, signal } = options;
  const maxRetries = options.maxRetries ?? 1;
  const sleep = options.sleep ?? defaultSleep;
  const provider = providerFromModel(options.modelName);
  let attempt = 0;
  let throttleInfo: ThrottledRowInfo | undefined;

  try {
    for (;;) {
      attempt++;
      let result: TaskResult;
      try {
        result = await scheduler.withProvider(
          provider,
          () => {
            if (attempt === 1) options.onStart?.();
            return options.execute(attempt);
          },
          signal,
        );
      } catch (error) {
        if (error instanceof AbortedWhileQueued) {
          // Stopped while queued for its retry: the first attempt did run.
          const row =
            attempt > 1 ? { ...ABORTED_ROW, error: "stopped before its retry" } : ABORTED_ROW;
          return decorate(row, throttleInfo);
        }
        throw error;
      }
      const source = classifyResultThrottle(result);
      // A provider throttle needs a provider: rows with no model provider
      // (core tasks run with modelName "none") have no width to halve, so a
      // 429 or timeout in their own output is an ordinary failure.
      if (!source || (source === "provider" && !provider)) return decorate(result, throttleInfo);

      const reason =
        (typeof result.harnessStopReason === "string" && result.harnessStopReason) ||
        (typeof result.error === "string" && result.error) ||
        "rate limited";
      const record: ThrottleRecord =
        source === "provider" ? scheduler.throttle(provider, reason) : { source, reason };
      options.onThrottle?.(record, attempt);
      const willRetry = attempt <= maxRetries && !signal?.aborted;
      throttleInfo = {
        source,
        ...(record.semaphore && { semaphore: record.semaphore }),
        reason,
        throttles: attempt,
        retried: willRetry || (throttleInfo?.retried ?? false),
      };

      if (!willRetry) return decorate(result, throttleInfo);
      // Back off before the retry. A provider row has just released its slot,
      // so without a wait it re-acquires at once and calls the provider again
      // milliseconds after the 429.
      await sleep(
        source === "browserbase"
          ? (options.browserbaseRetryDelayMs ?? BROWSERBASE_RETRY_DELAY_MS)
          : (options.providerRetryDelayMs ?? PROVIDER_RETRY_DELAY_MS),
        signal,
      );
      if (signal?.aborted) return decorate(result, { ...throttleInfo, retried: false });
    }
  } finally {
    scheduler.markFinished();
  }
}

function decorate(result: TaskResult, info: ThrottledRowInfo | undefined): TaskResult {
  if (!info) return result;
  const metrics = (result.metrics ?? {}) as Record<string, MetricValue>;
  return {
    ...result,
    providerThrottled: info,
    metrics: {
      ...metrics,
      provider_throttled: { count: 1, value: info.throttles },
    },
  };
}
