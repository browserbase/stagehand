import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Protocol } from "devtools-protocol";
import type { LocatorChain } from "@browserbasehq/stagehand-protocol/types";
import { TimeoutError } from "../errors.js";
import type { CDPSessionLike } from "./cdp.js";
import { executionContexts } from "./executionContextRegistry.js";
import type { Frame } from "./frame.js";
import { FrameChainResolver } from "./frameChainResolver.js";
import { FrameRegistry } from "./frameRegistry.js";
import type { Page } from "./page.js";
import { Progress } from "./progress.js";

const chain: LocatorChain = {
  steps: [
    { type: "query", selector: { kind: "css", value: "iframe" } },
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

describe("frame chain deadlines & ownership", () => {
  const progresses: Progress[] = [];
  function progress(timeout = 100) {
    const value = new Progress("frame chain", timeout);
    progresses.push(value);
    return value;
  }
  beforeEach(() =>
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] }),
  );
  afterEach(async () => {
    progresses.splice(0).forEach((value) => value.dispose());
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function setup() {
    function session(id: string) {
      const live = new Set<string>();
      let group = "";
      const respond = async (method: string, params?: object): Promise<unknown> => {
        const p = params as {
          objectGroup?: string;
          objectId?: string;
          functionDeclaration?: string;
          arguments?: { value: unknown }[];
          frameId?: string;
        };
        if (p?.objectGroup) {
          group = p.objectGroup;
          live.add(group);
        }
        if (method === "Runtime.evaluate") return { result: { objectId: `${id}-world` } };
        if (method === "Runtime.callFunctionOn") {
          if (p.functionDeclaration?.includes("this.query(")) {
            return {
              result: {
                value:
                  id === "main"
                    ? [[{ id: 1, isFrame: true }]]
                    : [
                        [
                          { id: 1, isFrame: false },
                          { id: 2, isFrame: false },
                        ],
                      ],
              },
            };
          }
          if (p.functionDeclaration?.includes("return this.elements(")) {
            return {
              result: { objectId: `array:${(p.arguments![0].value as number[]).join(",")}` },
            };
          }
          return { result: {} };
        }
        if (method === "Runtime.getProperties")
          return {
            result: p
              .objectId!.slice(6)
              .split(",")
              .map((value, i) => ({ name: String(i), value: { objectId: `node:${value}` } })),
          };
        if (method === "DOM.describeNode")
          return {
            node: { backendNodeId: (id === "main" ? 100 : 200) + Number(p.objectId!.slice(5)) },
          };
        if (method === "DOM.getFrameOwner")
          return { backendNodeId: p.frameId === "child" ? 101 : 999 };
        if (method === "Runtime.releaseObjectGroup") live.delete(p.objectGroup!);
        return {};
      };
      const send = vi.fn(respond);
      const value: CDPSessionLike = {
        id,
        send: send as CDPSessionLike["send"],
        on() {},
        off() {},
        async close() {},
      };
      return { value, send, respond, live, allocateLate: () => live.add(group) };
    }
    const main = session("main"),
      child = session("child"),
      replacement = session("replacement");
    let childOwner = child.value;
    const registry = new FrameRegistry("page", "main");
    registry.onFrameAttached("main", null, "main");
    registry.onFrameAttached("child", "main", "child");
    const root = { session: main.value, frameId: "main" } as Frame;
    const page = {
      registry,
      mainFrame: () => root,
      getSessionForFrame: (frameId: string) => (frameId === "main" ? main.value : childOwner),
      getFullFrameTree: () => registry.asProtocolFrameTree("main"),
    } as unknown as Page;
    const ready = vi
      .spyOn(executionContexts, "waitForLocatorWorld")
      .mockImplementation(async (_session, frameId) => ({
        contextId: frameId === "main" ? 1 : 2,
        kind: "extension",
        capabilities: { closedShadowRoots: true },
      }));
    return {
      main,
      child,
      replacement,
      registry,
      page,
      ready,
      resolver: new FrameChainResolver(page),
      adopt: () => {
        childOwner = replacement.value;
      },
    };
  }

  it("retries discovery when a sibling is registered before the selected frame", async () => {
    const state = setup();
    state.registry.onFrameDetached("child");
    state.registry.onFrameAttached("sibling", "main", "main");
    const pending = state.resolver.resolve(chain, { mode: "count" }, progress(500));
    await vi.advanceTimersByTimeAsync(150);
    state.registry.onFrameAttached("child", "main", "child");
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toEqual({ mode: "count", count: 2 });
    expect(state.main.live.size + state.child.live.size).toBe(0);
  });

  it.each([undefined, 0, 100])(
    "bounds missing-frame discovery with timeout %s",
    async (timeout) => {
      const state = setup();
      state.registry.onFrameDetached("child");
      let failure: unknown;
      const pending = state.resolver
        .resolve(chain, { mode: "count" }, timeout === undefined ? undefined : progress(timeout))
        .catch((error) => {
          failure = error;
        });
      await vi.advanceTimersByTimeAsync(timeout === 100 ? 100 : 1100);
      expect(failure).toBeInstanceOf(timeout === 100 ? TimeoutError : Error);
      if (timeout !== 100)
        expect((failure as Error).message).toContain("Unable to obtain a content frame");
      await pending;
      expect(state.main.live.size).toBe(0);
    },
  );

  it.each([undefined, 0, 100])(
    "bounds unavailable child readiness with timeout %s",
    async (timeout) => {
      const state = setup();
      state.ready.mockImplementation(async (_session, frameId) => {
        if (frameId === "child") throw new Error("world unavailable");
        return { contextId: 1, kind: "extension", capabilities: { closedShadowRoots: true } };
      });
      let failure: unknown;
      const pending = state.resolver
        .resolve(chain, { mode: "count" }, timeout === undefined ? undefined : progress(timeout))
        .catch((error) => {
          failure = error;
        });
      await vi.advanceTimersByTimeAsync(100);
      expect(failure).toBeInstanceOf(timeout === 100 ? TimeoutError : Error);
      if (timeout !== 100) expect(state.ready).toHaveBeenCalledTimes(2);
      await pending;
      expect(state.main.live.size).toBe(0);
    },
  );

  it("honors readinessRetries none for discovery & readiness with a finite deadline", async () => {
    for (const phase of ["discovery", "readiness"]) {
      const state = setup();
      if (phase === "discovery") state.registry.onFrameDetached("child");
      else state.ready.mockRejectedValueOnce(new Error("world unavailable"));
      await expect(
        new FrameChainResolver(state.page, undefined, { readinessRetries: "none" }).resolve(
          chain,
          { mode: "count" },
          progress(1000),
        ),
      ).rejects.toThrow(
        phase === "discovery" ? "Unable to obtain a content frame" : "world unavailable",
      );
      expect(state.main.live.size).toBe(0);
      state.ready.mockRestore();
    }
  });

  it("rechecks session ownership during readiness before retaining child matches", async () => {
    const state = setup();
    state.ready.mockImplementation(async (session) => {
      if (session === state.child.value) {
        state.adopt();
        throw new Error("No Page found for target closed before CDP command");
      }
      return { contextId: 1, kind: "extension", capabilities: { closedShadowRoots: true } };
    });
    const pending = state.resolver.resolve(chain, { mode: "selected", index: 1 }, progress(500));
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toEqual({
      mode: "selected",
      targets: [{ session: state.replacement.value, frameId: "child", backendNodeId: 202 }],
    });
    expect(state.child.send).not.toHaveBeenCalled();
    expect(state.main.live.size + state.replacement.live.size).toBe(0);
  });

  it("rejects an ownership change after collection & cleans the original sessions", async () => {
    const state = setup();
    state.child.send.mockImplementation(async (method, params) => {
      const result = await state.child.respond(method, params);
      if (method === "Runtime.callFunctionOn") state.adopt();
      return result;
    });
    await expect(state.resolver.resolve(chain, { mode: "count" })).rejects.toThrow(
      "Chain frame changed",
    );
    expect(state.main.live.size + state.child.live.size).toBe(0);
    expect(state.replacement.send).not.toHaveBeenCalled();
  });

  it("stops readiness when the frame detaches", async () => {
    const state = setup();
    state.ready.mockImplementation(async (_session, frameId) => {
      if (frameId === "child") {
        state.registry.onFrameDetached("child");
        throw new Error("world gone");
      }
      return { contextId: 1, kind: "extension", capabilities: { closedShadowRoots: true } };
    });
    await expect(state.resolver.resolve(chain, { mode: "count" }, progress())).rejects.toThrow(
      "Chain frame detached",
    );
    expect(state.main.live.size).toBe(0);
  });

  it("rejects a navigation while materializing final targets", async () => {
    const state = setup();
    state.child.send.mockImplementation(async (method, params) => {
      const result = await state.child.respond(method, params);
      if (method === "DOM.describeNode")
        state.registry.frames.get("child")!.lastSeen = { loaderId: "new" } as Protocol.Page.Frame;
      return result;
    });
    await expect(state.resolver.resolve(chain, { mode: "all" })).rejects.toThrow(
      "Chain frame changed",
    );
    expect(state.main.live.size + state.child.live.size).toBe(0);
  });

  it.each([
    "Runtime.evaluate",
    "Runtime.callFunctionOn",
    "Runtime.getProperties",
    "DOM.describeNode",
  ])("cleans late success & rejection after timeout in %s", async (phase) => {
    for (const reject of [false, true]) {
      const state = setup();
      const gate = deferred();
      let lateParams: object | undefined;
      state.child.send.mockImplementation(async (method, params) => {
        if (method === phase) {
          lateParams = params;
          return gate.promise;
        }
        return state.child.respond(method, params);
      });
      const pending = state.resolver.resolve(chain, { mode: "selected", index: 0 }, progress());
      const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);
      await vi.advanceTimersByTimeAsync(100);
      await assertion;
      expect(lateParams).toBeDefined();
      expect(state.main.live.size + state.child.live.size).toBe(0);
      const late = await state.child.respond(phase, lateParams);
      state.child.allocateLate();
      if (reject) gate.reject(new Error("late failure"));
      else gate.resolve(late);
      await vi.advanceTimersByTimeAsync(0);
      expect(state.main.live.size + state.child.live.size).toBe(0);
      state.ready.mockRestore();
    }
  });

  it("uses one deadline across readiness & queries in both sessions", async () => {
    const state = setup();
    state.ready.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { contextId: 1, kind: "extension", capabilities: { closedShadowRoots: true } };
    });
    state.child.send.mockImplementation(async (method, params) => {
      if (method === "Runtime.callFunctionOn")
        await new Promise((resolve) => setTimeout(resolve, 40));
      return state.child.respond(method, params);
    });
    const pending = state.resolver.resolve(chain, { mode: "count" }, progress());
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    await vi.advanceTimersByTimeAsync(20);
    expect(state.main.live.size + state.child.live.size).toBe(0);
  });

  it("cancels a pending child command & preserves the caller's error", async () => {
    const state = setup();
    const gate = deferred(),
      operation = progress(0);
    state.child.send.mockImplementation(async (method, params) =>
      method === "Runtime.callFunctionOn" ? gate.promise : state.child.respond(method, params),
    );
    const controller = new AbortController();
    vi.spyOn(operation, "signal", "get").mockReturnValue(controller.signal);
    const failure = new Error("caller canceled");
    const pending = state.resolver.resolve(chain, { mode: "all" }, operation);
    const assertion = expect(pending).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(failure);
    await assertion;
    gate.reject(new Error("late child error"));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.main.live.size + state.child.live.size).toBe(0);
  });
  it.each(["complete", "failure", "timeout"])(
    "bounds final descriptions & preserves order on %s",
    async (outcome) => {
      const state = setup();
      const gates = Array.from({ length: 9 }, deferred);
      const started: number[] = [];
      state.child.send.mockImplementation(async (method, params) => {
        if (
          method === "Runtime.callFunctionOn" &&
          (params as { functionDeclaration: string }).functionDeclaration.includes("this.query(")
        ) {
          return { result: { value: [gates.map((_, id) => ({ id, isFrame: false }))] } };
        }
        if (method === "Runtime.getProperties")
          return {
            result: gates
              .map((_, id) => ({ name: String(id), value: { objectId: String(id) } }))
              .reverse(),
          };
        if (method === "DOM.describeNode") {
          const index = Number((params as { objectId: string }).objectId);
          started.push(index);
          return gates[index].promise;
        }
        return state.child.respond(method, params);
      });
      const pending = state.resolver.resolve(chain, { mode: "all" }, progress());
      const failure = new Error("describe failed");
      const assertion =
        outcome === "complete"
          ? undefined
          : expect(pending).rejects.toThrow(outcome === "failure" ? failure.message : /timed out/i);
      await vi.advanceTimersByTimeAsync(0);
      expect(started).toEqual([0, 1, 2, 3]);
      if (outcome === "complete") {
        // Finish the initial workers in reverse order; each can schedule only one successor.
        for (const index of [3, 2, 1, 0, 7, 6, 5, 4, 8]) {
          gates[index].resolve({ node: { backendNodeId: 200 + index } });
          await vi.advanceTimersByTimeAsync(0);
        }
        const result = await pending;
        expect(result.mode).toBe("all");
        if (result.mode !== "count")
          expect(result.targets.map((target) => target.backendNodeId)).toEqual(
            gates.map((_, i) => 200 + i),
          );
      } else {
        if (outcome === "failure") gates[0].reject(failure);
        else await vi.advanceTimersByTimeAsync(100);
        await assertion;
        expect(started).toEqual([0, 1, 2, 3]);
        for (const gate of gates) gate.resolve({ node: { backendNodeId: 200 } });
        await vi.advanceTimersByTimeAsync(0);
        expect(started).toEqual([0, 1, 2, 3]);
      }
      expect(state.main.live.size + state.child.live.size).toBe(0);
    },
  );

  it("cleans other sessions even when one cleanup stalls & preserves query errors", async () => {
    const state = setup();
    const cleanup = deferred();
    state.main.send.mockImplementation(async (method, params) =>
      method === "Runtime.releaseObjectGroup"
        ? cleanup.promise
        : state.main.respond(method, params),
    );
    state.child.send.mockImplementation(async (method, params) => {
      if (method === "Runtime.callFunctionOn")
        return { exceptionDetails: { text: "invalid selector" } };
      return state.child.respond(method, params);
    });
    const pending = state.resolver.resolve(chain, { mode: "count" });
    const assertion = expect(pending).rejects.toThrow("invalid selector");
    await vi.advanceTimersByTimeAsync(0);
    expect(state.child.live.size).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    cleanup.resolve({});
  });
});
