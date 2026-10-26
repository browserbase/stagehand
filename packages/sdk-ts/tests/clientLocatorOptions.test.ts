import { describe, expect, it } from "vitest";
import type { RPCMethod } from "@browserbasehq/stagehand-protocol/json-rpc/schemas";
import {
  serializeClientLocator,
  serializeClientLocatorOptions,
} from "../src/clientLocatorOptions.js";
import type { StagehandCommandClient } from "../src/commandClient.js";
import { Page } from "../src/page.js";

describe("client locator option serialization", () => {
  it("preserves nth: 0 from first() locators", () => {
    const page = testPage("page-1");

    expect(serializeClientLocator(page.locator("button").first(), "page-1", "observe")).toEqual({
      selector: "button",
      nth: 0,
    });
  });

  it("serializes empty ignoreLocators arrays and preserves non-locator fields", () => {
    const page = testPage("page-1");
    const options = serializeClientLocatorOptions("extract", "page-1", {
      locator: page.locator("main").nth(2),
      ignoreLocators: [],
      model: { modelName: "openai/gpt-5.4-mini" },
      timeout: 30_000,
      variables: { accountEmail: "user@example.com" },
    });

    expect(options).toEqual({
      locator: { selector: "main", nth: 2 },
      ignoreLocators: [],
      model: { modelName: "openai/gpt-5.4-mini" },
      timeout: 30_000,
      variables: { accountEmail: "user@example.com" },
    });
  });

  it("rejects locators from another page", () => {
    const otherPage = testPage("page-2");

    expect(() => serializeClientLocator(otherPage.locator("main"), "page-1", "observe")).toThrow(
      "observe(): locator must belong to the target page",
    );
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
