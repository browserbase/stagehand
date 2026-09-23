import { afterEach, describe, expect, it, vi } from "vitest";
import type { Frame } from "./frame.js";
import type { Page } from "./page.js";
import { DeepLocatorDelegate } from "./deepLocator.js";
import { frameLocatorFromFrame } from "./frameLocator.js";
import { executionContexts } from "./executionContextRegistry.js";
import { Locator } from "./locator.js";
import { runWithProgress } from "./progress.js";

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
  const send = vi.fn(async (method: string) => {
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
  return { locator, frame, resolveNode, readiness };
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
