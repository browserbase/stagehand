import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  AriaRoleSchema,
  decodeLocatorQuery,
  encodeLocatorQuery,
  type AriaRole,
  type QueryStep,
} from "../types/private/semanticLocator.js";
import type * as Playwright from "../dom/locatorScripts/vendor/playwright/types.js";
import { resolveLocatorTarget } from "./deepLocator.js";
import { executionContexts } from "./executionContextRegistry.js";
import type { Frame } from "./frame.js";
import { FrameLocator } from "./frameLocator.js";
import type { Page } from "./page.js";
import { runWithProgress } from "./progress.js";
import { FrameSelectorResolver } from "./selectorResolver.js";
import { splitSelectorHops } from "./selectorParser.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("semantic locator query codec", () => {
  it("round trips scoped matching and nth without changing user text", () => {
    const steps: QueryStep[] = [
      { kind: "selector", selector: '[data-label="Save >> publish"]' },
      {
        kind: "role",
        role: "button",
        options: { name: 'Save "draft" >> now', includeHidden: true },
      },
      { kind: "nth", index: 1 },
      { kind: "text", text: { source: "a[\\s\\S]*>>b", flags: "ims" }, exact: false },
    ];
    const encoded = encodeLocatorQuery(steps);
    expect(encoded).toContain('"include_hidden":true');
    expect(decodeLocatorQuery(encoded)).toEqual(steps);
    expect(FrameSelectorResolver.parseSelector(encoded)).toEqual({ kind: "semantic", steps });
    expect(steps[1]).toEqual({
      kind: "role",
      role: "button",
      options: { name: 'Save "draft" >> now', includeHidden: true },
    });
  });

  it("uses Playwright's supported ARIA role union", () => {
    expectTypeOf<AriaRole>().toEqualTypeOf<Exclude<Playwright.AriaRole, "mark">>();
    expect(AriaRoleSchema.options).not.toContain("mark");
  });

  it("omits explicit undefined options at the JSON boundary", () => {
    const selector = encodeLocatorQuery([
      {
        kind: "role",
        role: "button",
        options: { name: undefined, description: undefined, includeHidden: false },
      },
    ]);
    expect(decodeLocatorQuery(selector)).toEqual([
      { kind: "role", role: "button", options: { includeHidden: false } },
    ]);
  });

  it.each(["button", "text=Save >> publish", '[data-label="internal:locator=[]"]'])(
    "does not reinterpret ordinary selector %s",
    (selector) => {
      expect(decodeLocatorQuery(selector)).toBeNull();
    },
  );

  it.each([
    "not-json",
    "{}",
    "[]",
    '[{"kind":"nth","index":0}]',
    '[{"kind":"role","role":"not-a-role"}]',
    '[{"kind":"role","role":"button","options":{"pressed":"mixed"}}]',
    '[{"kind":"role","role":"heading","options":{"level":0}}]',
    '[{"kind":"role","role":"button","options":{"surprise":true}}]',
    '[{"kind":"text","text":{"source":"["}}]',
    '[{"kind":"text","text":{"source":"x","flags":"ii"}}]',
    '[{"kind":"text","text":"hello"},{"kind":"nth","index":-1}]',
    '[{"kind":"selector","selector":"internal:locator=[]"}]',
  ])("rejects malformed envelopes before querying a browser: %s", (payload) => {
    const selector = `internal:locator=${payload}`;
    expect(() => decodeLocatorQuery(selector)).toThrow("Invalid semantic locator query");
    expect(() => FrameSelectorResolver.parseSelector(selector)).toThrow(
      "Invalid semantic locator query",
    );
  });

  it.each([
    ['[{"kind":"text","text":{"source":"["}}]', "Invalid regular expression"],
    ['[{"kind":"role","role":"heading","options":{"level":0}}]', '"level"'],
  ])("keeps validation details in the error message", (payload, reason) => {
    try {
      decodeLocatorQuery(`internal:locator=${payload}`);
      expect.fail("Expected invalid selector to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error).toHaveProperty("cause", expect.any(Error));
      expect((error as Error).message).toContain(reason);
    }
  });
});

describe("legacy selector hop parsing", () => {
  it.each([
    ["iframe >> button", ["iframe", "button"]],
    [
      'iframe[data-title="a >> b"] >> text="Save >> now"',
      ['iframe[data-title="a >> b"]', 'text="Save >> now"'],
    ],
    [
      "iframe >> xpath=//button[contains(., 'Save >> now')]",
      ["iframe", "xpath=//button[contains(., 'Save >> now')]"],
    ],
    ['[data-name="a\\\" >> b"]', ['[data-name="a\\\" >> b"]']],
  ])("keeps literals intact in %s", (selector, expected) => {
    expect(splitSelectorHops(selector)).toEqual(expected);
  });

  it("keeps legacy CSS descendant semantics without corrupting attribute values", () => {
    expect(FrameSelectorResolver.parseSelector('section >> [data-text="x >> y"]')).toEqual({
      kind: "css",
      value: 'section [data-text="x >> y"]',
    });
  });
});

