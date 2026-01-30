import { test, expect } from "@playwright/test";
import { chromium as playwrightChromium } from "playwright";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";

test.describe("CDP session detach handling", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("rejects inflight CDP calls when a target is closed", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };

    process.on("unhandledRejection", onUnhandled);

    let pwBrowser: Awaited<
      ReturnType<typeof playwrightChromium.connectOverCDP>
    > | null = null;

    try {
      pwBrowser = await playwrightChromium.connectOverCDP(v3.connectURL());
      const pwContext = pwBrowser.contexts()[0];
      const pwPage = pwContext.pages()[0];

      const v3Page = v3.context.pages()[0];
      await v3Page.goto("data:text/html,<html><body>cdp</body></html>");

      const pending = v3Page.sendCDP("Runtime.evaluate", {
        expression: "new Promise(r => setTimeout(() => r('done'), 5000))",
        awaitPromise: true,
        returnByValue: true,
      });

      await pwPage.close();

      await expect(pending).rejects.toThrow(/CDP session detached/);

      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      await pwBrowser?.close().catch(() => {});
    }
  });
});
