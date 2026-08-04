import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMaskRect } from "../dom/screenshotScripts/resolveMaskRect.js";

type Rect = Pick<DOMRect, "bottom" | "height" | "left" | "right" | "top" | "width">;

function rect(left: number, top: number, width: number, height: number): Rect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

describe("resolveMaskRect", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("measures top-layer masks with 3D transforms neutralized and restores inline styles", () => {
    const declarations = new Map<string, { value: string; priority: string }>([
      ["transform", { value: "perspective(480px) rotateY(24deg)", priority: "" }],
      ["scale", { value: "1.15", priority: "important" }],
    ]);
    const style = {
      getPropertyValue: (property: string) => declarations.get(property)?.value ?? "",
      getPropertyPriority: (property: string) => declarations.get(property)?.priority ?? "",
      setProperty: (property: string, value: string, priority = "") => {
        declarations.set(property, { value, priority });
      },
      removeProperty: (property: string) => declarations.delete(property),
    };
    const transformsAreNeutral = () =>
      ["transform", "translate", "rotate", "scale"].every(
        (property) => declarations.get(property)?.value === "none",
      );
    const root = {
      clientLeft: 2,
      clientTop: 3,
      scrollLeft: 5,
      scrollTop: 7,
      style,
      getBoundingClientRect: () =>
        transformsAreNeutral() ? rect(100, 120, 300, 180) : rect(420, 260, 360, 210),
      getAttribute: () => null,
      setAttribute: vi.fn(),
    };
    const target = {
      closest: (selector: string) => (selector === "dialog[open]" ? root : null),
      getBoundingClientRect: () =>
        transformsAreNeutral() ? rect(130, 150, 80, 20) : rect(470, 310, 120, 38),
    };
    vi.stubGlobal("window", {
      getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    });

    expect(resolveMaskRect.call(target as unknown as Element)).toEqual({
      x: 30,
      y: 31,
      width: 86,
      height: 26,
      rootToken: null,
    });
    expect(declarations).toEqual(
      new Map([
        ["transform", { value: "perspective(480px) rotateY(24deg)", priority: "" }],
        ["scale", { value: "1.15", priority: "important" }],
      ]),
    );
  });
});
