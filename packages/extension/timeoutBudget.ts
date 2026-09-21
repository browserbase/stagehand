import { TimeoutError } from "./errors.js";

const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * A caller-owned budget shared across asynchronous stages of one operation.
 * Omitted or zero timeout means no deadline; positive values are milliseconds.
 * Callers choose defaults before constructing the budget. An expired budget is
 * never converted to an omitted timeout or reset when another stage starts.
 */
export class TimeoutBudget {
  readonly deadline: number | undefined;
  private timeoutError: Error | undefined;

  constructor(
    readonly timeoutMs?: number,
    private readonly errorFactory: (timeoutMs: number) => Error = (ms) =>
      new TimeoutError("operation", ms),
  ) {
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
      throw new RangeError("Timeout must be a finite, non-negative number of milliseconds");
    }
    this.deadline = timeoutMs ? performance.now() + timeoutMs : undefined;
  }

  /** undefined means no deadline; zero means the finite budget has expired. */
  remainingMs(): number | undefined {
    return this.deadline === undefined ? undefined : Math.max(0, this.deadline - performance.now());
  }

  throwIfExpired(): void {
    if (this.remainingMs() === 0) throw this.expiryError();
  }

  /**
   * Bound one stage by the remaining budget, without resetting the deadline.
   * The callback receives a cooperative abort signal for timeout cleanup. This
   * cannot cancel already-issued browser commands: callbacks must guard further
   * side effects and dispose late resources themselves. Late rejection is handled.
   */
  async run<T>(task: (signal: AbortSignal) => T | PromiseLike<T>): Promise<T> {
    this.throwIfExpired();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = Promise.resolve().then(() => {
      this.throwIfExpired();
      return task(controller.signal);
    });

    const expired = new Promise<never>((_resolve, reject) => {
      const schedule = () => {
        const remaining = this.remainingMs();
        if (remaining === undefined) return;
        if (remaining === 0) {
          const error = this.expiryError();
          reject(error);
          controller.abort(error);
          return;
        }
        // Recheck the monotonic deadline when timers fire early or are clamped.
        timer = setTimeout(schedule, Math.min(remaining, MAX_TIMER_DELAY_MS));
      };
      schedule();
    });

    try {
      const result = await Promise.race([pending, expired]);
      this.throwIfExpired();
      return result;
    } catch (error) {
      // Work can block the event loop past the deadline before the timer fires.
      if (this.remainingMs() === 0) {
        const timeoutError = this.expiryError();
        controller.abort(timeoutError);
        throw timeoutError;
      }
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private expiryError(): Error {
    return (this.timeoutError ??= this.errorFactory(this.timeoutMs!));
  }
}
