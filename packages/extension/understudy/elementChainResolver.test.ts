import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocatorChain } from "@browserbasehq/stagehand-protocol/types";
import type { CDPSessionLike } from "./cdp.js";
import type { Frame } from "./frame.js";
import { executionContexts } from "./executionContextRegistry.js";
import { FrameElementChainResolver } from "./elementChainResolver.js";
import { Progress } from "./progress.js";
import { TimeoutError } from "../errors.js";

const chain: LocatorChain = {
  steps: [
    { type: "query", selector: { kind: "css", value: ".card" } },
    { type: "query", selector: { kind: "css", value: "button" } },
  ],
};
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("element chain result ownership", () => {
  const progresses: Progress[] = [];
  const progress = (timeout = 100) => {
    const value = new Progress("chain", timeout);
    progresses.push(value);
    return value;
  };
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));
  afterEach(() => {
    progresses.splice(0).forEach((value) => value.dispose());
    expect(vi.getTimerCount()).toBe(0);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function setup() {
    const liveGroups = new Set<string>();
    let group: string;
    const respond = async (method: string, params?: object): Promise<unknown> => {
      if (method === "Runtime.evaluate") {
        group = (params as { objectGroup: string }).objectGroup;
        liveGroups.add(group);
        return { result: { objectId: "array", type: "object" } };
      }
      if (method === "Runtime.getProperties")
        return {
          result: [
            { name: "1", value: { objectId: "b" } },
            { name: "length", value: { value: 2 } },
            { name: "0", value: { objectId: "a" } },
          ],
        };
      if (method === "DOM.describeNode")
        return {
          node: { backendNodeId: (params as { objectId: string }).objectId === "a" ? 11 : 12 },
        };
      if (method === "Runtime.releaseObjectGroup")
        liveGroups.delete((params as { objectGroup: string }).objectGroup);
      return {};
    };
    const send = vi.fn(respond);
    const session: CDPSessionLike = {
      id: "session",
      send: send as CDPSessionLike["send"],
      on() {},
      off() {},
      async close() {},
    };
    const frame = { session, frameId: "frame" } as Frame;
    const ready = vi.spyOn(executionContexts, "waitForLocatorWorld").mockResolvedValue({
      contextId: 5,
      kind: "extension",
      capabilities: { closedShadowRoots: true },
    });
    return {
      resolver: new FrameElementChainResolver(frame),
      frame,
      session,
      send,
      respond,
      ready,
      liveGroups,
      allocateLate: () => liveGroups.add(group),
    };
  }

  it.each([
    { name: "omitted progress", timeout: undefined, retries: undefined, attempts: 1 },
    { name: "unlimited progress", timeout: 0, retries: undefined, attempts: 1 },
    { name: "explicit single attempt", timeout: 2500, retries: "none" as const, attempts: 1 },
    { name: "finite caller deadline", timeout: 2500, retries: undefined, attempts: 3 },
  ])(
    "bounds real unavailable-world readiness with $name",
    async ({ timeout, retries, attempts }) => {
      const { frame, session, send, ready, liveGroups } = setup();
      ready.mockRestore();
      // Exercise the actual retry loop on a non-fallback page with no extension world.
      executionContexts.register(session, "frame", 1);
      const probe = vi.spyOn(executionContexts, "waitForExtensionWorld");
      send.mockImplementation(async (method) =>
        method === "Runtime.evaluate" ? { result: { value: "https:" } } : {},
      );
      const resolver = new FrameElementChainResolver(frame, { readinessRetries: retries });
      let failure: unknown;
      const pending = resolver
        .resolve(chain, { mode: "count" }, timeout === undefined ? undefined : progress(timeout))
        .catch((error) => {
          failure = error;
        });
      await vi.advanceTimersByTimeAsync(attempts === 1 ? 1100 : 2500);
      expect(failure).toBeInstanceOf(attempts === 1 ? Error : TimeoutError);
      if (attempts === 1) expect((failure as Error).message).toContain("extension world not ready");
      expect(probe).toHaveBeenCalledTimes(attempts);
      await pending;
      expect(liveGroups.size).toBe(0);
      expect(send.mock.calls.some(([method]) => method === "Page.createIsolatedWorld")).toBe(false);
      expect(
        send.mock.calls.some(
          ([method, params]) => method === "Runtime.evaluate" && "objectGroup" in (params ?? {}),
        ),
      ).toBe(false);
    },
  );

  function setupDescriptions() {
    const state = setup();
    const gates = Array.from({ length: 9 }, deferred);
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    state.send.mockImplementation(async (method, params) => {
      if (method === "Runtime.getProperties")
        return {
          result: gates
            .map((_, index) => ({
              name: String(index),
              value: { objectId: String(index) },
            }))
            .reverse(),
        };
      if (method !== "DOM.describeNode") return state.respond(method, params);
      const index = Number((params as { objectId: string }).objectId);
      started.push(index);
      active++;
      peak = Math.max(peak, active);
      try {
        return await gates[index].promise;
      } finally {
        active--;
      }
    });
    return { ...state, gates, started, peak: () => peak };
  }

  it("describes at most four targets concurrently & preserves order when replies arrive out of order", async () => {
    const { resolver, session, gates, started, peak, liveGroups } = setupDescriptions();
    const pending = resolver.resolve(chain, { mode: "all" });
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([0, 1, 2, 3]);
    for (const index of [3, 4, 2, 5, 1, 6, 0, 7]) {
      gates[index].resolve({ node: { backendNodeId: index + 100 } });
      await vi.advanceTimersByTimeAsync(0);
      expect(liveGroups.size).toBe(1);
    }
    gates[8].resolve({ node: { backendNodeId: 108 } });
    await expect(pending).resolves.toEqual({
      mode: "all",
      targets: gates.map((_, index) => ({
        session,
        frameId: "frame",
        backendNodeId: index + 100,
      })),
    });
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(peak()).toBe(4);
    expect(liveGroups.size).toBe(0);
  });

  it.each(["failure", "timeout", "cancellation"] as const)(
    "stops the description pool on %s without waiting for stalled requests",
    async (outcome) => {
      const { resolver, gates, started, liveGroups } = setupDescriptions();
      const context = progress(outcome === "timeout" ? 100 : 0);
      const controller = new AbortController();
      if (outcome === "cancellation")
        vi.spyOn(context, "signal", "get").mockReturnValue(controller.signal);
      const reason = new Error("stop descriptions");
      const rejected = expect(resolver.resolve(chain, { mode: "all" }, context)).rejects;
      const assertion =
        outcome === "timeout" ? rejected.toThrow(TimeoutError) : rejected.toBe(reason);
      await vi.advanceTimersByTimeAsync(0);
      expect(started).toEqual([0, 1, 2, 3]);
      if (outcome === "failure") gates[1].reject(reason);
      else if (outcome === "cancellation") controller.abort(reason);
      else await vi.advanceTimersByTimeAsync(100);
      await assertion;
      expect(liveGroups.size).toBe(0);
      // Responses from the other in-flight commands cannot restart scheduling,
      // publish a partial result, or cause an unhandled rejection.
      gates[0].resolve({ node: { backendNodeId: 100 } });
      gates[1].resolve({ node: { backendNodeId: 101 } });
      gates[2].reject(new Error("late session closure"));
      gates[3].resolve({ node: { backendNodeId: 103 } });
      await vi.advanceTimersByTimeAsync(0);
      expect(started).toEqual([0, 1, 2, 3]);
      expect(liveGroups.size).toBe(0);
    },
  );

  it("materializes ordered targets before releasing their handles", async () => {
    const { resolver, session, send, liveGroups } = setup();
    await expect(resolver.resolve(chain, { mode: "all" })).resolves.toEqual({
      mode: "all",
      targets: [
        { session, frameId: "frame", backendNodeId: 11 },
        { session, frameId: "frame", backendNodeId: 12 },
      ],
    });
    expect(send.mock.calls.map(([method]) => method)).toEqual([
      "Runtime.evaluate",
      "Runtime.getProperties",
      "DOM.describeNode",
      "DOM.describeNode",
      "Runtime.releaseObjectGroup",
    ]);
    expect(liveGroups.size).toBe(0);
  });

  it("uses the same deadline for readiness, evaluation, export, and materialization", async () => {
    const { resolver, ready, send, respond, liveGroups } = setup();
    const context = progress();
    ready.mockImplementation(async () => {
      await context.delay(70);
      return { contextId: 5, kind: "extension", capabilities: { closedShadowRoots: true } };
    });
    const gate = deferred();
    send.mockImplementation((method, params) =>
      method === "DOM.describeNode" ? gate.promise : respond(method, params),
    );
    const rejected = expect(resolver.resolve(chain, { mode: "all" }, context)).rejects.toThrow(
      TimeoutError,
    );
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(ready).toHaveBeenCalledWith(expect.anything(), "frame", 1000, context, {});
    gate.resolve({ node: { backendNodeId: 11 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls.filter(([method]) => method === "DOM.describeNode")).toHaveLength(2);
    expect(liveGroups.size).toBe(0);
  });

  it("stops at readiness without allocating a group", async () => {
    const { resolver, ready, send } = setup();
    const gate = deferred();
    ready.mockImplementation(
      () => gate.promise as ReturnType<typeof executionContexts.waitForLocatorWorld>,
    );
    const rejected = expect(resolver.resolve(chain, { mode: "count" }, progress())).rejects.toThrow(
      TimeoutError,
    );
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    gate.resolve({ contextId: 5 });
    await vi.advanceTimersByTimeAsync(0);
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["Runtime.evaluate", "Runtime.getProperties"])(
    "releases handles from late %s success and rejection",
    async (command) => {
      for (const reject of [false, true]) {
        const { resolver, send, respond, liveGroups, allocateLate } = setup();
        const gate = deferred();
        let response: unknown;
        send.mockImplementation(async (method, params) => {
          const value = await respond(method, params);
          if (method !== command) return value;
          response = value;
          return gate.promise;
        });
        const rejected = expect(
          resolver.resolve(chain, { mode: "all" }, progress()),
        ).rejects.toThrow(TimeoutError);
        await vi.advanceTimersByTimeAsync(100);
        await rejected;
        expect(liveGroups.size).toBe(0);
        allocateLate();
        if (reject) gate.reject(new Error("late command failed after allocating handles"));
        else gate.resolve(response);
        await vi.advanceTimersByTimeAsync(0);
        expect(liveGroups.size).toBe(0);
        expect(
          send.mock.calls.filter(([method]) => method === "Runtime.releaseObjectGroup"),
        ).toHaveLength(2);
        expect(send.mock.calls.some(([method]) => method === "DOM.describeNode")).toBe(false);
      }
    },
  );

  it.each(["Runtime.evaluate", "Runtime.getProperties", "DOM.describeNode"])(
    "preserves %s failures and cleans up the original session",
    async (command) => {
      const { resolver, frame, send, respond, liveGroups } = setup();
      const newSend = vi.fn();
      const failure = new Error("CDP connection closed: socket-close");
      send.mockImplementation(async (method, params) => {
        const value = await respond(method, params);
        if (method === command) {
          Object.defineProperty(frame, "session", { value: { send: newSend } });
          throw failure;
        }
        return value;
      });
      await expect(resolver.resolve(chain, { mode: "all" })).rejects.toBe(failure);
      expect(liveGroups.size).toBe(0);
      expect(newSend).not.toHaveBeenCalled();
    },
  );

  it.each(["Runtime.evaluate", "Runtime.getProperties"])(
    "preserves page exceptions in %s rather than returning no matches",
    async (command) => {
      const { resolver, send, respond, liveGroups } = setup();
      send.mockImplementation(async (method, params) => {
        const response = (await respond(method, params)) as object;
        return method === command
          ? {
              ...response,
              exceptionDetails: {
                text: "Uncaught",
                exception: { description: "Frame entry is not supported" },
              },
            }
          : response;
      });
      await expect(resolver.resolve(chain, { mode: "all" })).rejects.toThrow(
        "Frame entry is not supported",
      );
      expect(liveGroups.size).toBe(0);
    },
  );

  it("bounds stalled cleanup and rejects if cleanup crosses the deadline", async () => {
    const { resolver, send, respond } = setup();
    const gate = deferred();
    send.mockImplementation((method, params) =>
      method === "Runtime.releaseObjectGroup" ? gate.promise : respond(method, params),
    );
    const rejected = expect(resolver.resolve(chain, { mode: "all" }, progress())).rejects.toThrow(
      TimeoutError,
    );
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    await vi.advanceTimersByTimeAsync(1000);
    gate.resolve({});
    await vi.advanceTimersByTimeAsync(0);
  });

  it("checks expiry after cleanup even before the timer fires", async () => {
    const { resolver, send, respond } = setup();
    const context = progress();
    send.mockImplementation((method, params) => {
      if (method === "Runtime.releaseObjectGroup") {
        vi.spyOn(performance, "now").mockReturnValue(101);
        expect(context.signal.aborted).toBe(false);
      }
      return respond(method, params);
    });
    await expect(resolver.resolve(chain, { mode: "all" }, context)).rejects.toThrow(TimeoutError);
  });

  it("does not replace a resolution error with a cleanup error", async () => {
    const { resolver, send, respond } = setup();
    const failure = new Error("Cannot find context with specified id");
    send.mockImplementation((method, params) => {
      if (method === "Runtime.getProperties") return Promise.reject(failure);
      if (method === "Runtime.releaseObjectGroup") return Promise.reject(new Error("session gone"));
      return respond(method, params);
    });
    await expect(resolver.resolve(chain, { mode: "all" })).rejects.toBe(failure);
  });

  it("cleans up on cancellation without publishing targets", async () => {
    const { resolver, send, respond, liveGroups } = setup();
    const context = progress(0);
    const controller = new AbortController();
    vi.spyOn(context, "signal", "get").mockReturnValue(controller.signal);
    const reason = new Error("caller cancelled");
    send.mockImplementation(async (method, params) => {
      const result = await respond(method, params);
      if (method === "Runtime.getProperties") controller.abort(reason);
      return result;
    });
    await expect(resolver.resolve(chain, { mode: "all" }, context)).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(liveGroups.size).toBe(0);
    expect(send.mock.calls.some(([method]) => method === "DOM.describeNode")).toBe(false);
  });

  it.each([-1, 0.5, NaN, Infinity])(
    "rejects invalid selected index %s before CDP",
    async (index) => {
      const { resolver, send, ready } = setup();
      await expect(resolver.resolve(chain, { mode: "selected", index })).rejects.toThrow(
        RangeError,
      );
      expect(ready).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    },
  );
});
