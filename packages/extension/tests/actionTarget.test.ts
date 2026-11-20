import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSelectedTarget } from "../services/decisions/actionTarget.js";
import { resolveLocatorWithHops } from "../understudy/deepLocator.js";
import type { Page } from "../understudy/page.js";
import { Progress } from "../understudy/progress.js";

vi.mock("../understudy/deepLocator.js", () => ({ resolveLocatorWithHops: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

function fixture(
  hitKind: "target" | "child" | "parent" | "host" | "cover" | "none",
  frameContentQuad?: number[],
) {
  const document = { elementFromPoint: vi.fn((_x: number, _y: number) => hit) };
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
    if (method === "DOM.getFrameOwner") return { backendNodeId: 34 };
    if (method === "DOM.getBoxModel" && params?.backendNodeId === 34)
      return { model: { content: frameContentQuad } };
    if (method === "DOM.describeNode") return { node: { backendNodeId: 12 } };
    if (method === "Runtime.callFunctionOn") {
      const value = await runInNewContext(
        `(${String(params!.functionDeclaration)}).apply(target,args)`,
        {
          args: (params!.arguments as { value: unknown }[]).map((arg) => arg.value),
          target,
          document,
          ShadowRoot,
          innerWidth: 100,
          innerHeight: 100,
          performance,
          window: { setTimeout: () => 0 },
          clearTimeout,
          cancelAnimationFrame: () => {},
          requestAnimationFrame: (callback: () => void) => callback(),
        },
      );
      return { result: { value } };
    }
    return {};
  });
  const session = { send };
  const locator = {
    contentPoint: vi.fn(async () => ({ cx: 24.5, cy: 18.5 })),
    getFrame: () => ({ frameId: frameContentQuad ? "child" : "main", session }),
    resolveNode: vi.fn(async () => ({ objectId: "selected" })),
    backendNodeId: vi.fn(async () => 99),
  };
  vi.mocked(resolveLocatorWithHops).mockResolvedValue(locator as never);
  const page = {
    registry: { getParent: () => (frameContentQuad ? "main" : null) },
    getSessionForFrame: () => session,
    mainFrame: () => ({}),
    getOrdinal: () => 0,
  } as unknown as Page;
  return { page, locator, send, document };
}

describe("selected pointer target", () => {
  it.each(["target", "child", "host"] as const)("accepts a hit on its %s", async (hit) => {
    const { page, locator, send, document } = fixture(hit);
    expect(
      await checkSelectedTarget(page, "button", "0-12", true, new Progress("target", 0)),
    ).toEqual({ verdict: "ok" });
    expect(document.elementFromPoint).toHaveBeenCalledWith(24.5, 18.5);
    expect(locator.resolveNode).toHaveBeenCalledTimes(1);
    expect(locator.backendNodeId).not.toHaveBeenCalled();
    expect(send).toHaveBeenNthCalledWith(1, "DOM.describeNode", { objectId: "selected" });
    expect(send).toHaveBeenLastCalledWith("Runtime.releaseObject", { objectId: "selected" });
  });

  it("projects the dispatch point into a perspective-transformed child viewport", async () => {
    const { page, locator, document } = fixture("target", [5, 7, 205, 7, 155, 107, 5, 107]);
    // One quarter across and halfway down a trapezoid's untransformed viewport.
    locator.contentPoint.mockResolvedValue({ cx: 5 + 300 / 7, cy: 7 + 400 / 7 });
    const result = await checkSelectedTarget(
      page,
      "button",
      "0-12",
      true,
      new Progress("target", 0),
    );
    expect(result.verdict).toBe("ok");
    const [x, y] = document.elementFromPoint.mock.calls[0]!;
    expect(x).toBeCloseTo(25);
    expect(y).toBeCloseTo(50);
  });

  it("rejects a collapsed iframe before hit testing", async () => {
    const { page, document } = fixture("target", [1, 1, 1, 1, 1, 1, 1, 1]);
    const result = await checkSelectedTarget(
      page,
      "button",
      "0-12",
      true,
      new Progress("target", 0),
    );
    expect(result.verdict).toBe("no_hit");
    expect(document.elementFromPoint).not.toHaveBeenCalled();
  });

  it.each(["parent", "cover", "none"] as const)("rejects a hit on %s", async (hit) => {
    const { page } = fixture(hit);
    expect(
      await checkSelectedTarget(page, "button", "0-12", true, new Progress("target", 0)),
    ).toMatchObject({ verdict: hit === "none" ? "no_hit" : "covered" });
  });
});
