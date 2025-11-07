import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";

test.describe("Page.goto() response surface", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("returns a response object for network navigations", async () => {
    const page = v3.context.pages()[0];

    const response = await page.goto("https://example.com");

    expect(response).not.toBeNull();
    expect(response!.status()).toBe(200);
    expect(response!.ok()).toBeTruthy();

    const headers = await response.headersArray();
    expect(headers.length).toBeGreaterThan(0);

    const body = await response.text();
    expect(body).toContain("Example Domain");

    const finished = await response.finished();
    expect(finished).toBeNull();
  });

  test("falls back to null for data URLs", async () => {
    const page = v3.context.pages()[0];

    const response = await page.goto(
      "data:text/html,<html><body data-testid='fallback'>inline</body></html>",
    );

    expect(response).toBeNull();
  });
});
