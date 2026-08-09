import { describe, expect, it, vi } from "vitest";

import { withTimeout } from "../../lib/v3/timeoutConfig.js";
import { TimeoutError } from "../../lib/v3/types/public/sdkErrors.js";

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("withTimeout cancellation", () => {
  it("aborts cooperative work and prevents a delayed side effect", async () => {
    const sideEffect = vi.fn();
    let operationSignal: AbortSignal | undefined;

    const operation = withTimeout(
      (signal) =>
        new Promise<void>((resolve, reject) => {
          operationSignal = signal;
          const timer = setTimeout(() => {
            sideEffect();
            resolve();
          }, 50);
          signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(signal.reason);
            },
            { once: true },
          );
        }),
      5,
      "delayed action",
    );

    await expect(operation).rejects.toBeInstanceOf(TimeoutError);
    expect(operationSignal?.aborted).toBe(true);

    await delay(70);
    expect(sideEffect).not.toHaveBeenCalled();
  });

  it("does not start an operation when its parent signal is already aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    controller.abort(reason);
    const operation = vi.fn(async () => "done");

    await expect(
      withTimeout(operation, 100, "operation", {
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(operation).not.toHaveBeenCalled();
  });
});
