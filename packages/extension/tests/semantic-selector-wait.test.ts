import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { querySemanticSelector } from "../dom/locatorScripts/semanticSelectors.js";
import { createSelectorWait } from "../dom/locatorScripts/waitForSelector.js";
import type { QueryStep } from "@browserbasehq/stagehand-protocol/locator-query";

vi.mock("../dom/locatorScripts/semanticSelectors.js", () => ({
  querySemanticSelector: vi.fn(),
}));

describe("semantic selector waits", () => {
  const query = vi.mocked(querySemanticSelector);
  const observers: {
    callback: () => void;
    observe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  const match = { children: [] } as unknown as Element;
  const role: QueryStep = { kind: "role", role: "button", options: { name: "Publish" } };
  const text: QueryStep = { kind: "text", text: "Publish >> now", exact: true };
  let shadow: { children: object[] };
  let dom: {
    body: { children: object[]; shadowRoot: typeof shadow };
    documentElement: null;
    querySelector: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    query.mockReset().mockReturnValue([]);
    observers.length = 0;
    shadow = { children: [] };
    dom = {
      body: { children: [], shadowRoot: shadow },
      documentElement: null,
      querySelector: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("document", dom);
    vi.stubGlobal(
      "MutationObserver",
      class {
        observe = vi.fn();
        disconnect = vi.fn();
        constructor(callback: () => void) {
          observers.push({ callback, observe: this.observe, disconnect: this.disconnect });
        }
      },
    );
  });

  afterEach(() => {
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("passes prepared role options to the canonical semantic matcher", async () => {
    query.mockReturnValue([match]);
    const steps: readonly QueryStep[] = [
      { kind: "role", role: "button", options: { name: "Save >> publish", includeHidden: true } },
    ];

    const wait = createSelectorWait(steps, "attached", 100, false);

    await expect(wait.promise).resolves.toBe(true);
    expect(query).toHaveBeenCalledExactlyOnceWith(steps, dom, { pierceShadow: false });
    expect(dom.querySelector).not.toHaveBeenCalled();
    expect(observers).toHaveLength(0);
  });

  it("keeps observation and matching in the light DOM when piercing is disabled", async () => {
    const wait = createSelectorWait([text], "attached", 100, false);

    expect(query).toHaveBeenCalledExactlyOnceWith([text], dom, { pierceShadow: false });
    expect(observers).toHaveLength(1);
    expect(observers[0].observe).toHaveBeenCalledWith(dom.body, expect.any(Object));
    expect(vi.getTimerCount()).toBe(2);

    query.mockReturnValue([match]);
    observers[0].callback();
    await expect(wait.promise).resolves.toBe(true);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
  });

  it("detects property-only state changes without shadow piercing or DOM mutations", async () => {
    const step: QueryStep = { kind: "role", role: "checkbox", options: { checked: true } };
    const wait = createSelectorWait([step], "attached", 0, false);
    expect(vi.getTimerCount()).toBe(1);
    expect(observers).toHaveLength(1);

    // Setting an input's checked property does not emit a mutation record.
    query.mockReturnValue([match]);
    await vi.advanceTimersByTimeAsync(99);
    expect(query).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    await expect(wait.promise).resolves.toBe(true);
    expect(query).toHaveBeenLastCalledWith([step], dom, { pierceShadow: false });
    expect(query).toHaveBeenCalledTimes(2);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([role, text])(
    "observes text and ARIA mutations for $kind matching and cleans up on success",
    async (step) => {
      const wait = createSelectorWait([step], "attached", 100);

      expect(query).toHaveBeenCalledExactlyOnceWith([step], dom, { pierceShadow: true });
      expect(observers).toHaveLength(2);
      const options = {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      };
      expect(observers[0].observe).toHaveBeenCalledExactlyOnceWith(dom.body, options);
      expect(observers[1].observe).toHaveBeenCalledExactlyOnceWith(shadow, options);
      expect(vi.getTimerCount()).toBe(2);

      query.mockReturnValue([match]);
      observers[1].callback();
      await expect(wait.promise).resolves.toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(query).toHaveBeenCalledTimes(2);

      wait.dispose();
      for (const observer of observers) {
        observer.callback();
        expect(observer.disconnect).toHaveBeenCalledOnce();
      }
      expect(query).toHaveBeenCalledTimes(2);
      expect(observers).toHaveLength(2);
    },
  );

  it("rejects initial matcher errors immediately without installing observers or timers", async () => {
    const error = new Error('"checked" attribute is not supported for this role');
    query.mockImplementation(() => {
      throw error;
    });

    const wait = createSelectorWait([role], "attached", 100);

    await expect(wait.promise).rejects.toBe(error);
    expect(observers).toHaveLength(0);
    expect(dom.addEventListener).not.toHaveBeenCalled();
  });

  it("propagates a later matcher error and cleans up the active wait", async () => {
    const wait = createSelectorWait([role], "attached", 100);
    const error = new Error("Cannot evaluate accessible name");
    query.mockImplementation(() => {
      throw error;
    });

    observers[0].callback();

    await expect(wait.promise).rejects.toBe(error);
    for (const observer of observers) expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([undefined, 75])(
    "includes the query description when timeout %s expires",
    async (timeout) => {
      const duration = timeout ?? 30_000;
      const settled = vi.fn();
      const wait = createSelectorWait([role], "attached", timeout, false);
      void wait.promise.then(settled, settled);
      const rejected = expect(wait.promise).rejects.toThrow(
        `Timeout ${duration}ms exceeded waiting for "${JSON.stringify([role])}" to be attached`,
      );

      await vi.advanceTimersByTimeAsync(duration - 1);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      expect(observers[0].disconnect).toHaveBeenCalledOnce();
    },
  );
});
