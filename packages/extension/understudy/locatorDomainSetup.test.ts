import { describe, expect, it, vi } from "vitest";
import type { StagehandLogger } from "../logger.js";
import { CdpConnection, type CdpWebSocketTransport } from "./cdp.js";
import { executionContexts } from "./executionContextRegistry.js";
import { Frame } from "./frame.js";
import { Progress } from "./progress.js";

type Call = { id: number; method: string; sessionId?: string; params?: object };

function fixture() {
  const calls: Call[] = [];
  const paused = new Set<string>();
  const pending: Call[] = [];
  const failures = new Set<string>();
  const waiters: { method: string; count: number; resolve: () => void }[] = [];
  let receive!: (data: string) => void;
  const respond = (call: Call, error?: string) => {
    const result =
      call.method === "Runtime.evaluate"
        ? { result: { objectId: "node", value: 2 } }
        : call.method === "DOM.requestNode"
          ? { nodeId: 1 }
          : call.method === "Runtime.callFunctionOn"
            ? { result: { value: "hello" } }
            : {};
    receive(
      JSON.stringify({
        id: call.id,
        ...(error ? { error: { code: -32000, message: error } } : { result }),
      }),
    );
  };
  const transport: CdpWebSocketTransport = {
    connected: true,
    send(payload) {
      const call = JSON.parse(payload) as Call;
      calls.push(call);
      for (const waiter of waiters) {
        if (calls.filter(({ method }) => method === waiter.method).length >= waiter.count)
          waiter.resolve();
      }
      if (paused.has(call.method)) pending.push(call);
      else if (failures.delete(call.method)) respond(call, "setup failed");
      else respond(call);
    },
    async close() {},
    onMessage(handler) {
      receive = handler;
    },
    onClose() {},
    onError() {},
  };
  const logger = { debug() {}, error() {} } as unknown as StagehandLogger;
  const connection = new CdpConnection(transport, logger);
  const createFrame = (id = "session") => {
    connection.onMessage(
      JSON.stringify({
        method: "Target.attachedToTarget",
        params: {
          sessionId: id,
          targetInfo: { targetId: `target-${id}` },
        },
      }),
    );
    const session = connection.getSession(id)!;
    executionContexts.register(session, id, 1);
    executionContexts.registerExtensionWorld(session, id, 2);
    return new Frame(session, id, `target-${id}`, false, logger);
  };
  return {
    connection,
    createFrame,
    paused,
    failures,
    count: (method: string, sessionId = "session") =>
      calls.filter((call) => call.method === method && call.sessionId === sessionId).length,
    waitForCall(method: string, count = 1) {
      if (calls.filter((call) => call.method === method).length >= count) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.push({ method, count, resolve }));
    },
    respondAll() {
      for (const call of pending.splice(0)) respond(call);
    },
    respondNext(error?: string) {
      const call = pending.shift();
      if (!call) throw new Error("No pending setup call");
      respond(call, error);
    },
  };
}

