import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp.js";
import { StagehandEvalError } from "../types/public/sdkErrors.js";

const INPUT_SETTLE_EXPRESSION = `new Promise((resolve) => {
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    resolve(true);
  };
  const nextTask = () => setTimeout(finish, 0);

  if (
    typeof requestAnimationFrame === "function" &&
    typeof document !== "undefined" &&
    document.visibilityState !== "hidden"
  ) {
    requestAnimationFrame(() => requestAnimationFrame(nextTask));
    setTimeout(finish, 100);
  } else {
    nextTask();
  }
})`;

export async function waitForInputEventsToSettle(
  session: CDPSessionLike,
): Promise<void> {
  try {
    const response = await session.send<Protocol.Runtime.EvaluateResponse>(
      "Runtime.evaluate",
      {
        expression: INPUT_SETTLE_EXPRESSION,
        awaitPromise: true,
        returnByValue: true,
      },
    );

    if (response.exceptionDetails) {
      const error = new StagehandEvalError(
        `Input settling failed: ${formatExceptionDetails(response.exceptionDetails)}`,
      );
      if (isTransientSettleFailure(error)) return;
      throw error;
    }
  } catch (error) {
    if (isTransientSettleFailure(error)) return;
    throw error;
  }
}

export async function waitForInputEventsToSettleInSessions(
  sessions: Iterable<CDPSessionLike>,
): Promise<void> {
  await Promise.all(
    [...new Set(sessions)].map((session) =>
      waitForInputEventsToSettle(session),
    ),
  );
}

function isTransientSettleFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Cannot find context|Execution context was destroyed|Target closed|Session closed|Inspected target navigated|Session with given id not found|No session with given id|target closed before CDP (?:response|send)|No target with given id found/i.test(
    message,
  );
}

function formatExceptionDetails(
  details: Protocol.Runtime.ExceptionDetails,
): string {
  return (
    details.exception?.description ??
    details.exception?.value?.toString() ??
    details.text ??
    "Runtime.evaluate failed"
  );
}
