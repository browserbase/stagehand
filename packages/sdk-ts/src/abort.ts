const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Operation aborted");
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

export async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return await promise;
  if (signal.aborted) {
    void promise.catch(() => {});
    throw abortReason(signal);
  }

  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (ms === Number.POSITIVE_INFINITY) {
    if (!signal) {
      await new Promise<void>(() => {});
      return;
    }
    await new Promise<void>((_resolve, reject) => {
      const onAbort = () => reject(abortReason(signal));
      signal.addEventListener("abort", onAbort, { once: true });
    });
    return;
  }

  const clampedMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const deadline = performance.now() + clampedMs;

  if (!signal) {
    await new Promise<void>((resolve) => {
      const tick = () => {
        const remaining = deadline - performance.now();
        if (remaining > 0) {
          setTimeout(tick, Math.min(MAX_TIMER_DELAY_MS, Math.ceil(remaining)));
        } else {
          resolve();
        }
      };
      tick();
    });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      reject(abortReason(signal));
    };
    const tick = () => {
      const remaining = deadline - performance.now();
      if (remaining > 0) {
        timeoutId = setTimeout(tick, Math.min(MAX_TIMER_DELAY_MS, Math.ceil(remaining)));
      } else {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    tick();
  });
}
