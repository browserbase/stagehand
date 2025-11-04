import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";

test.describe("Page console events", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("captures console messages emitted by the page", async () => {
    const page = v3.context.pages()[0];
    const received: Array<{ type: string; text: string }> = [];

    page.on("console", (message) => {
      received.push({ type: message.type(), text: message.text() });
    });

    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-hn/",
    );

    await page.evaluate(() => {
      console.log("stagehand console", { ok: true });
      console.error("stagehand console error");
    });

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(received.length).toBeGreaterThanOrEqual(2);
    expect(received.some((m) => m.type === "log")).toBeTruthy();
    expect(
      received.some((m) => m.type === "error" && m.text.includes("error")),
    ).toBeTruthy();
  });
});