describe("locator session domain setup", () => {
  it.each(["count", "inputValue", "locator-world evaluation"])(
    "reuses setup across repeated %s operations",
    async (operation) => {
      const test = fixture();
      const frame = test.createFrame();
      for (let index = 0; index < 3; index++) {
        if (operation === "count") expect(await frame.locator("input").count()).toBe(2);
        else if (operation === "inputValue")
          expect(await frame.locator("input").inputValue()).toBe("hello");
        else expect(await frame.evaluateInLocatorWorld(() => "2")).toBe(2);
      }
      expect(test.count("Runtime.enable")).toBe(1);
      expect(test.count("DOM.enable")).toBe(operation === "locator-world evaluation" ? 0 : 1);
    },
  );

  it("shares setup between concurrent locator operations", async () => {
    const test = fixture();
    const frame = test.createFrame();
    test.paused.add("Runtime.enable");
    const first = frame.locator("input").count();
    const second = frame.locator("button").count();
    await test.waitForCall("Runtime.enable");
    const enables = test.count("Runtime.enable");
    test.paused.clear();
    test.respondAll();
    expect(await Promise.all([first, second])).toEqual([2, 2]);
    expect(enables).toBe(1);
    expect(test.count("DOM.enable")).toBe(1);
  });

  it.each(["Runtime", "DOM"])("retries a failed %s enable", async (domain) => {
    const test = fixture();
    const frame = test.createFrame();
    test.failures.add(`${domain}.enable`);
    await expect(frame.locator("input").count()).rejects.toThrow("setup failed");
    expect(await frame.locator("input").count()).toBe(2);
    expect(test.count(`${domain}.enable`)).toBe(2);
  });

  it.each(["Runtime", "DOM"])("re-enables %s after an explicit raw disable", async (domain) => {
    const test = fixture();
    const frame = test.createFrame();
    await frame.locator("input").count();
    await frame.session.send(`${domain}.disable`);
    await frame.locator("input").count();
    await frame.locator("input").count();
    expect(test.count(`${domain}.disable`)).toBe(1);
    expect(test.count(`${domain}.enable`)).toBe(2);
    expect(test.count(`${domain === "Runtime" ? "DOM" : "Runtime"}.enable`)).toBe(1);
  });

  it("always sends explicit raw enables and then refreshes internal setup", async () => {
    const test = fixture();
    const frame = test.createFrame();
    await frame.locator("input").count();
    await frame.session.send("DOM.enable", { includeWhitespace: "all" });
    await frame.session.send("DOM.enable");
    await frame.locator("input").count();
    await frame.locator("input").count();
    expect(test.count("DOM.enable")).toBe(4);
    expect(test.count("Runtime.enable")).toBe(1);
  });

  it("does not let an old failed enable discard newer setup after a disable", async () => {
    const test = fixture();
    const frame = test.createFrame();
    test.paused.add("Runtime.enable");
    const first = expect(frame.locator("input").count()).rejects.toThrow("old setup failed");
    await test.waitForCall("Runtime.enable");
    await frame.session.send("Runtime.disable");
    const second = frame.locator("button").count();
    await test.waitForCall("Runtime.enable", 2);
    test.respondNext("old setup failed");
    await first;
    const third = frame.locator("textarea").count();
    test.paused.clear();
    test.respondAll();
    expect(await Promise.all([second, third])).toEqual([2, 2]);
    expect(test.count("Runtime.enable")).toBe(2);
  });

  it("keeps setup separate for distinct sessions and connections", async () => {
    const first = fixture();
    const second = fixture();
    for (const frame of [first.createFrame(), first.createFrame("child"), second.createFrame()]) {
      await frame.locator("input").count();
      await frame.locator("input").count();
    }
    for (const domain of ["Runtime", "DOM"]) {
      expect(first.count(`${domain}.enable`)).toBe(1);
      expect(first.count(`${domain}.enable`, "child")).toBe(1);
      expect(second.count(`${domain}.enable`)).toBe(1);
    }
  });

  it.each(["Target.detachedFromTarget", "Target.targetDestroyed"])(
    "forgets setup on %s",
    async (event) => {
      const test = fixture();
      await test.createFrame().locator("input").count();
      test.connection.onMessage(
        JSON.stringify({
          method: event,
          params: { sessionId: "session", targetId: "target-session" },
        }),
      );
      const replacement = test.createFrame();
      await replacement.locator("input").count();
      await replacement.locator("input").count();
      expect(test.count("Runtime.enable")).toBe(2);
      expect(test.count("DOM.enable")).toBe(2);
    },
  );

  it("does not cancel shared setup when one caller times out", async () => {
    vi.useFakeTimers();
    const progress = new Progress("count", 10);
    try {
      const test = fixture();
      const frame = test.createFrame();
      test.paused.add("Runtime.enable");
      const expired = expect(frame.locator("input").count(progress)).rejects.toThrow("timed out");
      const surviving = frame.locator("button").count();
      await test.waitForCall("Runtime.enable");
      await vi.advanceTimersByTimeAsync(10);
      await expired;
      test.paused.clear();
      test.respondAll();
      expect(await surviving).toBe(2);
      expect(test.count("Runtime.enable")).toBe(1);
    } finally {
      progress.dispose();
      vi.useRealTimers();
    }
  });
});
