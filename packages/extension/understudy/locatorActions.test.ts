import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeoutError } from "../errors.js";
import type { Frame } from "./frame.js";
import type { Page } from "./page.js";
import { DeepLocatorDelegate } from "./deepLocator.js";
import { frameLocatorFromFrame } from "./frameLocator.js";
import { executionContexts } from "./executionContextRegistry.js";
import { Locator } from "./locator.js";
import { Progress, runWithProgress } from "./progress.js";

const actions = [
  ["click", [{ button: "right", clickCount: 2 }]],
  ["hover", []],
  ["selectOption", [["first", "second"]]],
  ["scrollTo", [75]],
  ["sendClickEvent", [{ bubbles: false, detail: 2 }]],
  ["centroid", []],
  ["backendNodeId", []],
  ["count", []],
  ["isVisible", []],
  ["isChecked", []],
  ["inputValue", []],
  ["innerText", []],
  ["innerHtml", []],
  ["textContent", []],
] as const;
type Action = (typeof actions)[number][0];

function createLocator(selector = "button") {
  const send = vi.fn(async (method: string, _params?: object): Promise<unknown> => {
    if (method === "DOM.getBoxModel") return { model: { content: [0, 0, 10, 0, 10, 10, 0, 10] } };
    if (method === "DOM.describeNode") return { node: { backendNodeId: 1 } };
    if (method === "Runtime.evaluate")
      return { result: { value: selector.startsWith("text=") ? { count: 2 } : 2 } };
    if (method === "Runtime.callFunctionOn") return { result: { value: "value" } };
    return {};
  });
  const frame = { frameId: "root", session: { send } } as unknown as Frame;
  const locator = new Locator(frame, selector);
  const resolveNode = vi
    .spyOn(locator, "resolveNode")
    .mockResolvedValue({ objectId: "node", nodeId: 1 });
  const readiness = vi.spyOn(executionContexts, "waitForLocatorWorld").mockResolvedValue({
    kind: "extension",
    contextId: 1,
    capabilities: { closedShadowRoots: true },
  });
  return { locator, frame, resolveNode, readiness, send };
}

afterEach(() => vi.restoreAllMocks());

describe.each(["direct", "deep", "frame"] as const)("%s locator progress forwarding", (kind) => {
  const supported = actions.filter(
    ([method]) =>
      kind !== "frame" || !["sendClickEvent", "centroid", "backendNodeId"].includes(method),
  );

  it.each(supported)("passes the caller's progress through %s", async (method, args) => {
    const { locator, frame, resolveNode } = createLocator();
    const delegate =
      kind === "direct"
        ? undefined
        : kind === "deep"
          ? new DeepLocatorDelegate({} as Page, frame, "button")
          : frameLocatorFromFrame({} as Page, frame, "iframe").locator("button");
    const real = delegate ? vi.spyOn(delegate, "real").mockResolvedValue(locator) : undefined;
    const target: Partial<Pick<Locator, Action>> = delegate ?? locator;
    const action = vi.spyOn(locator, method);
    const count = vi.spyOn(locator.selectorResolver, "count");

    await runWithProgress({ name: method, timeout: 1000 }, async (progress) => {
      await Reflect.apply(target[method]!, target, [...args, progress]);
      if (real) expect(real).toHaveBeenCalledExactlyOnceWith(progress);
      expect(action).toHaveBeenCalledExactlyOnceWith(...args, progress);
      if (method === "count") {
        expect(count).toHaveBeenCalledExactlyOnceWith(locator.selectorQuery, progress);
        expect(resolveNode).not.toHaveBeenCalled();
      } else {
        expect(resolveNode).toHaveBeenCalledExactlyOnceWith(progress);
      }
    });
  });
});

