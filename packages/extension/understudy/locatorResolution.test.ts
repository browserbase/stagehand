import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "./cdp.js";
import type { StagehandLogger } from "../logger.js";
import { TimeoutError } from "../errors.js";
import { executionContexts } from "./executionContextRegistry.js";
import { Frame } from "./frame.js";
import { frameLocatorFromFrame } from "./frameLocator.js";
import { LocatorOperation, runLocatorOperation } from "./locatorOperation.js";
import type { Page } from "./page.js";

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createFrame(frameId: string, ready = true) {
  const events = new EventEmitter();
  const state = { ready, protocol: "https:" };
  const respond = async (method: string, params?: object): Promise<unknown> => {
    if (method === "DOM.describeNode") return { node: { backendNodeId: 1 } };
    if (method === "DOM.getFrameOwner") return { backendNodeId: 1 };
    if (method === "DOM.requestNode") return { nodeId: 1 };
    if (method === "Runtime.evaluate") {
      const expression = (params as { expression: string }).expression;
      if (expression.includes("__stagehandExtensionWorld")) {
        return { result: { value: { ready: state.ready } } };
      }
      if (expression.includes("location?.protocol")) return { result: { value: state.protocol } };
      if (expression.includes("__stagehandLocatorWorld")) {
        return {
          result: { value: { ready: true, kind: "cdp-fallback", closedShadowRoots: false } },
        };
      }
      return { result: { objectId: "node" } };
    }
    return {};
  };
  const send = vi.fn(respond);
  const session = {
    id: frameId,
    send,
    on: events.on.bind(events),
    off: events.off.bind(events),
    close: async () => {},
  } as CDPSessionLike;
  executionContexts.register(session, frameId, 1);
  executionContexts.registerExtensionCandidate(session, frameId, 2);
  if (ready) executionContexts.registerExtensionWorld(session, frameId, 2);
  const frame = new Frame(session, frameId, "page", false, {} as StagehandLogger);
  return { frame, session, send, respond, state, events };
}

function createPage(...frames: Frame[]) {
  const tree = (index: number): object => ({
    frame: { id: frames[index].frameId },
    childFrames: index + 1 < frames.length ? [tree(index + 1)] : [],
  });
  return {
    getFullFrameTree: () => tree(0),
    getSessionForFrame: (id: string) => frames.find((frame) => frame.frameId === id)!.session,
    frameForId: (id: string) => frames.find((frame) => frame.frameId === id)!,
  } as unknown as Page;
}

