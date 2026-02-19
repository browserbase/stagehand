import { test, expect } from "@playwright/test";
import { V3 } from "../v3.js";
import { v3DynamicTestConfig } from "./v3.dynamic.config.js";
import { closeV3 } from "./testUtils.js";

const BASE_URL =
  "https://browserbase.github.io/stagehand-eval-sites/sites/example/";

test.describe("cookies", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3DynamicTestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await closeV3(v3);
  });

  test("addCookies sets a cookie visible to the page", async () => {
    const ctx = v3.context;
    const page = ctx.pages()[0];
    expect(page).toBeDefined();

    await page!.goto(BASE_URL);

    const name = `stagehand_cookie_${Date.now()}`;
    await ctx.addCookies([
      {
        name,
        value: "1",
        url: BASE_URL,
        httpOnly: false,
      },
    ]);

    await page!.reload();

    const cookieString = await page!.evaluate(() => document.cookie);
    expect(cookieString).toContain(`${name}=1`);

    const cookies = await ctx.cookies(BASE_URL);
    expect(cookies.some((c) => c.name === name && c.value === "1")).toBe(true);
  });

  test("cookies() with no URL returns all cookies", async () => {
    const ctx = v3.context;
    const page = ctx.pages()[0]!;
    await page.goto(BASE_URL);

    const name = `stagehand_all_${Date.now()}`;
    await ctx.addCookies([
      { name, value: "all", url: BASE_URL, httpOnly: false },
    ]);

    const all = await ctx.cookies();
    expect(all.some((c) => c.name === name)).toBe(true);
  });

  test("clearCookies() removes all cookies", async () => {
    const ctx = v3.context;
    const page = ctx.pages()[0]!;
    await page.goto(BASE_URL);

    await ctx.addCookies([
      { name: "to_clear_a", value: "1", url: BASE_URL, httpOnly: false },
      { name: "to_clear_b", value: "2", url: BASE_URL, httpOnly: false },
    ]);

    // Verify cookies were set
    let cookies = await ctx.cookies(BASE_URL);
    expect(cookies.some((c) => c.name === "to_clear_a")).toBe(true);
    expect(cookies.some((c) => c.name === "to_clear_b")).toBe(true);

    await ctx.clearCookies();

    cookies = await ctx.cookies(BASE_URL);
    expect(cookies.some((c) => c.name === "to_clear_a")).toBe(false);
    expect(cookies.some((c) => c.name === "to_clear_b")).toBe(false);
  });

  test("clearCookies() with name filter removes only matching cookies", async () => {
    const ctx = v3.context;
    const page = ctx.pages()[0]!;
    await page.goto(BASE_URL);

    await ctx.addCookies([
      { name: "keep_me", value: "1", url: BASE_URL, httpOnly: false },
      { name: "remove_me", value: "2", url: BASE_URL, httpOnly: false },
    ]);

    await ctx.clearCookies({ name: "remove_me" });

    const cookies = await ctx.cookies(BASE_URL);
    expect(cookies.some((c) => c.name === "keep_me")).toBe(true);
    expect(cookies.some((c) => c.name === "remove_me")).toBe(false);
  });

  test("clearCookies() with regex filter removes matching cookies", async () => {
    const ctx = v3.context;
    const page = ctx.pages()[0]!;
    await page.goto(BASE_URL);

    await ctx.addCookies([
      { name: "_ga_ABC", value: "1", url: BASE_URL, httpOnly: false },
      { name: "_ga_DEF", value: "2", url: BASE_URL, httpOnly: false },
      { name: "session", value: "3", url: BASE_URL, httpOnly: false },
    ]);

    await ctx.clearCookies({ name: /^_ga/ });

    const cookies = await ctx.cookies(BASE_URL);
    expect(cookies.some((c) => c.name === "session")).toBe(true);
    expect(cookies.some((c) => c.name === "_ga_ABC")).toBe(false);
    expect(cookies.some((c) => c.name === "_ga_DEF")).toBe(false);
  });

  test("cookies are visible from a second page on the same domain", async () => {
    const ctx = v3.context;
    const page1 = ctx.pages()[0]!;
    await page1.goto(BASE_URL);

    const name = `stagehand_multi_${Date.now()}`;
    await ctx.addCookies([
      { name, value: "shared", url: BASE_URL, httpOnly: false },
    ]);

    const page2 = await ctx.newPage();
    await page2.goto(BASE_URL);

    const cookieString = await page2.evaluate(() => document.cookie);
    expect(cookieString).toContain(`${name}=shared`);
  });

  test("cookies persist across navigation to a different path", async () => {
    const ctx = v3.context;
    const page = ctx.pages()[0]!;
    await page.goto(BASE_URL);

    const name = `stagehand_nav_${Date.now()}`;
    await ctx.addCookies([
      {
        name,
        value: "persisted",
        domain: "browserbase.github.io",
        path: "/",
        httpOnly: false,
      },
    ]);

    // Navigate to a different path on the same domain
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/example/",
    );

    const cookieString = await page.evaluate(() => document.cookie);
    expect(cookieString).toContain(`${name}=persisted`);
  });

  test("httpOnly cookie is hidden from document.cookie but returned by cookies()", async () => {
    const ctx = v3.context;
    const page = ctx.pages()[0]!;
    await page.goto(BASE_URL);

    const name = `stagehand_http_${Date.now()}`;
    await ctx.addCookies([
      { name, value: "secret", url: BASE_URL, httpOnly: true },
    ]);

    await page.reload();

    // document.cookie must NOT include httpOnly cookies
    const cookieString = await page.evaluate(() => document.cookie);
    expect(cookieString).not.toContain(name);

    // But the context API should still return it
    const cookies = await ctx.cookies(BASE_URL);
    const match = cookies.find((c) => c.name === name);
    expect(match).toBeDefined();
    expect(match!.value).toBe("secret");
    expect(match!.httpOnly).toBe(true);
  });

  test("cookies() returns correct shape for a fully-specified cookie", async () => {
    const ctx = v3.context;
    const page = ctx.pages()[0]!;
    await page.goto(BASE_URL);

    const name = `stagehand_shape_${Date.now()}`;
    const expires = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    await ctx.addCookies([
      {
        name,
        value: "full",
        domain: "browserbase.github.io",
        path: "/",
        expires,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);

    const cookies = await ctx.cookies(BASE_URL);
    const match = cookies.find((c) => c.name === name);
    expect(match).toBeDefined();

    // Validate every field on the returned Cookie object
    expect(match!.value).toBe("full");
    expect(match!.domain).toMatch(/browserbase\.github\.io/);
    expect(match!.path).toBe("/");
    expect(match!.expires).toBeGreaterThan(0);
    expect(match!.httpOnly).toBe(true);
    expect(match!.secure).toBe(true);
    expect(match!.sameSite).toBe("Lax");

    // Ensure no extra fields leak through from CDP
    const keys = Object.keys(match!);
    expect(keys.sort()).toEqual(
      [
        "name",
        "value",
        "domain",
        "path",
        "expires",
        "httpOnly",
        "secure",
        "sameSite",
      ].sort(),
    );
  });
});
