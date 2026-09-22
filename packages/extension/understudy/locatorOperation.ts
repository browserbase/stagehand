import { TimeoutError } from "../errors.js";

type LocatorOperationOptions = {
  name: string;
  /** Milliseconds for the whole operation. Zero disables the deadline. */
  timeout: number;
};

const MAX_TIMER_MS = 2_147_483_647;

/** One invocation's lifetime, shared by its frame resolution and action steps. */
export class LocatorOperation {
  private readonly controller = new AbortController();
  private readonly deadline: number | null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly name: string,
    private readonly timeout: number,
  ) {
    if (!Number.isFinite(timeout) || timeout < 0) {
      throw new RangeError("Locator timeout must be a finite, non-negative number");
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
    // Check the clock too: the deadline timer may not have run yet.
    this.expireIfNeeded();
    this.signal.throwIfAborted();
  }

  /** Only the runner that created this context owns its timer. */
  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private expireIfNeeded(): void {
    if (!this.signal.aborted && this.remainingMs() === 0) {
      this.dispose();
      this.controller.abort(new TimeoutError(this.name, this.timeout));
    }
  }

  private scheduleDeadline(): void {
    // Long timeouts need several timer intervals; never truncate the deadline.
    this.timer = setTimeout(
      () => {
        this.expireIfNeeded();
        if (!this.signal.aborted) this.scheduleDeadline();
      },
      Math.min(MAX_TIMER_MS, Math.ceil(this.remainingMs())),
    );
  }
}

/**
 * Own a new operation, or reuse a parent's context without resetting its clock.
 * Expiry stops waiting; work must check the context before continuing its steps.
 */
export async function runLocatorOperation<T>(
  options: LocatorOperationOptions | LocatorOperation,
  work: (operation: LocatorOperation) => Promise<T>,
): Promise<T> {
  const ownsOperation = !(options instanceof LocatorOperation);
  const operation =
    options instanceof LocatorOperation
      ? options
      : new LocatorOperation(options.name, options.timeout);

  let onAbort: (() => void) | undefined;
  try {
    operation.throwIfStopped();
    const stopped = new Promise<never>((_, reject) => {
      onAbort = () => reject(operation.signal.reason);
      operation.signal.addEventListener("abort", onAbort, { once: true });
    });
    // Attach both handlers before invoking work, including work that throws synchronously.
    const pending = Promise.resolve().then(() => {
      operation.throwIfStopped();
      return work(operation);
    });
    const result = await Promise.race([pending, stopped]);
    operation.throwIfStopped();
    return result;
  } finally {
    if (onAbort) operation.signal.removeEventListener("abort", onAbort);
    if (ownsOperation) operation.dispose();
  }
}
