import { describe, expect, it } from "vitest";
import { StagehandMethods } from "../schema-registry.js";

describe("page.wait_for_url", () => {
  const params = StagehandMethods.pageWaitForURL.params;
  it("preserves the URL glob and explicit unbounded timeout", () => {
    const input = {
      pageId: "page",
      url: "**/done?ok=1",
      options: { waitUntil: "load", timeout: 0 },
    };
    expect(params.parse(input)).toEqual(input);
  });
  it.each([
    { url: "" },
    { options: { waitUntil: "networkidle" } },
    { options: { timeout: -1 } },
    { options: { timeout: 1.5 } },
    { options: { unknown: true } },
  ])("rejects unsupported options: %j", (overrides) => {
    expect(params.safeParse({ pageId: "page", url: "**/done", ...overrides }).success).toBe(false);
  });
});