describe("counting progress forwarding", () => {
  it.each([
    ["button", "countCss"],
    ["text=button", "countText"],
    ["xpath=//button", "countXPath"],
  ] as const)("passes progress through %s counting & readiness", async (selector, method) => {
    const { locator, frame, readiness } = createLocator(selector);
    const count = vi.spyOn(locator.selectorResolver, method);
    const evaluate = vi.spyOn(locator.selectorResolver, "evaluateCount");

    await runWithProgress({ name: "count", timeout: 1000 }, async (progress) => {
      await expect(locator.count(progress)).resolves.toBe(2);
      expect(count).toHaveBeenCalledExactlyOnceWith(locator.selectorQuery.value, progress);
      expect(readiness).toHaveBeenCalledExactlyOnceWith(
        frame.session,
        frame.frameId,
        1000,
        progress,
      );
      if (method === "countCss")
        expect(evaluate).toHaveBeenCalledExactlyOnceWith(expect.any(String), 1, progress);
    });
  });
});

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("locator action deadlines", () => {
  const contexts: Progress[] = [];
  const createProgress = (timeout = 100) => {
    const progress = new Progress("action", timeout);
    contexts.push(progress);
    return progress;
  };
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));
  afterEach(() => {
    contexts.splice(0).forEach((progress) => progress.dispose());
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  const stalledCommands: Partial<Record<Action, string[]>> = {
    click: ["DOM.scrollIntoViewIfNeeded", "DOM.getBoxModel", "Input.dispatchMouseEvent"],
    hover: ["DOM.getBoxModel", "Input.dispatchMouseEvent"],
    centroid: ["DOM.getBoxModel"],
    backendNodeId: ["DOM.enable", "DOM.describeNode"],
    count: ["Runtime.enable", "DOM.enable", "Runtime.evaluate"],
  };
  it.each(
    actions.flatMap(([method, args]) =>
      (stalledCommands[method] ?? ["Runtime.callFunctionOn"]).map((command) => ({
        method,
        args,
        command,
      })),
    ),
  )(
    "bounds $method waiting for $command & ignores its late response",
    async ({ method, args, command }) => {
      const { locator, send } = createLocator();
      const gate = deferred();
      const respond = send.getMockImplementation()!;
      send.mockImplementation((name) => (name === command ? gate.promise : respond(name)));
      const pending = Reflect.apply(locator[method], locator, [...args, createProgress()]);
      const rejected = expect(pending).rejects.toThrow(TimeoutError);
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      const sent = send.mock.calls.filter(([name]) => name !== "Runtime.releaseObject").length;
      gate.resolve(await respond(command));
      await vi.advanceTimersByTimeAsync(0);
      expect(send.mock.calls.filter(([name]) => name !== "Runtime.releaseObject")).toHaveLength(
        sent,
      );
      if (method !== "count")
        expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "node" });
      if (command !== "Input.dispatchMouseEvent")
        expect(send.mock.calls.some(([name]) => name === "Input.dispatchMouseEvent")).toBe(false);
    },
  );

  it.each(["click", "count"] as const)("does not start %s after expiry", async (method) => {
    const { locator, send } = createLocator();
    const progress = createProgress();
    vi.spyOn(performance, "now").mockReturnValue(101);
    const pending =
      method === "click" ? locator.click(undefined, progress) : locator.count(progress);
    await expect(pending).rejects.toThrow(TimeoutError);
    expect(send.mock.calls.filter(([name]) => name !== "Runtime.releaseObject")).toHaveLength(0);
  });

  it.each([
    ["isVisible", false],
    ["isChecked", false],
    ["inputValue", ""],
    ["innerText", ""],
    ["innerHtml", ""],
    ["textContent", ""],
  ] as const)("preserves an empty %s result", async (method, expected) => {
    const { locator, send } = createLocator();
    send.mockResolvedValue({ result: { value: null } });
    await expect(locator[method](createProgress())).resolves.toBe(expected);
  });

  it("uses only the remaining budget after deep resolution", async () => {
    const { locator, frame, send } = createLocator();
    const delegate = new DeepLocatorDelegate({} as Page, frame, "button");
    vi.spyOn(delegate, "real").mockImplementation(async (progress) => {
      await progress!.delay(60);
      return locator;
    });
    const gate = deferred();
    const respond = send.getMockImplementation()!;
    send.mockImplementation((name) => (name === "DOM.getBoxModel" ? gate.promise : respond(name)));
    const progress = createProgress();
    const pending = delegate.click(undefined, progress);
    const rejected = expect(pending).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(60);
    expect(progress.remainingMs()).toBe(40);
    await vi.advanceTimersByTimeAsync(40);
    await rejected;
    gate.resolve(await respond("DOM.getBoxModel"));
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls.some(([name]) => name === "Input.dispatchMouseEvent")).toBe(false);
  });

  it.each([undefined, 0, 100])("preserves the click burst with timeout %s", async (timeout) => {
    const { locator, send } = createLocator();
    const gate = deferred();
    const respond = send.getMockImplementation()!;
    send.mockImplementation((name) =>
      name === "Input.dispatchMouseEvent" ? gate.promise : respond(name),
    );
    const pending = locator.click(
      { button: "right", clickCount: 2 },
      timeout === undefined ? undefined : createProgress(timeout),
    );
    await vi.advanceTimersByTimeAsync(0);
    const events = send.mock.calls.filter(([name]) => name === "Input.dispatchMouseEvent");
    expect(events.map(([, params]) => params)).toEqual([
      { type: "mouseMoved", x: 5, y: 5, button: "none" },
      { type: "mousePressed", x: 5, y: 5, button: "right", clickCount: 1 },
      { type: "mouseReleased", x: 5, y: 5, button: "right", clickCount: 1 },
      { type: "mousePressed", x: 5, y: 5, button: "right", clickCount: 2 },
      { type: "mouseReleased", x: 5, y: 5, button: "right", clickCount: 2 },
    ]);
    gate.resolve({});
    await pending;
  });

  it("stops dispatching a click burst once the deadline passes", async () => {
    const { locator, send } = createLocator();
    const respond = send.getMockImplementation()!;
    send.mockImplementation(async (name) => {
      if (name === "Input.dispatchMouseEvent") vi.spyOn(performance, "now").mockReturnValue(101);
      return respond(name);
    });
    await expect(locator.click({ clickCount: 2 }, createProgress())).rejects.toThrow(TimeoutError);
    expect(send.mock.calls.filter(([name]) => name === "Input.dispatchMouseEvent")).toHaveLength(1);
  });

  it.each(["ordinary", "closed", "expired"])("handles a %s scrolling error", async (kind) => {
    const { locator, send } = createLocator();
    const error = new Error(kind === "closed" ? "CDP connection closed: gone" : "no layout object");
    const respond = send.getMockImplementation()!;
    send.mockImplementation(async (name) => {
      if (name === "DOM.scrollIntoViewIfNeeded") {
        if (kind === "expired") vi.spyOn(performance, "now").mockReturnValue(101);
        throw error;
      }
      return respond(name);
    });
    const pending = locator.hover(createProgress());
    if (kind === "ordinary") await expect(pending).resolves.toBeUndefined();
    else if (kind === "closed") await expect(pending).rejects.toBe(error);
    else await expect(pending).rejects.toThrow(TimeoutError);
    expect(send.mock.calls.some(([name]) => name === "Input.dispatchMouseEvent")).toBe(
      kind === "ordinary",
    );
  });

  it.each(["button", "text=button", "xpath=//button"])(
    "preserves expiry & closure in %s counts",
    async (selector) => {
      const { locator, send } = createLocator(selector);
      const closed = new Error("No Page found for target closed before CDP response: gone");
      const respond = send.getMockImplementation()!;
      send.mockImplementation(async (name) => {
        if (name === "Runtime.evaluate") throw closed;
        return respond(name);
      });
      await expect(locator.count(createProgress())).rejects.toBe(closed);
      const progress = createProgress();
      send.mockImplementation(async (name) => {
        if (name === "Runtime.evaluate") {
          vi.spyOn(performance, "now").mockReturnValue(101);
          throw new Error("context gone");
        }
        return respond(name);
      });
      await expect(locator.count(progress)).rejects.toThrow(TimeoutError);
    },
  );

  it.each(["button", "text=button", "xpath=//button"])(
    "preserves an empty %s count",
    async (selector) => {
      const { locator, send } = createLocator(selector);
      send.mockResolvedValue({ result: { value: 0 } });
      await expect(locator.count(createProgress())).resolves.toBe(0);
    },
  );

  it.each([false, true])(
    "preserves errors & checks expiry after cleanup (expired: %s)",
    async (expired) => {
      const { locator, send } = createLocator();
      const primary = new Error("evaluation failed");
      const respond = send.getMockImplementation()!;
      send.mockImplementation(async (name) => {
        if (name === "Runtime.callFunctionOn" && !expired) throw primary;
        if (name === "Runtime.releaseObject") {
          if (expired) vi.spyOn(performance, "now").mockReturnValue(101);
          throw new Error("cleanup failed");
        }
        return respond(name);
      });
      const pending = locator.innerText(createProgress());
      if (expired) await expect(pending).rejects.toThrow(TimeoutError);
      else await expect(pending).rejects.toBe(primary);
    },
  );

  it("bounds stalled cleanup without holding the outer caller", async () => {
    const { locator, send } = createLocator();
    const gate = deferred();
    const respond = send.getMockImplementation()!;
    send.mockImplementation((name) =>
      name === "Runtime.releaseObject" ? gate.promise : respond(name),
    );
    let finished = false;
    const pending = runWithProgress({ name: "read", timeout: 100 }, async (progress) => {
      try {
        return await locator.innerText(progress);
      } finally {
        finished = true;
      }
    });
    const rejected = expect(pending).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(finished).toBe(true);
    gate.resolve({});
    await vi.advanceTimersByTimeAsync(0);
  });

  it("keeps concurrent calls independent & allows an unlimited read to finish", async () => {
    const { locator, send } = createLocator();
    const gate = deferred();
    const respond = send.getMockImplementation()!;
    send.mockImplementation((name) =>
      name === "Runtime.callFunctionOn" ? gate.promise : respond(name),
    );
    const first = locator.innerText(createProgress());
    const second = locator.innerText(createProgress(0));
    const rejected = expect(first).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    gate.resolve({ result: { value: "finished" } });
    await expect(second).resolves.toBe("finished");
  });
});
