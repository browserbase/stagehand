import { DEFAULT_LOCATOR_TIMEOUT_MS } from "@browserbasehq/stagehand-protocol/schemas";
import { TimeoutError } from "../errors.js";
import { TimeoutBudget } from "../timeoutBudget.js";
import type { CDPSessionLike } from "./cdp.js";

/**
 * One overall timeout context for a locator call: iframe/helper setup, element
 * resolution, and execution all consume the same deadline without resetting it.
 * Defaults to five seconds. An inherited budget takes precedence; a supplied
 * unbounded budget (explicit timeout zero) disables the overall deadline.
 *
 * run(), wait(), and send() enforce that one budget. This context owns neither an
 * element nor a browser session. Create it when the call starts, not when a reusable
 * locator is constructed, and never store it on a cached Page or Frame.
 */
export class LocatorOperation {
  constructor(
    readonly budget = new TimeoutBudget(
      DEFAULT_LOCATOR_TIMEOUT_MS,
      (ms) => new TimeoutError("Locator operation", ms),
    ),
  ) {}

  run<T>(task: (signal: AbortSignal) => T | PromiseLike<T>): Promise<T> {
    return this.budget.run(task);
  }

  wait(ms: number): Promise<void> {
    return this.budget.wait(ms);
  }

  send<R = unknown>(session: CDPSessionLike, method: string, params?: object): Promise<R> {
    return sendCdpCommand(session, this.budget, method, params);
  }
}

/**
 * The shared enforcement point for operation-owned browser commands.
 * Sessions remain raw and reusable; the budget belongs to the caller.
 * Already-issued commands cannot be canceled, so dispose late handles here.
 */
export function sendCdpCommand<R = unknown>(
  session: CDPSessionLike,
  budget: TimeoutBudget | undefined,
  method: string,
  params?: object,
): Promise<R> {
  if (!budget) return session.send<R>(method, params);
  // Cleanup is permitted after expiry and must not delay timeout delivery.
  if (method === "Runtime.releaseObject") {
    void session.send(method, params).catch(() => {});
    return Promise.resolve(undefined as R);
  }
  return budget.run(async (signal) => {
    const result = await session.send<R>(method, params);
    if (signal.aborted || budget.remainingMs() === 0) {
      const objectId = (result as { result?: { objectId?: string } })?.result?.objectId;
      if (objectId) void session.send("Runtime.releaseObject", { objectId }).catch(() => {});
      budget.throwIfExpired();
    }
    return result;
  });
}

export function isClosedSessionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /CDP connection closed|target closed|session closed|Session closed|Target closed/.test(
      error.message,
    )
  );
}
