import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeoutError } from "../errors.js";
import { createStagehandRuntime } from "../runtime.js";
import {
  assignFilePayloadsToInputElement,
  fillElementValue,
  prepareElementForTyping,
} from "../dom/locatorScripts/scripts.js";
import type { Frame } from "./frame.js";
import type { Page } from "./page.js";
import { DeepLocatorDelegate } from "./deepLocator.js";
import { frameLocatorFromFrame } from "./frameLocator.js";
import { executionContexts } from "./executionContextRegistry.js";
import { Locator } from "./locator.js";
import * as fileUploads from "./fileUploadUtils.js";
import { Progress, runWithProgress } from "./progress.js";

const upload = { name: "test.txt", buffer: "abc", lastModified: 1 };
const actions = [
  ["highlight", [{ durationMs: 0 }]],
  ["setInputFiles", [upload]],
  ["fill", ["hello"]],
  ["type", ["hello", undefined]],
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
  const send = vi.fn(async (method: string, params?: object): Promise<unknown> => {
    if (method === "DOM.getBoxModel") return { model: { content: [0, 0, 10, 0, 10, 10, 0, 10] } };
    if (method === "DOM.describeNode") return { node: { backendNodeId: 1 } };
    if (method === "Runtime.evaluate")
      return { result: { value: selector.startsWith("text=") ? { count: 2 } : 2 } };
    if (method === "Runtime.callFunctionOn") {
      const functionDeclaration = (params as { functionDeclaration?: string } | undefined)
        ?.functionDeclaration;
      return {
        result: {
          value: functionDeclaration === fillElementValue.toString() ? { status: "done" } : "value",
        },
      };
    }
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

function runPublicAction(locator: Locator, action: "highlight" | "upload") {
  const runtime = createStagehandRuntime();
  vi.spyOn(runtime, "resolveLocator").mockReturnValue(locator);
  const descriptor = { pageId: "page-1", selector: "button" };
  return action === "highlight"
    ? runtime.locatorHighlight({ ...descriptor, options: { durationMs: 0, timeout: 100 } })
    : runtime.locatorSetInputFiles({
        ...descriptor,
        files: [{ name: "test.txt", data: "YWJj", lastModified: 1 }],
        options: { timeout: 100 },
      });
}

function createFillLocator(legacy = false) {
  const fixture = createLocator();
  let nextNode = 0;
  fixture.resolveNode.mockImplementation(async () => ({
    objectId: `node-${++nextNode}`,
    nodeId: nextNode,
  }));
  const respond = fixture.send.getMockImplementation()!;
  fixture.send.mockImplementation((method, params) => {
    const declaration = (params as { functionDeclaration?: string } | undefined)
      ?.functionDeclaration;
    if (method === "Runtime.callFunctionOn") {
      if (declaration === fillElementValue.toString())
        return Promise.resolve({
          result: { value: legacy ? undefined : { status: "needsinput" } },
        });
      if (declaration === prepareElementForTyping.toString())
        return Promise.resolve({ result: { value: true } });
    }
    return respond(method, params);
  });
  return fixture;
}

afterEach(() => vi.restoreAllMocks());

describe.each(["direct", "deep", "frame"] as const)("%s locator progress forwarding", (kind) => {
  const supported = actions.filter(
    ([method]) =>
      kind !== "frame" ||
      !["sendClickEvent", "centroid", "backendNodeId", "highlight", "setInputFiles"].includes(
        method,
      ),
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
  const createProgress = (timeout = 100, name = "action") => {
    const progress = new Progress(name, timeout);
    contexts.push(progress);
    return progress;
  };
  beforeEach(() =>
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] }),
  );
  afterEach(() => {
    contexts.splice(0).forEach((progress) => progress.dispose());
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  const stalledCommands: Partial<Record<Action, string[]>> = {
    highlight: [
      "Overlay.enable",
      "DOM.scrollIntoViewIfNeeded",
      "DOM.enable",
      "DOM.describeNode",
      "Overlay.highlightNode",
    ],
    type: ["Runtime.callFunctionOn", "Input.insertText"],
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
      const sent = send.mock.calls.filter(
        ([name]) => !["Runtime.releaseObject", "Overlay.hideHighlight"].includes(name),
      ).length;
      gate.resolve(await respond(command));
      await vi.advanceTimersByTimeAsync(0);
      expect(
        send.mock.calls.filter(
          ([name]) => !["Runtime.releaseObject", "Overlay.hideHighlight"].includes(name),
        ),
      ).toHaveLength(sent);
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
    expect(
      send.mock.calls.filter(
        ([name]) => !["Runtime.releaseObject", "Overlay.hideHighlight"].includes(name),
      ),
    ).toHaveLength(0);
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

  it.each(["preparation", "legacy"] as const)(
    "shares the remaining fill budget through the %s fallback",
    async (path) => {
      const { locator, send, resolveNode } = createFillLocator(path === "legacy");
      const progress = createProgress(100, "fill");
      const type = vi.spyOn(locator, "type");
      const gate = deferred();
      const respond = send.getMockImplementation()!;
      const delayedHelper = path === "legacy" ? fillElementValue : prepareElementForTyping;
      send.mockImplementation(async (method, params) => {
        if (
          (params as { functionDeclaration?: string })?.functionDeclaration ===
          delayedHelper.toString()
        ) {
          await progress.delay(60);
          if (path === "preparation") throw new Error("preparation failed");
        }
        return method === "Input.insertText" ? gate.promise : respond(method, params);
      });
      const pending = locator.fill("hello", progress);
      const rejected = expect(pending).rejects.toThrow("fill timed out after 100ms");
      await vi.advanceTimersByTimeAsync(60);
      expect(type).toHaveBeenCalledExactlyOnceWith("hello", undefined, progress);
      expect(resolveNode.mock.calls.every(([passed]) => passed === progress)).toBe(true);
      expect(progress.remainingMs()).toBe(40);
      await vi.advanceTimersByTimeAsync(40);
      await rejected;
      const calls = send.mock.calls.length;
      gate.resolve({});
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledTimes(calls);
    },
  );

  it.each([
    { path: "preparation", failure: "expired" },
    { path: "preparation", failure: "closed" },
    { path: "legacy", failure: "expired" },
    { path: "legacy", failure: "closed" },
  ])("prevents $path fallback after $failure", async ({ path, failure }) => {
    const { locator, send } = createFillLocator(path === "legacy");
    const type = vi.spyOn(locator, "type");
    const progress = createProgress();
    const respond = send.getMockImplementation()!;
    const helper = path === "legacy" ? fillElementValue : prepareElementForTyping;
    const closed = new Error("CDP connection closed: gone");
    send.mockImplementation(async (method, params) => {
      if ((params as { functionDeclaration?: string })?.functionDeclaration === helper.toString()) {
        if (failure === "closed") throw closed;
        vi.spyOn(performance, "now").mockReturnValue(101);
        if (path === "preparation") throw new Error("preparation failed");
      }
      return respond(method, params);
    });
    const pending = locator.fill("hello", progress);
    if (failure === "closed") await expect(pending).rejects.toBe(closed);
    else await expect(pending).rejects.toThrow(TimeoutError);
    expect(type).not.toHaveBeenCalled();
    expect(send.mock.calls.some(([method]) => method.startsWith("Input."))).toBe(false);
  });

  it.each(["hello", ""])(
    "fills prepared input with %j & releases each handle once",
    async (value) => {
      const { locator, send } = createFillLocator();
      const type = vi.spyOn(locator, "type");
      await locator.fill(value, createProgress());
      expect(type).not.toHaveBeenCalled();
      expect(send.mock.calls.filter(([method]) => method.startsWith("Input."))).toEqual(
        value
          ? [["Input.insertText", { text: value }]]
          : [
              [
                "Input.dispatchKeyEvent",
                {
                  type: "keyDown",
                  key: "Backspace",
                  code: "Backspace",
                  windowsVirtualKeyCode: 8,
                  nativeVirtualKeyCode: 8,
                },
              ],
              [
                "Input.dispatchKeyEvent",
                {
                  type: "keyUp",
                  key: "Backspace",
                  code: "Backspace",
                  windowsVirtualKeyCode: 8,
                  nativeVirtualKeyCode: 8,
                },
              ],
            ],
      );
      expect(send.mock.calls.filter(([method]) => method === "Runtime.releaseObject")).toEqual([
        ["Runtime.releaseObject", { objectId: "node-1" }],
        ["Runtime.releaseObject", { objectId: "node-2" }],
      ]);
    },
  );

  it.each([undefined, 0, 100])("includes typing delays in timeout %s", async (timeout) => {
    const { locator, send } = createLocator();
    const pending = locator.type(
      "abc",
      { delay: 60 },
      timeout === undefined ? undefined : createProgress(timeout),
    );
    const result = timeout
      ? expect(pending).rejects.toThrow(TimeoutError)
      : expect(pending).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(100);
    if (timeout) await result;
    await vi.advanceTimersByTimeAsync(100);
    await result;
    const events = send.mock.calls.filter(([method]) => method === "Input.dispatchKeyEvent");
    expect(events.map(([, params]) => params)).toEqual(
      (timeout ? ["a", "b"] : ["a", "b", "c"]).flatMap((ch) => [
        { type: "keyDown", text: ch, key: ch },
        { type: "keyUp", text: ch, key: ch },
      ]),
    );
  });

  it.each(["keyDown", "keyUp"])(
    "bounds stalled typing %s & stops further characters",
    async (event) => {
      const { locator, send } = createLocator();
      const gate = deferred();
      const respond = send.getMockImplementation()!;
      send.mockImplementation((method, params) =>
        method === "Input.dispatchKeyEvent" && (params as { type: string }).type === event
          ? gate.promise
          : respond(method, params),
      );
      const pending = locator.type("ab", { delay: 20 }, createProgress());
      const rejected = expect(pending).rejects.toThrow(TimeoutError);
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      const sent = send.mock.calls.length;
      gate.resolve({});
      await vi.advanceTimersByTimeAsync(100);
      expect(send).toHaveBeenCalledTimes(sent);
    },
  );

  it("does not dispatch keyUp when keyDown finishes after the deadline", async () => {
    const { locator, send } = createLocator();
    const respond = send.getMockImplementation()!;
    send.mockImplementation(async (method, params) => {
      if (method === "Input.dispatchKeyEvent") vi.spyOn(performance, "now").mockReturnValue(101);
      return respond(method, params);
    });
    await expect(locator.type("ab", { delay: 20 }, createProgress())).rejects.toThrow(TimeoutError);
    expect(send.mock.calls.filter(([method]) => method === "Input.dispatchKeyEvent")).toHaveLength(
      1,
    );
  });

  it("does not repeat fill cleanup or prepare input after an early release stalls", async () => {
    const { locator, send, resolveNode } = createFillLocator();
    const gate = deferred();
    const respond = send.getMockImplementation()!;
    send.mockImplementation((method, params) =>
      method === "Runtime.releaseObject" ? gate.promise : respond(method, params),
    );
    const pending = locator.fill("hello", createProgress());
    const rejected = expect(pending).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(resolveNode).toHaveBeenCalledTimes(1);
    expect(send.mock.calls.filter(([method]) => method === "Runtime.releaseObject")).toEqual([
      ["Runtime.releaseObject", { objectId: "node-1" }],
    ]);
    expect(send.mock.calls.some(([method]) => method.startsWith("Input."))).toBe(false);
    gate.resolve({});
    await vi.advanceTimersByTimeAsync(0);
  });

  it.each([undefined, 0, 100])("includes highlight duration in timeout %s", async (timeout) => {
    const { locator, send } = createLocator();
    const pending = locator.highlight(
      { durationMs: 250 },
      timeout === undefined ? undefined : createProgress(timeout),
    );
    const result = timeout
      ? expect(pending).rejects.toThrow(TimeoutError)
      : expect(pending).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(100);
    if (timeout) await result;
    await vi.advanceTimersByTimeAsync(200);
    await result;
    expect(send.mock.calls.filter(([method]) => method === "Overlay.highlightNode")).toHaveLength(
      timeout ? 1 : 3,
    );
    expect(send.mock.calls.filter(([method]) => method === "Overlay.hideHighlight")).toHaveLength(
      1,
    );
    expect(send.mock.calls.filter(([method]) => method === "Runtime.releaseObject")).toHaveLength(
      1,
    );
  });

  it.each([undefined, 0, 100])(
    "keeps a successful zero-duration highlight with timeout %s",
    async (timeout) => {
      const { locator, send } = createLocator();
      await locator.highlight(
        { durationMs: 0 },
        timeout === undefined ? undefined : createProgress(timeout),
      );
      expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "node" });
      expect(send).not.toHaveBeenCalledWith("Overlay.hideHighlight");
    },
  );

  it.each(["ordinary", "closed", "expired"])(
    "handles a %s highlight node lookup failure",
    async (kind) => {
      const { locator, send } = createLocator();
      const error = new Error(
        kind === "closed" ? "CDP connection closed: gone" : "node lookup failed",
      );
      const respond = send.getMockImplementation()!;
      send.mockImplementation(async (method, params) => {
        if (method === "DOM.describeNode") {
          if (kind === "expired") vi.spyOn(performance, "now").mockReturnValue(101);
          throw error;
        }
        return respond(method, params);
      });
      const pending = locator.highlight({ durationMs: 0 }, createProgress());
      if (kind === "ordinary") {
        await pending;
        expect(send).toHaveBeenCalledWith(
          "Overlay.highlightNode",
          expect.objectContaining({ objectId: "node" }),
        );
      } else {
        if (kind === "closed") await expect(pending).rejects.toBe(error);
        else await expect(pending).rejects.toThrow(TimeoutError);
        expect(send).toHaveBeenCalledWith("Overlay.hideHighlight");
        expect(send.mock.calls.some(([method]) => method === "Overlay.highlightNode")).toBe(false);
      }
    },
  );

  it.each([false, true])(
    "only retries ordinary highlight refresh failures (closed: %s)",
    async (closed) => {
      const { locator, send } = createLocator();
      const error = new Error(
        closed ? "No Page found for target closed before CDP response: gone" : "node moved",
      );
      const respond = send.getMockImplementation()!;
      let draws = 0;
      send.mockImplementation(async (method, params) => {
        if (method === "Overlay.highlightNode" && ++draws === 2) throw error;
        return respond(method, params);
      });
      const pending = locator.highlight({ durationMs: 250 }, createProgress(500));
      const result = closed
        ? expect(pending).rejects.toBe(error)
        : expect(pending).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(250);
      await result;
      expect(draws).toBe(closed ? 2 : 3);
      expect(send).toHaveBeenCalledWith("Overlay.hideHighlight");
    },
  );

  it("hides a highlight that finishes drawing after timeout", async () => {
    const { locator, send } = createLocator();
    const gate = deferred();
    const respond = send.getMockImplementation()!;
    send.mockImplementation((method, params) =>
      method === "Overlay.highlightNode" ? gate.promise : respond(method, params),
    );
    const pending = locator.highlight({ durationMs: 0 }, createProgress());
    const rejected = expect(pending).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(send.mock.calls.filter(([method]) => method === "Overlay.hideHighlight")).toHaveLength(
      1,
    );
    gate.resolve({});
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls.filter(([method]) => method === "Overlay.hideHighlight")).toHaveLength(
      2,
    );
    expect(send.mock.calls.filter(([method]) => method === "Overlay.highlightNode")).toHaveLength(
      1,
    );
  });

  it.each([false, true])(
    "does not stack highlight cleanup waits (zero duration: %s)",
    async (zeroDuration) => {
      const { locator, send } = createLocator();
      const gate = deferred();
      const respond = send.getMockImplementation()!;
      send.mockImplementation((method, params) =>
        ["Overlay.hideHighlight", "Runtime.releaseObject"].includes(method)
          ? gate.promise
          : respond(method, params),
      );
      const pending = locator.highlight({ durationMs: zeroDuration ? 0 : 50 }, createProgress());
      const rejected = expect(pending).rejects.toThrow(TimeoutError);
      await vi.advanceTimersByTimeAsync(50);
      if (!zeroDuration) {
        expect(send).toHaveBeenCalledWith("Overlay.hideHighlight");
        expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "node" });
      }
      await vi.advanceTimersByTimeAsync(1000);
      await rejected;
      expect(send.mock.calls.filter(([method]) => method === "Overlay.hideHighlight")).toHaveLength(
        1,
      );
      expect(send.mock.calls.filter(([method]) => method === "Runtime.releaseObject")).toHaveLength(
        1,
      );
      gate.resolve({});
      await vi.advanceTimersByTimeAsync(0);
    },
  );

  it.each(["highlight", "upload"] as const)(
    "preserves the primary %s error through the runtime while cleanup is stalled",
    async (action) => {
      const { locator, send } = createLocator();
      const primary = new Error("action failed");
      const gate = deferred();
      const respond = send.getMockImplementation()!;
      send.mockImplementation(async (method, params) => {
        if (["Overlay.hideHighlight", "Runtime.releaseObject"].includes(method))
          return gate.promise;
        if (
          method === "Overlay.highlightNode" ||
          (params as { functionDeclaration?: string })?.functionDeclaration ===
            assignFilePayloadsToInputElement.toString()
        )
          throw primary;
        return respond(method, params);
      });
      const settled = vi.fn();
      const pending = runPublicAction(locator, action);
      void pending.then(settled, settled);
      try {
        await vi.advanceTimersByTimeAsync(0);
        expect(settled).toHaveBeenCalledExactlyOnceWith(primary);
        expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "node" });
        if (action === "highlight") expect(send).toHaveBeenCalledWith("Overlay.hideHighlight");
        await vi.advanceTimersByTimeAsync(1000);
        expect(settled).toHaveBeenCalledExactlyOnceWith(primary);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        gate.resolve({});
        await vi.advanceTimersByTimeAsync(0);
      }
    },
  );

  it.each([
    ["highlight", false],
    ["upload", false],
    ["highlight", true],
    ["upload", true],
  ] as const)(
    "reports an expired %s without waiting for stalled cleanup (runtime: %s)",
    async (action, throughRuntime) => {
      const { locator, send } = createLocator();
      const work = deferred();
      const cleanup = deferred();
      const respond = send.getMockImplementation()!;
      send.mockImplementation((method, params) => {
        if (["Overlay.hideHighlight", "Runtime.releaseObject"].includes(method))
          return cleanup.promise;
        if (
          method === "Overlay.highlightNode" ||
          (params as { functionDeclaration?: string })?.functionDeclaration ===
            assignFilePayloadsToInputElement.toString()
        )
          return work.promise;
        return respond(method, params);
      });
      const pending = throughRuntime
        ? runPublicAction(locator, action)
        : action === "highlight"
          ? locator.highlight({ durationMs: 0 }, createProgress())
          : locator.setInputFiles(upload, createProgress());
      const settled = vi.fn();
      void pending.then(settled, settled);
      try {
        await vi.advanceTimersByTimeAsync(100);
        expect(settled).toHaveBeenCalledExactlyOnceWith(expect.any(TimeoutError));
        expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "node" });
      } finally {
        work.resolve({ result: { value: true } });
        cleanup.resolve({});
        await vi.advanceTimersByTimeAsync(0);
      }
    },
  );

  it("still reports timeout when successful upload cleanup crosses the deadline", async () => {
    const { locator, send } = createLocator();
    const gate = deferred();
    const respond = send.getMockImplementation()!;
    send.mockImplementation((method, params) =>
      method === "Runtime.releaseObject" ? gate.promise : respond(method, params),
    );
    const pending = locator.setInputFiles(upload, createProgress());
    const rejected = expect(pending).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    gate.resolve({});
    await vi.advanceTimersByTimeAsync(0);
  });

  it("preserves a highlight failure when both cleanup commands fail", async () => {
    const { locator, send } = createLocator();
    const primary = new Error("drawing failed");
    const respond = send.getMockImplementation()!;
    send.mockImplementation(async (method, params) => {
      if (method === "Overlay.highlightNode") throw primary;
      if (["Overlay.hideHighlight", "Runtime.releaseObject"].includes(method))
        throw new Error("cleanup failed");
      return respond(method, params);
    });
    await expect(locator.highlight({ durationMs: 0 }, createProgress())).rejects.toBe(primary);
    expect(send).toHaveBeenCalledWith("Overlay.hideHighlight");
    expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "node" });
  });

  it.each(["normalization", "encoding"])(
    "does not inject files when %s exhausts the budget",
    async (stage) => {
      const { locator } = createLocator();
      const inject = vi.spyOn(locator, "assignFilesViaPayloadInjection");
      if (stage === "normalization") {
        const normalize = fileUploads.normalizeInputFiles;
        vi.spyOn(fileUploads, "normalizeInputFiles").mockImplementation(async (files) => {
          const result = await normalize(files);
          vi.spyOn(performance, "now").mockReturnValue(101);
          return result;
        });
      } else {
        const encode = fileUploads.bytesToBase64;
        vi.spyOn(fileUploads, "bytesToBase64").mockImplementation((bytes) => {
          const result = encode(bytes);
          vi.spyOn(performance, "now").mockReturnValue(101);
          return result;
        });
      }
      const send = vi.spyOn(locator.frame.session, "send");
      await expect(locator.setInputFiles(upload, createProgress())).rejects.toThrow(TimeoutError);
      if (stage === "normalization") expect(inject).not.toHaveBeenCalled();
      expect(
        send.mock.calls.some(
          ([, params]) =>
            (params as { functionDeclaration?: string })?.functionDeclaration ===
            assignFilePayloadsToInputElement.toString(),
        ),
      ).toBe(false);
    },
  );

  it("bounds stalled upload normalization & ignores its late result", async () => {
    const { locator } = createLocator();
    const gate = deferred();
    vi.spyOn(fileUploads, "normalizeInputFiles").mockImplementation(async () => {
      await gate.promise;
      return [];
    });
    const inject = vi.spyOn(locator, "assignFilesViaPayloadInjection");
    const pending = locator.setInputFiles(upload, createProgress());
    const rejected = expect(pending).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    gate.resolve({});
    await vi.advanceTimersByTimeAsync(0);
    expect(inject).not.toHaveBeenCalled();
  });

  it.each([0, 100])("bounds upload injection with timeout %s", async (timeout) => {
    const { locator, send } = createLocator();
    const gate = deferred();
    const respond = send.getMockImplementation()!;
    send.mockImplementation((method, params) =>
      (params as { functionDeclaration?: string })?.functionDeclaration ===
      assignFilePayloadsToInputElement.toString()
        ? gate.promise
        : respond(method, params),
    );
    const pending = locator.setInputFiles(upload, createProgress(timeout));
    const result = timeout
      ? expect(pending).rejects.toThrow(TimeoutError)
      : expect(pending).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(100);
    if (timeout) await result;
    gate.resolve({ result: { value: true } });
    await result;
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls.filter(([method]) => method === "Runtime.callFunctionOn")).toHaveLength(
      2,
    );
    expect(send.mock.calls.filter(([method]) => method === "Runtime.releaseObject")).toHaveLength(
      1,
    );
  });

  it.each([false, true])("passes progress through file injection (clear: %s)", async (clear) => {
    const { locator, send } = createLocator();
    const progress = createProgress();
    const inject = vi.spyOn(locator, "assignFilesViaPayloadInjection");
    await locator.setInputFiles(clear ? [] : upload, progress);
    expect(inject).toHaveBeenCalledExactlyOnceWith(
      "node",
      clear ? [] : [expect.objectContaining({ name: "test.txt" })],
      progress,
    );
    expect(send).toHaveBeenCalledWith(
      "Runtime.callFunctionOn",
      expect.objectContaining({
        functionDeclaration: assignFilePayloadsToInputElement.toString(),
        arguments: [
          {
            value: clear
              ? []
              : [
                  {
                    name: "test.txt",
                    mimeType: "application/octet-stream",
                    lastModified: 1,
                    base64: "YWJj",
                  },
                ],
          },
        ],
      }),
    );
  });
});
