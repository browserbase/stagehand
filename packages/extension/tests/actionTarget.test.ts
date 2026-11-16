import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSelectedTarget } from "../services/decisions/actionTarget.js";
import { resolveLocatorWithHops } from "../understudy/deepLocator.js";
import type { Page } from "../understudy/page.js";
import { Progress } from "../understudy/progress.js";

vi.mock("../understudy/deepLocator.js", () => ({ resolveLocatorWithHops: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

function fixture(hitKind: "target" | "child" | "parent" | "host" | "cover" | "none") {
  const document = { elementFromPoint: () => hit };
  class Element {
    isConnected = true;
    tagName = "BUTTON";
    textContent = "";
    parent?: Element;
    root: typeof document | ShadowRoot = document;
    matches() {
      return false;
    }
    closest() {
      return null;
    }
    getAttribute() {
      return null;
    }
    getBoundingClientRect() {
      return { x: 10, y: 10, width: 20, height: 20 };
    }
    getRootNode() {
      return this.root;
    }
    contains(other: Element): boolean {
      return other === this || (!!other.parent && this.contains(other.parent));
    }
  }
  class ShadowRoot {
    constructor(readonly host: Element) {}
    elementFromPoint() {
      return null;
    }
  }
  const target = new Element();
  const other = new Element();
  if (hitKind === "child") other.parent = target;
  if (hitKind === "parent") target.parent = other;
  if (hitKind === "host") target.root = new ShadowRoot(other);
  const hit = hitKind === "target" ? target : hitKind === "none" ? null : other;
  const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "DOM.describeNode") return { node: { backendNodeId: 12 } };
    if (method === "Runtime.callFunctionOn") {
      const value = await runInNewContext(
        `(${String(params!.functionDeclaration)}).call(target, true)`,
        {
          target,
          document,
          ShadowRoot,
          innerWidth: 100,
          innerHeight: 100,
          requestAnimationFrame: (callback: () => void) => callback(),
          setTimeout: () => 0,
        },
      );
      return { result: { value } };
    }
    return {};
  });
  const locator = {
    getFrame: () => ({ frameId: "main", session: { send } }),
    resolveNode: vi.fn(async () => ({ objectId: "selected" })),
    backendNodeId: vi.fn(async () => 99),
  };
  vi.mocked(resolveLocatorWithHops).mockResolvedValue(locator as never);
  const page = { mainFrame: () => ({}), getOrdinal: () => 0 } as unknown as Page;
  return { page, locator, send };
}

describe("selected pointer target", () => {
  it.each(["target", "child", "host"] as const)("accepts a hit on its %s", async (hit) => {
    const { page, locator, send } = fixture(hit);
    expect(
      await checkSelectedTarget(page, "button", "0-12", true, new Progress("target", 0)),
    ).toEqual({ verdict: "ok" });
    expect(locator.resolveNode).toHaveBeenCalledTimes(1);
    expect(locator.backendNodeId).not.toHaveBeenCalled();
    expect(send).toHaveBeenNthCalledWith(1, "DOM.describeNode", { objectId: "selected" });
    expect(send).toHaveBeenLastCalledWith("Runtime.releaseObject", { objectId: "selected" });
  });

  it.each(["parent", "cover", "none"] as const)("rejects a hit on %s", async (hit) => {
    const { page } = fixture(hit);
    expect(
      await checkSelectedTarget(page, "button", "0-12", true, new Progress("target", 0)),
    ).toMatchObject({ verdict: hit === "none" ? "no_hit" : "covered" });
  });
});
