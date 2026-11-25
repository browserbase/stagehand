import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "./cdp.js";
import type { StagehandLogger } from "../logger.js";
import { TimeoutError } from "../errors.js";
import { executionContexts } from "./executionContextRegistry.js";
import { Frame } from "./frame.js";
import { frameLocatorFromFrame } from "./frameLocator.js";
import { Progress, runWithProgress } from "./progress.js";
import type { Page } from "./page.js";

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
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
  const contexts: Progress[] = [];
  const createProgress = (timeout = 100) => {
    const context = new Progress("resolve", timeout);
    contexts.push(context);
    return context;
  };
  beforeEach(() =>
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] }),
  );
  afterEach(() => {
    contexts.splice(0).forEach((context) => context.dispose());
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
      const context = createProgress(timeout);
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
      const pending = frame.locator("button").resolveNode(createProgress(timeout));
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
      .resolveFrame(createProgress());
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
    const context = createProgress(250);
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
    const pending = frameLocatorFromFrame(page, root.frame, "iframe").resolveFrame(
      createProgress(500),
    );
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
    const context = createProgress();
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

  it.each(["Runtime.evaluate", "Runtime.getProperties"])(
    "releases a batch again when %s finishes after its deadline",
    async (command) => {
      const { frame, send, respond } = createFrame("root");
      const gate = deferred();
      let objectGroup: string;
      const liveGroups = new Set<string>();
      send.mockImplementation(async (method, params) => {
        if (method === "Runtime.evaluate")
          objectGroup = (params as { objectGroup: string }).objectGroup;
        if (method === "Runtime.releaseObjectGroup") {
          liveGroups.delete((params as { objectGroup: string }).objectGroup);
          return {};
        }
        if (method === command) {
          const value = await gate.promise;
          liveGroups.add(objectGroup);
          return value;
        }
        if (method === "Runtime.evaluate") liveGroups.add(objectGroup);
        return respond(method, params);
      });
      const pending = frame
        .locator("button")
        .selectorResolver.resolveAll({ kind: "css", value: "button" }, {}, createProgress());
      const rejected = expect(pending).rejects.toThrow(TimeoutError);
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      const releases = () =>
        send.mock.calls.filter(([method]) => method === "Runtime.releaseObjectGroup");
      expect(releases()).toHaveLength(1);
      expect(liveGroups.size).toBe(0);
      const group = { objectGroup: objectGroup! };
      gate.resolve(
        command === "Runtime.evaluate"
          ? { result: { objectId: "late-array" } }
          : { result: [{ name: "0", value: { objectId: "late-node" } }] },
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(releases()).toEqual([
        ["Runtime.releaseObjectGroup", group],
        ["Runtime.releaseObjectGroup", group],
      ]);
      expect(liveGroups.size).toBe(0);
      expect(send).not.toHaveBeenCalledWith("DOM.requestNode", expect.anything());
    },
  );

  it("bounds stalled batch cleanup after a failed collection", async () => {
    const { frame, send, respond } = createFrame("root");
    const gate = deferred();
    send.mockImplementation((method, params) => {
      if (method === "Runtime.releaseObjectGroup") return gate.promise;
      if (method === "Runtime.evaluate")
        return Promise.resolve({
          result: { objectId: "error" },
          exceptionDetails: { text: "failed" },
        });
      return respond(method, params);
    });
    const settled = vi.fn();
    const pending = frame
      .locator("button")
      .selectorResolver.resolveAll({ kind: "css", value: "button" }, {}, createProgress());
    void pending.then(settled, settled);
    try {
      await vi.advanceTimersByTimeAsync(1000);
      expect(settled).toHaveBeenCalledExactlyOnceWith(expect.any(TimeoutError));
      expect(
        send.mock.calls.filter(([method]) => method === "Runtime.releaseObjectGroup"),
      ).toHaveLength(1);
    } finally {
      gate.resolve({});
      await vi.advanceTimersByTimeAsync(0);
    }
  });

  it.each(["Runtime.evaluate", "Runtime.getProperties"])(
    "releases the original group again after a late %s rejection",
    async (command) => {
      const { frame, send, respond } = createFrame("root");
      const gate = deferred();
      send.mockImplementation((method, params) =>
        method === command ? gate.promise : respond(method, params),
      );
      const pending = frame
        .locator("button")
        .selectorResolver.resolveAll({ kind: "css", value: "button" }, {}, createProgress());
      const rejected = expect(pending).rejects.toThrow(TimeoutError);
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      const group = send.mock.calls.find(([method]) => method === "Runtime.releaseObjectGroup")![1];
      gate.reject(new Error("Execution context was destroyed"));
      await vi.advanceTimersByTimeAsync(0);
      expect(send.mock.calls.filter(([method]) => method === "Runtime.releaseObjectGroup")).toEqual(
        [
          ["Runtime.releaseObjectGroup", group],
          ["Runtime.releaseObjectGroup", group],
        ],
      );
    },
  );

  it("keeps batch cleanup on its owning session even if the frame changes sessions", async () => {
    const original = createFrame("root");
    const replacement = createFrame("replacement");
    original.send.mockImplementation(async (method, params) => {
      if (method === "Runtime.getProperties")
        return {
          result: [{ name: "0", value: { objectId: "original-node" } }],
        };
      return original.respond(method, params);
    });
    const batch = await original.frame
      .locator("button")
      .selectorResolver.resolveAll({ kind: "css", value: "button" });
    expect(batch.nodes).toEqual([{ objectId: "original-node", nodeId: null }]);
    original.frame.session = replacement.session;
    await batch.release();
    await batch.release();
    expect(
      original.send.mock.calls.filter(([method]) => method === "Runtime.releaseObjectGroup"),
    ).toHaveLength(1);
    expect(replacement.send).not.toHaveBeenCalled();
  });

  it.each([
    { command: "Runtime.evaluate", failure: "exception", withProgress: false },
    { command: "Runtime.getProperties", failure: "exception", withProgress: false },
    { command: "Runtime.evaluate", failure: "exception", withProgress: true },
    { command: "Runtime.getProperties", failure: "exception", withProgress: true },
    { command: "Runtime.evaluate", failure: "closed", withProgress: true },
    { command: "Runtime.getProperties", failure: "closed", withProgress: true },
  ])(
    "releases the owning group on $command $failure (progress=$withProgress)",
    async ({ command, failure, withProgress }) => {
      const { frame, send, respond } = createFrame("root");
      const closed = new Error("CDP connection closed: socket-close");
      let allocatedGroup: string | undefined;
      const liveGroups = new Set<string>();
      send.mockImplementation(async (method, params) => {
        if (method === "Runtime.evaluate") {
          allocatedGroup = (params as { objectGroup: string }).objectGroup;
          liveGroups.add(allocatedGroup);
        }
        if (method === "Runtime.releaseObjectGroup") {
          expect((params as { objectGroup: string }).objectGroup).toBe(allocatedGroup);
          liveGroups.delete((params as { objectGroup: string }).objectGroup);
          if (failure === "closed") throw closed;
          return {};
        }
        if (method === command) {
          if (failure === "closed") throw closed;
          return {
            result: command === "Runtime.evaluate" ? { objectId: "error" } : [],
            exceptionDetails: { text: "evaluation failed", exception: { objectId: "error" } },
          };
        }
        return respond(method, params);
      });
      const pending = frame
        .locator("button")
        .selectorResolver.resolveAll(
          { kind: "css", value: "button" },
          {},
          withProgress ? createProgress(0) : undefined,
        );
      if (failure === "closed") await expect(pending).rejects.toBe(closed);
      else await expect(pending).resolves.toMatchObject({ nodes: [] });
      expect(allocatedGroup).toEqual(expect.any(String));
      expect(liveGroups.size).toBe(0);
      expect(send).not.toHaveBeenCalledWith("DOM.requestNode", expect.anything());
    },
  );

  it("removes the main-world listener & timer when its caller expires", async () => {
    const { session, events } = createFrame("root", false);
    executionContexts.byFrame.delete(session);
    const pending = executionContexts.waitForMainWorld(session, "root", 800, createProgress());
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
    const first = executionContexts.waitForLocatorWorld(session, "root", 10, createProgress(100));
    const second = executionContexts.waitForLocatorWorld(session, "root", 10, createProgress(300));
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
    const pending = frame.evaluateInLocatorWorld(() => "1", createProgress());
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
    const pending = runWithProgress({ name: "resolve", timeout: 100 }, (context) =>
      frame.locator("button").resolveNode(context),
    );
    const rejected = expect(pending).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    await vi.advanceTimersByTimeAsync(1000);
    gate.resolve({});
    await vi.advanceTimersByTimeAsync(0);
  });

  it.each(["frame", "empty selector result"] as const)(
    "rejects %s when cleanup crosses the deadline before its timer fires",
    async (kind) => {
      const root = createFrame("root");
      const child = createFrame("child");
      const progress = createProgress();
      root.send.mockImplementation((method, params) => {
        if (
          method === (kind === "frame" ? "Runtime.releaseObject" : "Runtime.releaseObjectGroup")
        ) {
          vi.spyOn(performance, "now").mockReturnValue(101);
          expect(progress.signal.aborted).toBe(false);
        }
        if (kind === "empty selector result" && method === "Runtime.evaluate") {
          return Promise.resolve({
            result: { objectId: "failed-node" },
            exceptionDetails: { text: "evaluation failed" },
          });
        }
        return root.respond(method, params);
      });
      const pending =
        kind === "frame"
          ? frameLocatorFromFrame(
              createPage(root.frame, child.frame),
              root.frame,
              "iframe",
            ).resolveFrame(progress)
          : root.frame
              .locator("button")
              .selectorResolver.resolveAll({ kind: "css", value: "button" }, {}, progress);
      await expect(pending).rejects.toThrow(TimeoutError);
      expect(
        root.send.mock.calls.filter(
          ([method]) =>
            method === (kind === "frame" ? "Runtime.releaseObject" : "Runtime.releaseObjectGroup"),
        ),
      ).toHaveLength(1);
    },
  );

  it.each(["runtime", "inspection", "fallback"] as const)(
    "preserves closure during %s instead of retrying or installing a fallback",
    async (phase) => {
      const { session, send, respond } = createFrame("root", false);
      const closed = new Error("CDP connection closed: socket-close");
      send.mockImplementation((method, params) => {
        const expression = (params as { expression?: string } | undefined)?.expression ?? "";
        if (
          (phase === "runtime" && method === "Runtime.enable") ||
          (phase === "inspection" && expression.includes("__stagehandExtensionWorld")) ||
          (phase === "fallback" && expression.includes("location?.protocol"))
        ) {
          return Promise.reject(closed);
        }
        return respond(method, params);
      });
      let failure: unknown;
      const done = executionContexts
        .waitForLocatorWorld(session, "root", 10, createProgress())
        .catch((error) => {
          failure = error;
        });
      await vi.advanceTimersByTimeAsync(50);
      const earlyFailure = failure;
      await vi.advanceTimersByTimeAsync(50);
      await done;
      expect(earlyFailure).toBe(closed);
      expect(send.mock.calls.some(([method]) => method === "Page.createIsolatedWorld")).toBe(false);
    },
  );

  it.each(["Runtime.evaluate", "DOM.requestNode", "DOM.getFrameOwner"])(
    "preserves session closure from %s during resolution",
    async (command) => {
      const root = createFrame("root");
      const child = createFrame("child");
      const closed = new Error(
        "No Page found for target closed before CDP response (sessionId=root, targetId=page)",
      );
      root.send.mockImplementation((method, params) =>
        method === command ? Promise.reject(closed) : root.respond(method, params),
      );
      const progress = createProgress(0);
      const pending =
        command === "DOM.getFrameOwner"
          ? frameLocatorFromFrame(
              createPage(root.frame, child.frame),
              root.frame,
              "iframe",
            ).resolveFrame(progress)
          : root.frame.locator("button").resolveNode(progress);
      await expect(pending).rejects.toBe(closed);
    },
  );

  it.each([false, true])(
    "handles a lookup error with expired=%s before the deadline timer runs",
    async (expired) => {
      const { frame, send, respond } = createFrame("root");
      const progress = createProgress();
      send.mockImplementation((method, params) => {
        if (method === "Runtime.evaluate") {
          if (expired) vi.spyOn(performance, "now").mockReturnValue(101);
          expect(progress.signal.aborted).toBe(false);
          return Promise.reject(new Error("element detached"));
        }
        return respond(method, params);
      });
      const pending = frame
        .locator("button")
        .selectorResolver.resolveAll({ kind: "css", value: "button" }, {}, progress);
      if (expired) await expect(pending).rejects.toThrow(TimeoutError);
      else await expect(pending).resolves.toMatchObject({ nodes: [] });
      expect(send).not.toHaveBeenCalledWith("DOM.requestNode", expect.anything());
    },
  );

  it.each([false, true])(
    "recovers a missing execution context only while active (expired=%s)",
    async (expired) => {
      const { frame, session, send, respond } = createFrame("root");
      const progress = createProgress();
      let evaluations = 0;
      send.mockImplementation((method, params) => {
        if (method === "Runtime.evaluate") {
          if (++evaluations === 1) {
            if (expired) vi.spyOn(performance, "now").mockReturnValue(101);
            expect(progress.signal.aborted).toBe(false);
            executionContexts.registerExtensionWorld(session, "root", 3);
            return Promise.reject(new Error("Cannot find context with specified id"));
          }
          return Promise.resolve({ result: { value: "recovered" } });
        }
        return respond(method, params);
      });
      const pending = frame.evaluateInLocatorWorld(() => "1", progress);
      if (expired) await expect(pending).rejects.toThrow(TimeoutError);
      else await expect(pending).resolves.toBe("recovered");
      expect(evaluations).toBe(expired ? 1 : 2);
      if (!expired)
        expect(send).toHaveBeenLastCalledWith(
          "Runtime.evaluate",
          expect.objectContaining({ contextId: 3 }),
        );
    },
  );

  it.each([
    { adopted: false, expired: false, connectionClosed: false },
    { adopted: true, expired: false, connectionClosed: false },
    { adopted: true, expired: true, connectionClosed: false },
    { adopted: true, expired: false, connectionClosed: true },
  ])(
    "handles closure with adopted=$adopted, expired=$expired, connectionClosed=$connectionClosed",
    async ({ adopted, expired, connectionClosed }) => {
      const root = createFrame("root");
      const oldChild = createFrame("child", false);
      const newChild = createFrame("child");
      const page = createPage(root.frame, oldChild.frame);
      let owner = oldChild.session;
      vi.spyOn(page, "getSessionForFrame").mockImplementation(() => owner);
      vi.spyOn(page, "frameForId").mockReturnValue(newChild.frame);
      const closed = new Error(
        connectionClosed
          ? "CDP connection closed: socket-close"
          : "No Page found for target closed before CDP response (sessionId=child, targetId=child)",
      );
      const progress = createProgress(expired ? 100 : 0);
      oldChild.send.mockImplementation(() => {
        if (adopted) owner = newChild.session;
        if (expired) vi.spyOn(performance, "now").mockReturnValue(101);
        return Promise.reject(closed);
      });
      const wait = vi.spyOn(executionContexts, "waitForLocatorWorld");
      const pending = frameLocatorFromFrame(page, root.frame, "iframe").resolveFrame(progress);
      if (expired) await expect(pending).rejects.toThrow(TimeoutError);
      else if (!adopted || connectionClosed) await expect(pending).rejects.toBe(closed);
      else await expect(pending).resolves.toBe(newChild.frame);
      const probes = wait.mock.calls.filter(([, id]) => id === "child");
      expect(probes.map(([session]) => session)).toEqual(
        adopted && !expired && !connectionClosed
          ? [oldChild.session, newChild.session]
          : [oldChild.session],
      );
      expect(probes.every(([, , , passed]) => passed === progress)).toBe(true);
    },
  );

  it("preserves closure during shared fallback inspection", async () => {
    const { session, state, send, respond } = createFrame("root", false);
    state.protocol = "data:";
    executionContexts.setFallbackInstallerSource(session, "install locator runtime");
    const closed = new Error("CDP connection closed: socket-close");
    send.mockImplementation((method, params) => {
      if (method === "Page.createIsolatedWorld") return Promise.resolve({ executionContextId: 9 });
      if (
        (params as { expression?: string } | undefined)?.expression?.includes(
          "__stagehandLocatorWorld",
        )
      )
        return Promise.reject(closed);
      return respond(method, params);
    });
    const rejected = expect(
      executionContexts.waitForLocatorWorld(session, "root", 10, createProgress(0)),
    ).rejects.toBe(closed);
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(executionContexts.getFallbackWorld(session, "root")).toBeNull();
    expect(executionContexts.fallbackCreation.get(session)?.size).toBe(0);
  });

  it("releases a batch delivered after the deadline before the timer fires", async () => {
    const { frame, send, respond } = createFrame("root");
    const progress = createProgress();
    send.mockImplementation(async (method, params) => {
      if (method === "Runtime.getProperties") {
        vi.spyOn(performance, "now").mockReturnValue(101);
        return { result: [{ name: "0", value: { objectId: "late-node" } }] };
      }
      return respond(method, params);
    });
    await expect(
      frame
        .locator("button")
        .selectorResolver.resolveAll({ kind: "css", value: "button" }, { limit: 1 }, progress),
    ).rejects.toThrow(TimeoutError);
    expect(send).toHaveBeenCalledWith("Runtime.releaseObjectGroup", expect.any(Object));
  });
});
