import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp.js";
import type { Progress } from "./progress.js";

/** Browser exceptions are not transient CDP context-loss errors. */
export class BrowserWaitError extends Error {}

/** Own a browser-side promise and dispose its resources, even after late installation. */
export async function browserWait<T>(
  session: CDPSessionLike,
  progress: Progress,
  install: (
    onLateResult: (response: Protocol.Runtime.EvaluateResponse) => Promise<unknown>,
  ) => Promise<Protocol.Runtime.EvaluateResponse>,
  phase: string,
): Promise<T> {
  const dispose = (objectId: string) =>
    Promise.all([
      progress.cleanup(() =>
        session.send("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: "function() { this.dispose(); }",
          returnByValue: true,
        }),
      ),
      progress.cleanup(() => session.send("Runtime.releaseObject", { objectId })),
    ]);
  const response = await install(async (late) => {
    if (late.result.objectId) await dispose(late.result.objectId);
  });
  const objectId = response.result.objectId;
  let completed = false;
  try {
    if (response.exceptionDetails || !objectId) {
      throw new BrowserWaitError(
        response.exceptionDetails?.exception?.description ??
          response.exceptionDetails?.text ??
          "Browser wait handle was not returned",
      );
    }
    const result = await progress.run(phase, () =>
      session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: "function() { return this.promise; }",
        awaitPromise: true,
        returnByValue: true,
      }),
    );
    if (result.exceptionDetails) {
      throw new BrowserWaitError(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          "Browser wait failed",
      );
    }
    completed = true;
    return result.result.value as T;
  } finally {
    if (objectId) {
      if (completed) {
        void progress.cleanup(() => session.send("Runtime.releaseObject", { objectId }));
      } else {
        await dispose(objectId);
      }
    }
  }
}
