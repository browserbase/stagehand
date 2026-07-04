import type { CDPSessionLike } from "./cdp.js";

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
    await session.send("Runtime.evaluate", {
      expression: INPUT_SETTLE_EXPRESSION,
      awaitPromise: true,
      returnByValue: true,
    });
  } catch (error) {
    if (isTransientSettleFailure(error)) return;
    throw error;
  }
}

function isTransientSettleFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Cannot find context|Execution context was destroyed|Target closed|Session closed|Inspected target navigated/i.test(
    message,
  );
}
