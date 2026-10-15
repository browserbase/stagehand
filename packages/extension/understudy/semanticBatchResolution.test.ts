import type { Protocol } from "devtools-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeoutError } from "../errors.js";
import type { Frame } from "./frame.js";
import { executionContexts } from "./executionContextRegistry.js";
import { Progress } from "./progress.js";
import { FrameSelectorResolver, type SelectorQuery } from "./selectorResolver.js";

const query: SelectorQuery = {
  kind: "semantic",
  steps: [{ kind: "role", role: "button", options: { name: "Save" } }],
};

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function property(name: string, objectId: string): Protocol.Runtime.PropertyDescriptor {
  return {
    name,
    configurable: true,
    enumerable: true,
    value: { type: "object", subtype: "node", objectId },
  };
}

function createResolver(ids = ["first", "second"]) {
  const evaluation: Protocol.Runtime.EvaluateResponse = {
    result: { type: "object", subtype: "array", objectId: "array" },
  };
  const properties: Protocol.Runtime.GetPropertiesResponse = {
    result: ids.map((id, index) => property(String(index), id)),
    internalProperties: [
      { name: "[[Prototype]]", value: { type: "object", objectId: "prototype" } },
    ],
  };
  const respond = async (method: string): Promise<unknown> => {
    if (method === "Runtime.evaluate") return evaluation;
    if (method === "Runtime.getProperties") return properties;
    if (method === "DOM.requestNode") return { nodeId: 1 };
    return {};
  };
  const send = vi.fn(async (method: string, _params?: object) => respond(method));
  const frame = { frameId: "root", session: { send } } as unknown as Frame;
  const readiness = vi.spyOn(executionContexts, "waitForLocatorWorld").mockResolvedValue({
    kind: "extension",
    contextId: 1,
    capabilities: { closedShadowRoots: true },
  });
  const released = () =>
    send.mock.calls
      .filter(([method]) => method === "Runtime.releaseObject")
      .map(([, params]) => (params as { objectId: string }).objectId)
      .sort();
  return {
    resolver: new FrameSelectorResolver(frame),
    send,
    respond,
    evaluation,
    properties,
    readiness,
    released,
  };
}

