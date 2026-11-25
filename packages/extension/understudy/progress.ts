import { TimeoutError } from "../errors.js";

type ProgressOptions = {
  name: string;
  timeout: number;
};

const MAX_TIMER_MS = 2_147_483_647;
const CLEANUP_TIMEOUT_MS = 1_000;

export class Progress {
  private readonly controller = new AbortController();
  private readonly deadline: number | null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly phases = new Map<symbol, string>();

  constructor(
    readonly name: string,
    private readonly timeout: number,
  ) {
    if (!Number.isFinite(timeout) || timeout < 0) {
      throw new RangeError("Timeout must be a finite, non-negative number");
    }
    this.deadline = timeout === 0 ? null : performance.now() + timeout;
    if (this.deadline !== null) this.scheduleDeadline();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  remainingMs(): number {
    return this.deadline === null ? Infinity : Math.max(0, this.deadline - performance.now());
  }

  throwIfStopped(): void {
    this.expireIfNeeded();
    this.signal.throwIfAborted();
  }

  async run<T>(
    phase: string,
    work: () => Promise<T>,
    onLateResult?: (value: T) => void | Promise<unknown>,
  ): Promise<T> {
    this.throwIfStopped();
    const step = Symbol();
    this.phases.set(step, phase);
    let onAbort: (() => void) | undefined;
    let abandoned = false;
    let result: { value: T } | undefined;
    const discard = (value: T) => {
      if (onLateResult) void this.cleanup(() => onLateResult(value));
    };

    try {
      const stopped = new Promise<never>((_, reject) => {
        onAbort = () => reject(this.signal.reason);
        this.signal.addEventListener("abort", onAbort, { once: true });
      });
      const pending = Promise.resolve()
        .then(() => {
          this.throwIfStopped();
          return work();
        })
        .then((value) => {
          if (abandoned) discard(value);
          else result = { value };
          return value;
        });
      const value = await Promise.race([pending, stopped]);
      this.throwIfStopped();
      return value;
    } catch (error) {
      abandoned = true;
      if (result) discard(result.value);
      this.throwIfStopped();
      throw error;
    } finally {
      if (onAbort) this.signal.removeEventListener("abort", onAbort);
      this.phases.delete(step);
    }
  }

  async delay(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError("Delay must be a finite, non-negative number");
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.run("waiting between steps", () => {
        const deadline = performance.now() + ms;
        return new Promise<void>((resolve) => {
          const tick = () => {
            const remaining = deadline - performance.now();
            if (remaining <= 0) resolve();
            else timer = setTimeout(tick, Math.min(MAX_TIMER_MS, Math.ceil(remaining)));
          };
          tick();
        });
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async cleanup(work: () => void | Promise<unknown>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(work),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, CLEANUP_TIMEOUT_MS);
        }),
      ]);
    } catch {
    } finally {
      clearTimeout(timer);
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private expireIfNeeded(): void {
    if (!this.signal.aborted && this.remainingMs() === 0) {
      this.dispose();
      const error = new TimeoutError(this.name, this.timeout);
      const phase = [...this.phases.values()].at(-1);
      if (phase && phase !== this.name) error.message += ` while ${phase}`;
      this.controller.abort(error);
    }
  }

  private scheduleDeadline(): void {
    this.timer = setTimeout(
      () => {
        this.expireIfNeeded();
        if (!this.signal.aborted) this.scheduleDeadline();
      },
      Math.min(MAX_TIMER_MS, Math.ceil(this.remainingMs())),
    );
  }
}

export async function runWithProgress<T>(
  options: ProgressOptions | Progress,
  work: (progress: Progress) => Promise<T>,
): Promise<T> {
  const ownsProgress = !(options instanceof Progress);
  const progress =
    options instanceof Progress ? options : new Progress(options.name, options.timeout);

  try {
    return await progress.run(progress.name, () => work(progress));
  } finally {
    if (ownsProgress) progress.dispose();
  }
}

export function runLocatorStep<T>(
  progress: Progress | undefined,
  phase: string,
  work: () => Promise<T>,
  onLateResult?: (value: T) => void | Promise<unknown>,
): Promise<T> {
  return progress ? progress.run(phase, work, onLateResult) : work();
}
