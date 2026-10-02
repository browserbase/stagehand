import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "../../cdp.js";
import { executionContexts } from "../../executionContextRegistry.js";
import { Progress } from "../../progress.js";
import { resolveObjectIdForCss, resolveObjectIdForXPath } from "./focusSelectors.js";

describe("snapshot focus resolution", () => {
  let progress: Progress;
  let waitForWorld: MockInstance;
  beforeEach(() => {
    vi.useFakeTimers();
    progress = new Progress("snapshot", 10);
    waitForWorld = vi.spyOn(executionContexts, "waitForLocatorWorld").mockResolvedValue({
      contextId: 1,
      kind: "extension",
      capabilities: { closedShadowRoots: true },
    });
  });
  afterEach(() => {
    progress.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ["css", resolveObjectIdForCss],
    ["xpath", resolveObjectIdForXPath],
  ] as const)("releases a late %s reference using the caller's deadline", async (_, resolve) => {
    let respond!: (value: Protocol.Runtime.EvaluateResponse) => void;
    const response = new Promise<Protocol.Runtime.EvaluateResponse>((done) => {
      respond = done;
    });
    const send = vi.fn(async (method: string) => (method === "Runtime.evaluate" ? response : {}));
    const session = { send } as unknown as CDPSessionLike;
    const read = resolve(session, "selector", "frame", 0, progress);
    const timedOut = expect(read).rejects.toThrow(/snapshot timed out/);
    await vi.advanceTimersByTimeAsync(10);
    await timedOut;
    expect(waitForWorld).toHaveBeenCalledWith(session, "frame", 800, progress, {
      readinessRetries: "none",
    });
    respond({ result: { type: "object", objectId: "late-node" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith("Runtime.releaseObject", { objectId: "late-node" });
  });
});
