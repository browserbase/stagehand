import {
  StagehandMethods,
  StagehandNotifications,
} from "@browserbasehq/stagehand-protocol/schema-registry";
import { createDecisionChooseResultSchema } from "@browserbasehq/stagehand-protocol/schemas";
import type {
  DecisionChooseParams,
  DecisionChooseResult,
} from "@browserbasehq/stagehand-protocol/types";
import type { RPCClient } from "./rpcClient.js";

export type DecisionContext = {
  readonly signal: AbortSignal;
  /** Remaining milliseconds, or Infinity when the operation has no deadline. */
  remainingMs(): number;
};

/** Internal registration boundary; Stagehand owns configuration and teardown. */
export function registerDecisionHandler(
  client: RPCClient,
  choose: (
    params: DecisionChooseParams,
    context: DecisionContext & { readonly requestId: number },
  ) => DecisionChooseResult | Promise<DecisionChooseResult>,
): () => void {
  const pending = new Map<number, AbortController>();
  const removeRequest = client.onRequest(
    StagehandMethods.decisionChoose,
    async (params, context) => {
      if (pending.has(context.requestId)) throw new Error("Decision request ID is already in use");
      // Snapshot allowed IDs before application code can mutate its request object.
      const resultSchema = createDecisionChooseResultSchema(params);
      const controller = new AbortController();
      pending.set(context.requestId, controller);
      const signal = AbortSignal.any([context.signal, controller.signal]);
      const deadline =
        params.timeoutMs === undefined ? Infinity : performance.now() + params.timeoutMs;
      const remainingMs = () => Math.max(0, deadline - performance.now());
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expire = () => {
        if (remainingMs() === 0)
          controller.abort(new DOMException("Decision timed out", "TimeoutError"));
        else if (deadline !== Infinity)
          timer = setTimeout(expire, Math.min(2_147_483_647, Math.ceil(remainingMs())));
      };
      const check = () => {
        if (remainingMs() === 0)
          controller.abort(new DOMException("Decision timed out", "TimeoutError"));
        signal.throwIfAborted();
      };
      let onAbort: (() => void) | undefined;
      try {
        expire();
        check();
        const stopped = new Promise<never>((_, reject) => {
          onAbort = () => reject(signal.reason);
          signal.addEventListener("abort", onAbort, { once: true });
        });
        const work = Promise.resolve().then(() => {
          check();
          return choose(params, { requestId: context.requestId, signal, remainingMs });
        });
        const result = await Promise.race([work, stopped]);
        check();
        return resultSchema.parse(result);
      } finally {
        clearTimeout(timer);
        if (onAbort) signal.removeEventListener("abort", onAbort);
        pending.delete(context.requestId);
      }
    },
  );
  const removeNotification = client.onNotification((notification) => {
    if (notification.method !== StagehandNotifications.decisionCancel.name) return;
    const { requestId, reason } = notification.params;
    pending
      .get(requestId)
      ?.abort(
        new DOMException(
          reason === "timeout" ? "Decision timed out" : "Decision cancelled",
          reason === "timeout" ? "TimeoutError" : "AbortError",
        ),
      );
  });
  return () => {
    removeRequest();
    removeNotification();
    for (const controller of pending.values()) controller.abort();
    pending.clear();
  };
}
