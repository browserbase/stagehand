import type { Protocol } from "devtools-protocol";
import type { PageWaitForFunctionParams } from "@browserbasehq/stagehand-protocol/types";
import { browserWait, BrowserWaitError } from "./browserWait.js";
import type { Frame } from "./frame.js";
import { runWithProgress } from "./progress.js";

export type FunctionWaitOptions = NonNullable<PageWaitForFunctionParams["options"]>;

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
  void promise.catch(() => {});

  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
  };
  const poll = async () => {
    if (stopped) return;
    try {
      const evaluated = predicate();
      const value = await (typeof evaluated === "function" ? evaluated() : evaluated);
      if (stopped) return;
      if (value) {
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
    { name: "waitForFunction", timeout: options.timeout ?? 0 },
    async (progress) => {
      for (;;) {
        progress.throwIfStopped();
        const frame = getFrame();
        try {
          const contextId = await frame.getMainWorldExecutionContextId(progress);
          if (getFrame() !== frame) continue;
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
          await progress.delay(25);
        }
      }
    },
  );
}
