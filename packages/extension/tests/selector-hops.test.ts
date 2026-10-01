import { describe, expect, it } from "vitest";
import { resolveLocatorTarget } from "../understudy/deepLocator.js";
import type { Frame } from "../understudy/frame.js";
import type { Page } from "../understudy/page.js";
import { FrameSelectorResolver } from "../understudy/selectorResolver.js";

describe("iframe hop separator", () => {
  it("keeps '>>' inside a quoted CSS attribute value", () => {
    expect(FrameSelectorResolver.parseSelector('button[aria-label="Next >>"]')).toEqual({
      kind: "css",
      value: 'button[aria-label="Next >>"]',
    });
  });

  it("still flattens '>>' hops between CSS selectors", () => {
    expect(FrameSelectorResolver.parseSelector("iframe#checkout >> .submit-btn")).toEqual({
      kind: "css",
      value: "iframe#checkout .submit-btn",
    });
  });

  it("does not treat '>>' inside an XPath string literal as an iframe hop", async () => {
    // No frame hop means the root frame is used as-is; a hop would need a live page.
    const root = {} as Frame;
    await expect(resolveLocatorTarget({} as Page, root, "//a[text()='Next >>']")).resolves.toEqual({
      frame: root,
      selector: "xpath=//a[text()='Next >>']",
    });
  });
});