describe("semantic batch resolution", () => {
  const contexts: Progress[] = [];
  const createProgress = () => {
    const progress = new Progress("semantic batch", 100);
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
    vi.restoreAllMocks();
  });

  it("queries once and transfers only the resolved node handles to its caller", async () => {
    const { resolver, send, readiness, released } = createResolver();
    const progress = createProgress();
    await expect(resolver.resolveAll(query, {}, progress)).resolves.toEqual([
      { objectId: "first", nodeId: 1 },
      { objectId: "second", nodeId: 1 },
    ]);
    expect(readiness.mock.calls[0]?.[3]).toBe(progress);
    expect(send.mock.calls.filter(([method]) => method === "Runtime.evaluate")).toHaveLength(1);
    expect(send.mock.calls.filter(([method]) => method === "Runtime.getProperties")).toEqual([
      ["Runtime.getProperties", { objectId: "array", ownProperties: true }],
    ]);
    expect(released()).toEqual(["array", "prototype"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(released()).toEqual(["array", "prototype"]);
  });

  it("preserves numeric index order and releases every non-result metadata handle", async () => {
    const { resolver, properties, released } = createResolver();
    properties.result = [
      property("10", "last"),
      property("2", "second"),
      property("0", "first"),
      {
        name: "metadata",
        configurable: true,
        enumerable: false,
        get: { type: "function", objectId: "getter" },
        set: { type: "function", objectId: "setter" },
        symbol: { type: "symbol", objectId: "symbol" },
      },
    ];
    properties.privateProperties = [
      { name: "private", value: { type: "object", objectId: "private" } },
    ];
    await expect(resolver.resolveAll(query)).resolves.toEqual([
      { objectId: "first", nodeId: 1 },
      { objectId: "second", nodeId: 1 },
      { objectId: "last", nodeId: 1 },
    ]);
    expect(released()).toEqual(["array", "getter", "private", "prototype", "setter", "symbol"]);
  });

  it.each([0, -1, NaN])("does not evaluate when limit is %s", async (limit) => {
    const { resolver, send, readiness } = createResolver();
    await expect(resolver.resolveAll(query, { limit }, createProgress())).resolves.toEqual([]);
    expect(readiness).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([1, 1.5, Infinity])(
    "applies limit %s inside the fresh array evaluation",
    async (limit) => {
      const { resolver, send } = createResolver();
      await resolver.resolveAll(query, { limit });
      const expression = (send.mock.calls[0]![1] as { expression: string }).expression;
      expect(expression).toContain(
        `scripts["querySemanticSelector"](${JSON.stringify(query.steps)})`,
      );
      expect(expression).toMatch(new RegExp(`\\.slice\\(0, ${Math.ceil(limit)}\\)$`));
    },
  );

  it("releases an empty result array without requesting any DOM nodes", async () => {
    const { resolver, send, released } = createResolver([]);
    await expect(resolver.resolveAll(query, {}, createProgress())).resolves.toEqual([]);
    expect(send.mock.calls.some(([method]) => method === "DOM.requestNode")).toBe(false);
    expect(released()).toEqual(["array", "prototype"]);
  });

  it("resolves a fresh match set on each call", async () => {
    const { resolver, properties, send } = createResolver(["first"]);
    await expect(resolver.resolveAll(query)).resolves.toEqual([{ objectId: "first", nodeId: 1 }]);
    properties.result = [property("0", "second")];
    await expect(resolver.resolveAll(query)).resolves.toEqual([{ objectId: "second", nodeId: 1 }]);
    expect(send.mock.calls.filter(([method]) => method === "Runtime.evaluate")).toHaveLength(2);
  });

  it.each(["evaluation", "properties"] as const)(
    "preserves %s exception details and releases all acquired handles",
    async (phase) => {
      const { resolver, evaluation, properties, released } = createResolver();
      const details: Protocol.Runtime.ExceptionDetails = {
        exceptionId: 1,
        lineNumber: 0,
        columnNumber: 0,
        text: "Uncaught",
        exception: { type: "object", objectId: "exception", description: "Unsupported role state" },
      };
      (phase === "evaluation" ? evaluation : properties).exceptionDetails = details;
      await expect(resolver.resolveAll(query, {}, createProgress())).rejects.toMatchObject({
        name: "SelectorEvaluationError",
        message: "Unsupported role state",
        cause: details,
      });
      expect(released()).toEqual(
        phase === "evaluation"
          ? ["array", "exception"]
          : ["array", "exception", "first", "prototype", "second"],
      );
    },
  );

  it("rejects a malformed array response without leaking its handle", async () => {
    const { resolver, evaluation, released } = createResolver();
    delete evaluation.result.subtype;
    await expect(resolver.resolveAll(query)).rejects.toThrow("did not return an array");
    expect(released()).toEqual(["array"]);
  });

  it("releases even unprocessed matches when a numeric property has no handle", async () => {
    const { resolver, properties, released } = createResolver();
    properties.result.unshift({
      name: "0",
      configurable: true,
      enumerable: true,
      value: { type: "undefined" },
    });
    await expect(resolver.resolveAll(query)).rejects.toThrow("has no object handle");
    expect(released()).toEqual(["array", "first", "prototype", "second"]);
  });

  it.each(["Runtime.evaluate", "Runtime.getProperties", "DOM.requestNode"])(
    "preserves connection closure during %s",
    async (command) => {
      const { resolver, send, respond, released } = createResolver();
      const closed = new Error("CDP connection closed: socket-close");
      send.mockImplementation((method) =>
        method === command ? Promise.reject(closed) : respond(method),
      );
      await expect(resolver.resolveAll(query, {}, createProgress())).rejects.toBe(closed);
      expect(released()).toEqual(
        command === "Runtime.evaluate"
          ? []
          : command === "Runtime.getProperties"
            ? ["array"]
            : ["array", "first", "prototype", "second"],
      );
    },
  );

  it("retains the existing nodeId-null fallback for unavailable DOM nodes", async () => {
    const { resolver, send, respond } = createResolver(["first"]);
    send.mockImplementation((method) =>
      method === "DOM.requestNode" ? Promise.reject(new Error("Node is gone")) : respond(method),
    );
    await expect(resolver.resolveAll(query, {}, createProgress())).resolves.toEqual([
      { objectId: "first", nodeId: null },
    ]);
  });

  it.each(["Runtime.evaluate", "Runtime.getProperties", "DOM.requestNode"])(
    "releases acquired and late handles when %s exceeds the deadline",
    async (command) => {
      const { resolver, send, respond, released, evaluation, properties } = createResolver([
        "first",
        "second",
        "third",
      ]);
      const gate = deferred();
      send.mockImplementation((method, params) =>
        method === command &&
        (command !== "DOM.requestNode" || (params as { objectId: string }).objectId === "second")
          ? gate.promise
          : respond(method),
      );
      const pending = resolver.resolveAll(query, {}, createProgress());
      const rejected = expect(pending).rejects.toThrow(TimeoutError);
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      expect(released()).toEqual(
        command === "Runtime.evaluate"
          ? []
          : command === "Runtime.getProperties"
            ? ["array"]
            : ["array", "first", "prototype", "second", "third"],
      );
      const commands = send.mock.calls.filter(([method]) => method !== "Runtime.releaseObject");
      gate.resolve(
        command === "Runtime.evaluate"
          ? evaluation
          : command === "Runtime.getProperties"
            ? properties
            : { nodeId: 2 },
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(released()).toEqual(
        command === "Runtime.evaluate"
          ? ["array"]
          : ["array", "first", "prototype", "second", "third"],
      );
      expect(send.mock.calls.filter(([method]) => method !== "Runtime.releaseObject")).toEqual(
        commands,
      );
    },
  );

  it("releases retained nodes if the deadline crosses during successful metadata cleanup", async () => {
    const { resolver, send, respond, released } = createResolver();
    const gate = deferred();
    send.mockImplementation((method, params) =>
      method === "Runtime.releaseObject" &&
      ["array", "prototype"].includes((params as { objectId: string }).objectId)
        ? gate.promise
        : respond(method),
    );
    const pending = resolver.resolveAll(query, {}, createProgress());
    const rejected = expect(pending).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    gate.resolve({});
    await rejected;
    expect(released()).toEqual(["array", "first", "prototype", "second"]);
  });

  it("bounds stalled cleanup after a timed-out node request", async () => {
    const { resolver, send, respond, released } = createResolver();
    const node = deferred();
    const cleanup = deferred();
    send.mockImplementation((method) =>
      method === "DOM.requestNode"
        ? node.promise
        : method === "Runtime.releaseObject"
          ? cleanup.promise
          : respond(method),
    );
    const pending = resolver.resolveAll(query, {}, createProgress());
    const rejected = expect(pending).rejects.toThrow(TimeoutError);
    try {
      await vi.advanceTimersByTimeAsync(1_100);
      await rejected;
      expect(released()).toEqual(["array", "first", "prototype", "second"]);
    } finally {
      cleanup.resolve({});
      node.resolve({ nodeId: 1 });
      await vi.advanceTimersByTimeAsync(0);
    }
  });

  it("does not replace a selector error with cleanup failure", async () => {
    const { resolver, send, respond, evaluation } = createResolver();
    evaluation.exceptionDetails = {
      exceptionId: 1,
      lineNumber: 0,
      columnNumber: 0,
      text: "Invalid role",
    };
    send.mockImplementation((method) =>
      method === "Runtime.releaseObject"
        ? Promise.reject(new Error("Cleanup failed"))
        : respond(method),
    );
    await expect(resolver.resolveAll(query, {}, createProgress())).rejects.toThrow("Invalid role");
  });
});
