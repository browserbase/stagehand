import type { MetricValue } from "./harnesses/externalRunner.js";
import type { TaskResult } from "./types.js";

export const PROVIDER_CONCURRENCY_ENV = "EVAL_PROVIDER_CONCURRENCY";
export const DEFAULT_PROVIDER_WIDTH = 3;
export const THROTTLE_WINDOW_MS = 60_000;
export const BROWSERBASE_RETRY_DELAY_MS = 20_000;

export type ThrottleSource = "provider" | "browserbase";

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

const BROWSERBASE_CREATE_FAILURE = /^Browserbase session creation failed/;

export function classifyThrottle(message: unknown): ThrottleSource | undefined {
  if (typeof message !== "string" || !message) return undefined;
  if (!THROTTLE_PATTERNS.some((pattern) => pattern.test(message))) return undefined;
  return BROWSERBASE_CREATE_FAILURE.test(message) ? "browserbase" : "provider";
}

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

export interface SemaphoreSnapshot {
  active: number;
  width: number;
  baseWidth: number;
  waiting: number;
  throttledUntil?: number;
}

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

export class AbortedWhileQueued extends Error {
  constructor() {
    super("aborted while waiting for a provider slot");
    this.name = "AbortedWhileQueued";
  }
}

export interface ConcurrencyQueueSnapshot {
  running: number;
  queued: number;
  total?: number;
  throttled: number;
  semaphores: Record<string, SemaphoreSnapshot>;
}

export interface ProviderConcurrencyOptions {
  globalConcurrency: number;
  widths?: Record<string, number>;
  defaultProviderWidth?: number;
  throttleWindowMs?: number;
  now?: () => number;
  onChange?: (snapshot: ConcurrencyQueueSnapshot) => void;
}

export interface ThrottleRecord {
  source: ThrottleSource;
  semaphore?: string;
  reason: string;
  widthBefore?: number;
  widthAfter?: number;
  extended?: boolean;
}

export class ProviderConcurrency {
  readonly globalConcurrency: number;
  private readonly widths: Record<string, number>;
  private readonly defaultProviderWidth: number;
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
    this.defaultProviderWidth = options.defaultProviderWidth ?? DEFAULT_PROVIDER_WIDTH;
    this.throttleWindowMs = options.throttleWindowMs ?? THROTTLE_WINDOW_MS;
    this.now = options.now ?? Date.now;
    this.onChange = options.onChange;
    for (const name of Object.keys(this.widths)) this.semaphore(name);
  }

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

  configuredWidth(name: string): number {
    const explicit = this.widths[name.toLowerCase()];
    return Math.min(explicit ?? this.defaultProviderWidth, this.globalConcurrency);
  }

  setTotal(total: number): void {
    this.total = total;
    this.emit();
  }

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

  markFinished(): void {
    this.finished++;
    this.emit();
  }

  throttle(provider: string | undefined, reason: string): ThrottleRecord {
    const name = provider ?? "unknown";
    const semaphore = this.semaphore(name);
    const widthBefore = semaphore.width;
    const alreadyThrottled = (this.throttledUntil.get(name) ?? 0) > this.now();
    if (!alreadyThrottled) semaphore.setWidth(Math.max(1, Math.floor(semaphore.baseWidth / 2)));
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

export function formatConcurrencyQueueLine(snapshot: ConcurrencyQueueSnapshot): string {
  const parts = [`running ${snapshot.running}`, `queued ${snapshot.queued}`];
  for (const [name, semaphore] of Object.entries(snapshot.semaphores)) {
    const throttledMark = semaphore.throttledUntil !== undefined ? "↓" : "";
    parts.push(`${name} ${semaphore.active}/${semaphore.width}${throttledMark}`);
  }
  if (snapshot.throttled > 0) parts.push(`throttled ${snapshot.throttled}`);
  return parts.join(" · ");
}

export function describeProviderWidths(
  scheduler: ProviderConcurrency,
  providers: Iterable<string | undefined>,
): string {
  const names = new Set<string>();
  for (const provider of providers) if (provider) names.add(provider.toLowerCase());
  return [...names]
    .sort()
    .map((name) => `${name} ${scheduler.configuredWidth(name)}`)
    .join(" · ");
}

export interface ThrottledRowInfo {
  source: ThrottleSource;
  semaphore?: string;
  reason: string;
  throttles: number;
  retried: boolean;
}

export interface RunGatedRowOptions {
  scheduler: ProviderConcurrency;
  modelName: string | undefined;
  execute: (attempt: number) => Promise<TaskResult>;
  signal?: AbortSignal;
  onStart?: () => void;
  onThrottle?: (record: ThrottleRecord, attempt: number) => void;
  maxRetries?: number;
  browserbaseRetryDelayMs?: number;
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
    const timer = setTimeout(done, ms);
    timer.unref?.();
    signal?.addEventListener("abort", done, { once: true });
  });

export const ABORTED_ROW: TaskResult = { _success: false, error: "aborted by user", logs: [] };

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
        if (error instanceof AbortedWhileQueued) return decorate(ABORTED_ROW, throttleInfo);
        throw error;
      }
      const source = classifyResultThrottle(result);
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
      if (source === "browserbase") {
        await sleep(options.browserbaseRetryDelayMs ?? BROWSERBASE_RETRY_DELAY_MS, signal);
        if (signal?.aborted) return decorate(result, { ...throttleInfo, retried: false });
      }
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
