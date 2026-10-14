import type { Protocol } from "devtools-protocol";
import { browserWait, BrowserWaitError } from "./browserWait.js";
import type { Frame } from "./frame.js";
import { runWithProgress } from "./progress.js";

export type FunctionWaitOptions = {
  /** Browser animation frames by default, or a positive interval in milliseconds. */
  polling?: "raf" | number;
  /** Milliseconds for the whole wait. Zero disables the deadline. */
  timeout?: number;
};

/** Runs in the page's main world; keep this function self-contained. */
export function createFunctionWait(predicate: () => unknown, polling: "raf" | number) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let animationFrame: number | undefined;
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  // Installation and awaiting use separate CDP commands. Observe early rejection.
  void promise.catch(() => {});

  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
  };
  const poll = async () => {
    if (stopped) return;
    try {
      const value = await predicate();
      if (stopped) return;
      if (value) {
        // Return a detached JSON value, never a remote browser handle.
        const serialized = JSON.stringify(value);
        if (serialized === undefined)
          throw new TypeError("waitForFunction result must be JSON-serializable");
        const result: unknown = JSON.parse(serialized);
        stop();
        resolve(result);
      } else if (polling === "raf") {
        animationFrame = requestAnimationFrame(() => void poll());
      } else {
        timer = setTimeout(() => void poll(), polling);
      }
    } catch (error) {
      stop();
      reject(error);
    }
  };
  void poll();
  return {
    promise,
    dispose() {
      if (stopped) return;
      stop();
      reject(new Error("Function wait disposed"));
    },
  };
}

export async function waitForFunction(
  getFrame: () => Frame,
  expression: string,
  options: FunctionWaitOptions = {},
): Promise<unknown> {
  const polling = options.polling ?? "raf";
  if (polling !== "raf" && (!Number.isFinite(polling) || polling <= 0 || polling > 2_147_483_647)) {
    throw new RangeError("Polling must be 'raf' or a positive interval up to 2147483647ms");
  }
  return runWithProgress(
    { name: "waitForFunction", timeout: options.timeout ?? 30_000 },
    async (progress) => {
      for (;;) {
        progress.throwIfStopped();
        const frame = getFrame();
        try {
          const contextId = await frame.getMainWorldExecutionContextId(progress);
          // Readiness may have outlived the page or its transport.
          getFrame();
          return await browserWait(
            frame.session,
            progress,
            (onLateResult) =>
              progress.run(
                "installing function wait",
                () =>
                  frame.session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
                    expression: `(${createFunctionWait.toString()})(() => (${expression}), ${JSON.stringify(polling)})`,
                    contextId,
                    awaitPromise: false,
                    returnByValue: false,
                  }),
                onLateResult,
              ),
            "waiting for function",
          );
        } catch (error) {
          progress.throwIfStopped();
          if (error instanceof BrowserWaitError) throw error;
          const message = error instanceof Error ? error.message : String(error);
          if (
            !message.includes("Cannot find context with specified id") &&
            !message.includes("Execution context was destroyed") &&
            !message.includes("Cannot find object with given id") &&
            !message.includes("Inspected target navigated or closed") &&
            !message.startsWith("main world not ready for frame ")
          )
            throw error;
          // Let context-destruction events update the registry before reinstalling.
          await progress.delay(25);
        }
      }
    },
  );
}
