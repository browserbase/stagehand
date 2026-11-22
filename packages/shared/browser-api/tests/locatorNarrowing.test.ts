import { describe, expect, it } from "vitest";
import type { RPCMethod } from "@browserbasehq/stagehand-protocol/json-rpc/schemas";
import type { StagehandCommandClient } from "../src/commandClient.js";
import { Page } from "../src/page.js";

describe("locator narrowing", () => {
  it("picks the first element when nothing narrowed the locator yet", () => {
    const page = testPage("page-1");

    expect(page.locator("li").first().descriptor.nth).toBe(0);
  });

  it("keeps the element a helper already picked when it calls first()", () => {
    const page = testPage("page-1");

    expect(page.locator("li").nth(2).first().descriptor.nth).toBe(2);
  });

  it("keeps the element on nth(0), which every one-element set maps to itself", () => {
    const page = testPage("page-1");

    expect(page.locator("li").nth(2).nth(0).descriptor.nth).toBe(2);
  });

  it("refuses a second narrowing instead of retargeting another element", () => {
    const page = testPage("page-1");

    expect(() => page.locator("li").nth(2).nth(1)).toThrow(RangeError);
    expect(() => page.locator("li").nth(2).nth(1)).toThrow(/already narrowed to one element/);
  });

  it("narrows an unnarrowed locator to the index asked for", () => {
    const page = testPage("page-1");

    expect(page.locator("li").nth(3).descriptor.nth).toBe(3);
  });

  it("still validates the index when nothing narrowed the locator yet", () => {
    const page = testPage("page-1");

    expect(() => page.locator("li").nth(-1)).toThrow();
  });
});

function testPage(pageId: string): Page {
  return new Page(
    {
      send: async <Method extends RPCMethod>(
        _method: Method,
        _params: unknown,
      ): Promise<unknown> => {
        throw new Error("Unexpected RPC call");
      },
      onNotification: () => () => {},
    } as StagehandCommandClient,
    { pageId },
  );
}