describe("semantic locator frame resolution", () => {
  const page = {} as Page;
  const root = {} as Frame;

  it("never interprets role names or regexes as iframe hops", async () => {
    const resolveFrame = vi.spyOn(FrameLocator.prototype, "resolveFrame");
    const selector = encodeLocatorQuery([
      { kind: "role", role: "button", options: { name: "Save >> publish" } },
      { kind: "text", text: { source: "a >> b" } },
    ]);
    await expect(resolveLocatorTarget(page, root, selector)).resolves.toEqual({
      frame: root,
      selector,
    });
    expect(resolveFrame).not.toHaveBeenCalled();
  });

  it("resolves only the initial legacy selector's frame hops with the same deadline", async () => {
    const child = {} as Frame;
    const resolveFrame = vi.spyOn(FrameLocator.prototype, "resolveFrame").mockResolvedValue(child);
    const steps: QueryStep[] = [
      { kind: "selector", selector: 'iframe[data-name="outer >> inner"] >> body' },
      { kind: "role", role: "button", options: { name: "Save >> publish" } },
      { kind: "nth", index: 1 },
      { kind: "selector", selector: '[data-text="one >> two"]' },
    ];
    await runWithProgress({ name: "resolve", timeout: 1_000 }, async (progress) => {
      const target = await resolveLocatorTarget(page, root, encodeLocatorQuery(steps), progress);
      expect(target.frame).toBe(child);
      expect(decodeLocatorQuery(target.selector)).toEqual([
        { kind: "selector", selector: "body" },
        ...steps.slice(1),
      ]);
      expect(resolveFrame).toHaveBeenCalledExactlyOnceWith(progress);
      expect(resolveFrame.mock.instances[0]).toMatchObject({
        selector: 'iframe[data-name="outer >> inner"]',
      });
    });
  });

  it("does not treat subsequent descendant selector steps as frame hops", async () => {
    const resolveFrame = vi.spyOn(FrameLocator.prototype, "resolveFrame");
    const selector = encodeLocatorQuery([
      { kind: "role", role: "dialog" },
      { kind: "selector", selector: "section >> button" },
    ]);
    await expect(resolveLocatorTarget(page, root, selector)).resolves.toEqual({
      frame: root,
      selector,
    });
    expect(resolveFrame).not.toHaveBeenCalled();
  });

  it("rejects malformed reserved selectors before resolving any frame", async () => {
    const resolveFrame = vi.spyOn(FrameLocator.prototype, "resolveFrame");
    await expect(
      resolveLocatorTarget(page, root, 'internal:locator=[{"kind":"text","text":3}]'),
    ).rejects.toThrow("Invalid semantic locator query");
    expect(resolveFrame).not.toHaveBeenCalled();
  });
});

describe("semantic selector resolution", () => {
  const steps: QueryStep[] = [{ kind: "role", role: "button", options: { name: "Save" } }];
  const query = FrameSelectorResolver.parseSelector(encodeLocatorQuery(steps));

  function createResolver() {
    const send = vi.fn(async (method: string, params?: object): Promise<unknown> => {
      if (method === "Runtime.evaluate") {
        const expression = (params as { expression: string }).expression;
        if (expression.includes("countSemanticMatches")) return { result: { value: 2 } };
        return { result: { objectId: expression.endsWith(", 0);\n  })()") ? "first" : "second" } };
      }
      if (method === "DOM.requestNode") return { nodeId: 1 };
      return {};
    });
    const frame = { frameId: "root", session: { send } } as unknown as Frame;
    const readiness = vi.spyOn(executionContexts, "waitForLocatorWorld").mockResolvedValue({
      kind: "extension",
      contextId: 1,
      capabilities: { closedShadowRoots: true },
    });
    return { resolver: new FrameSelectorResolver(frame), readiness, send };
  }

  it("uses the same semantic plan for count and nth and releases discarded handles", async () => {
    const { resolver, readiness, send } = createResolver();
    await runWithProgress({ name: "resolve", timeout: 1_000 }, async (progress) => {
      await expect(resolver.count(query, progress)).resolves.toBe(2);
      await expect(resolver.resolveAtIndex(query, 1, progress)).resolves.toEqual({
        objectId: "second",
        nodeId: 1,
      });
      expect(readiness.mock.calls.every(([, , , context]) => context === progress)).toBe(true);
      expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "first" });
      const expressions = send.mock.calls
        .filter(([method]) => method === "Runtime.evaluate")
        .map(([, params]) => (params as { expression: string }).expression);
      expect(expressions).toHaveLength(3);
      expect(expressions.every((expression) => expression.includes(JSON.stringify(steps)))).toBe(
        true,
      );
      expect(expressions[0]).toContain('scripts["countSemanticMatches"]');
      expect(expressions[1]).toContain('scripts["resolveSemanticSelector"]');
    });
  });

  it.each(["count", "resolve"] as const)(
    "propagates semantic evaluation errors during %s",
    async (operation) => {
      const { resolver, send } = createResolver();
      const details = { text: "Uncaught", exception: { description: "Unsupported role state" } };
      send.mockImplementation(async (method) =>
        method === "Runtime.evaluate"
          ? { result: { objectId: "error-handle" }, exceptionDetails: details }
          : {},
      );
      await runWithProgress({ name: "resolve", timeout: 1_000 }, async (progress) => {
        const pending =
          operation === "count"
            ? resolver.count(query, progress)
            : resolver.resolveAtIndex(query, 0, progress);
        await expect(pending).rejects.toMatchObject({
          message: "Unsupported role state",
          cause: details,
        });
        expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "error-handle" });
      });
    },
  );

  it.each(["count", "resolve"] as const)(
    "releases a late %s response after the shared deadline",
    async (operation) => {
      vi.useFakeTimers();
      const { resolver, send } = createResolver();
      let respond!: (value: unknown) => void;
      const response = new Promise((resolve) => {
        respond = resolve;
      });
      send.mockImplementation(async (method) => (method === "Runtime.evaluate" ? response : {}));
      const pending = runWithProgress({ name: "semantic lookup", timeout: 10 }, async (progress) =>
        operation === "count"
          ? resolver.count(query, progress)
          : resolver.resolveAtIndex(query, 0, progress),
      );
      const rejected = expect(pending).rejects.toThrow("semantic lookup timed out");
      await vi.advanceTimersByTimeAsync(10);
      await rejected;
      respond({ result: { objectId: "late-handle" } });
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "late-handle" });
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
