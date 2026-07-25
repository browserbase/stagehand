import { describe, expect, it } from "vitest";
import * as NodeVariant from "../src/runtime/node/index.js";
import * as WebVariant from "../src/runtime/web/index.js";

describe("TypeScript SDK runtime variants", () => {
  it("keeps local browser support in the Node variant", () => {
    expect(NodeVariant.BrowserSourceSchema.parse({ type: "local", headless: true })).toStrictEqual({
      type: "local",
      headless: true,
    });
    expect(
      new NodeVariant.Stagehand({
        browser: { type: "local", headless: true },
      }).initParams,
    ).toStrictEqual({
      browser: { type: "local", headless: true },
    });
  });

  it("rejects local browser input immediately in the web variant", () => {
    expect(() => WebVariant.BrowserSourceSchema.parse({ type: "local" })).toThrow();
    expect(
      () =>
        new WebVariant.Stagehand({
          // @ts-expect-error -- The web declaration rejects local sources before runtime validation.
          browser: { type: "local" },
        }),
    ).toThrow();
  });

  it("keeps the same public constructor for remote usage in both variants", () => {
    const initParams = {
      browser: {
        type: "cdp" as const,
        cdpUrl: "wss://browser.example/devtools/browser/session",
      },
    };

    expect(new NodeVariant.Stagehand(initParams).initParams).toStrictEqual(initParams);
    expect(new WebVariant.Stagehand(initParams).initParams).toStrictEqual(initParams);
  });
});