describe("locator resolution deadlines", () => {
  const operations: LocatorOperation[] = [];
  const operation = (timeout = 100) => {
    const context = new LocatorOperation("resolve", timeout);
    operations.push(context);
    return context;
  };
  beforeEach(() =>
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] }),
  );
  afterEach(() => {
    operations.splice(0).forEach((context) => context.dispose());
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    { timeout: 0, discoveryDelay: 1300 },
    { timeout: 2000, discoveryDelay: 1300 },
    { timeout: 0, discoveryDelay: 0 },
    { timeout: 2000, discoveryDelay: 0 },
  ])(
    "allows readiness at 1500ms with timeout $timeout & discovery delay $discoveryDelay",
    async ({ timeout, discoveryDelay }) => {
      const root = createFrame("root");
      const child = createFrame("child", false);
      const page = createPage(root.frame, child.frame);
      const getTree = page.getFullFrameTree.bind(page);
      vi.spyOn(page, "getFullFrameTree").mockImplementation(() =>
        performance.now() < discoveryDelay
          ? ({ frame: { id: "root" } } as ReturnType<Page["getFullFrameTree"]>)
          : getTree(),
      );
      const context = operation(timeout);
      const pending = frameLocatorFromFrame(page, root.frame, "iframe").resolveFrame(context);
      await vi.advanceTimersByTimeAsync(1500);
      expect(context.signal.aborted).toBe(false);
      child.state.ready = true;
      await vi.advanceTimersByTimeAsync(25);
      await expect(pending).resolves.toBe(child.frame);
    },
  );

  it.each([0, 2000])(
    "allows direct helper readiness beyond its old cap with timeout %s",
    async (timeout) => {
      const { frame, state } = createFrame("root", false);
      const pending = frame.locator("button").resolveNode(operation(timeout));
      await vi.advanceTimersByTimeAsync(1400);
      state.ready = true;
      await vi.advanceTimersByTimeAsync(25);
      await expect(pending).resolves.toMatchObject({ objectId: "node" });
    },
  );

  it("shares one budget across frame hops & stops polling after expiry", async () => {
    const root = createFrame("root");
    const middle = createFrame("middle", false);
    const inner = createFrame("inner", false);
    const page = createPage(root.frame, middle.frame, inner.frame);
    const pending = frameLocatorFromFrame(page, root.frame, "iframe")
      .frameLocator("iframe")
      .resolveFrame(operation());
    const rejected = expect(pending).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(60);
    middle.state.ready = true;
    await vi.advanceTimersByTimeAsync(40);
    await rejected;
    const sent = inner.send.mock.calls.length;
    inner.state.ready = true;
    await vi.advanceTimersByTimeAsync(200);
    expect(inner.send).toHaveBeenCalledTimes(sent);
    expect(inner.send).toHaveBeenCalledWith("Runtime.enable");
  });

  it("caps readiness probes to the remaining budget", async () => {
    const root = createFrame("root");
    const child = createFrame("child", false);
    const context = operation(250);
    const wait = vi.spyOn(executionContexts, "waitForLocatorWorld");
    const pending = frameLocatorFromFrame(
      createPage(root.frame, child.frame),
      root.frame,
      "iframe",
    ).resolveFrame(context);
    const rejected = expect(pending).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(250);
    await rejected;
    const probes = wait.mock.calls.filter(([, frameId]) => frameId === "child");
    expect(probes).toHaveLength(2);
    expect(probes[0][2]).toBe(200);
    expect(probes[1][2]).toBeLessThanOrEqual(50);
    expect(probes.every(([, , , passed]) => passed === context)).toBe(true);
  });

  it("rechecks frame ownership between readiness probes", async () => {
    const root = createFrame("root");
    const oldChild = createFrame("child", false);
    const adoptedChild = createFrame("child");
    const page = createPage(root.frame, oldChild.frame);
    vi.spyOn(page, "getSessionForFrame").mockImplementation(() =>
      performance.now() < 100 ? oldChild.session : adoptedChild.session,
    );
    vi.spyOn(page, "frameForId").mockReturnValue(adoptedChild.frame);
    const wait = vi.spyOn(executionContexts, "waitForLocatorWorld");
    const pending = frameLocatorFromFrame(page, root.frame, "iframe").resolveFrame(operation(500));
    await vi.advanceTimersByTimeAsync(250);
    await expect(pending).resolves.toBe(adoptedChild.frame);
    expect(wait.mock.calls.filter(([, id]) => id === "child").map(([session]) => session)).toEqual([
      oldChild.session,
      adoptedChild.session,
    ]);
  });

  it.each([
    "Runtime.enable",
    "DOM.enable",
    "Runtime.evaluate",
    "DOM.requestNode",
    "DOM.describeNode",
    "DOM.getFrameOwner",
  ])("bounds a stalled %s & does not resume after its late result", async (method) => {
    const root = createFrame("root");
    const child = createFrame("child");
    const gate = deferred();
    root.send.mockImplementation((command, params) =>
      command === method ? gate.promise : root.respond(command, params),
    );
    const context = operation();
    await vi.advanceTimersByTimeAsync(60);
    const pending =
      method === "DOM.describeNode" || method === "DOM.getFrameOwner"
        ? frameLocatorFromFrame(
            createPage(root.frame, child.frame),
            root.frame,
            "iframe",
          ).resolveFrame(context)
        : root.frame.locator("button").resolveNode(context);
    const rejected = expect(pending).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(40);
    await rejected;
    const sent = root.send.mock.calls.filter(
      ([command]) => command !== "Runtime.releaseObject",
    ).length;
    gate.resolve(method === "Runtime.evaluate" ? { result: { objectId: "late-node" } } : {});
    await vi.advanceTimersByTimeAsync(0);
    expect(
      root.send.mock.calls.filter(([command]) => command !== "Runtime.releaseObject"),
    ).toHaveLength(sent);
    if (method === "Runtime.evaluate")
      expect(root.send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "late-node" });
    if (["DOM.requestNode", "DOM.describeNode", "DOM.getFrameOwner"].includes(method))
      expect(root.send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "node" });
  });

  it("releases earlier matches when a later selector lookup times out", async () => {
    const { frame, send, respond } = createFrame("root");
    const gate = deferred();
    let matches = 0;
    send.mockImplementation((method, params) =>
      method === "Runtime.evaluate"
        ? ++matches === 2
          ? gate.promise
          : Promise.resolve({ result: { objectId: "first" } })
        : respond(method, params),
    );
    const pending = frame.locator("button").nth(1).resolveNode(operation());
    const rejected = expect(pending).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "first" });
    gate.resolve({ result: { objectId: "second" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "second" });
  });

  it("removes the main-world listener & timer when its caller expires", async () => {
    const { session, events } = createFrame("root", false);
    executionContexts.byFrame.delete(session);
    const pending = executionContexts.waitForMainWorld(session, "root", 800, operation());
    const rejected = expect(pending).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(0);
    expect(events.listenerCount("Runtime.executionContextCreated")).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(events.listenerCount("Runtime.executionContextCreated")).toBe(0);
  });

  it("lets another caller finish shared installation after the first caller expires", async () => {
    const { session, state, send, respond } = createFrame("root", false);
    state.protocol = "data:";
    executionContexts.setFallbackInstallerSource(session, "install locator runtime");
    const gate = deferred();
    send.mockImplementation((method, params) =>
      method === "Page.createIsolatedWorld" ? gate.promise : respond(method, params),
    );
    const first = executionContexts.waitForLocatorWorld(session, "root", 10, operation(100));
    const second = executionContexts.waitForLocatorWorld(session, "root", 10, operation(300));
    const rejected = expect(first).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(
      send.mock.calls.filter(([method]) => method === "Page.createIsolatedWorld"),
    ).toHaveLength(1);
    gate.resolve({ executionContextId: 9 });
    await expect(second).resolves.toMatchObject({ contextId: 9, kind: "cdp-fallback" });
    expect(executionContexts.getFallbackWorld(session, "root")).toBe(9);
    expect(executionContexts.fallbackCreation.get(session)?.size).toBe(0);
  });

  it("bounds locator-world evaluation without retrying after expiry", async () => {
    const { frame, send, respond } = createFrame("root");
    const gate = deferred();
    send.mockImplementation((method, params) =>
      method === "Runtime.evaluate" ? gate.promise : respond(method, params),
    );
    const pending = frame.evaluateInLocatorWorld("1", operation());
    const rejected = expect(pending).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    gate.resolve({ result: { value: 1 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls.filter(([method]) => method === "Runtime.evaluate")).toHaveLength(1);
  });

  it("does not hold the outer caller while cleanup is stalled", async () => {
    const { frame, send, respond } = createFrame("root");
    const gate = deferred();
    send.mockImplementation((method, params) =>
      ["DOM.requestNode", "Runtime.releaseObject"].includes(method)
        ? gate.promise
        : respond(method, params),
    );
    const pending = runLocatorOperation({ name: "resolve", timeout: 100 }, (context) =>
      frame.locator("button").resolveNode(context),
    );
    const rejected = expect(pending).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    await vi.advanceTimersByTimeAsync(1000);
    gate.resolve({});
    await vi.advanceTimersByTimeAsync(0);
  });
});
