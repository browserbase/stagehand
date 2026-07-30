import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

describe("cookies", () => {
  let fixtureServer: FixtureServer;
  let stagehand: Stagehand;

  beforeAll(async () => {
    fixtureServer = await startFixtureServer({
      "/": "<!doctype html><html><body>cookies</body></html>",
      "/different-path": "<!doctype html><html><body>different path</body></html>",
    });
    stagehand = await createStagehand();
  });

  afterAll(async () => {
    await closeStagehand(stagehand);
    await fixtureServer.close();
  });

  it("addCookies sets a cookie visible to the page", async () => {
    const ctx = stagehand.context;
    const page = (await ctx.pages())[0];
    expect(page).toBeDefined();
    await page!.goto(fixtureServer.url);

    const name = `stagehand_cookie_${Date.now()}`;
    await ctx.addCookies([{ name, value: "1", url: fixtureServer.url, httpOnly: false }]);
    await page!.reload();

    const cookieString = await page!.evaluate<string>(() => document.cookie);
    expect(cookieString).toContain(`${name}=1`);
    const cookies = await ctx.cookies(fixtureServer.url);
    expect(cookies.some((cookie) => cookie.name === name && cookie.value === "1")).toBe(true);
  });

  it("cookies() with no URL returns all cookies", async () => {
    const ctx = stagehand.context;
    const page = (await ctx.pages())[0]!;
    await page.goto(fixtureServer.url);

    const name = `stagehand_all_${Date.now()}`;
    await ctx.addCookies([{ name, value: "all", url: fixtureServer.url, httpOnly: false }]);

    const all = await ctx.cookies();
    expect(all.some((cookie) => cookie.name === name)).toBe(true);
  });

  it("clearCookies() removes all cookies", async () => {
    const ctx = stagehand.context;
    const page = (await ctx.pages())[0]!;
    await page.goto(fixtureServer.url);
    await ctx.addCookies([
      { name: "to_clear_a", value: "1", url: fixtureServer.url, httpOnly: false },
      { name: "to_clear_b", value: "2", url: fixtureServer.url, httpOnly: false },
    ]);

    let cookies = await ctx.cookies(fixtureServer.url);
    expect(cookies.some((cookie) => cookie.name === "to_clear_a")).toBe(true);
    expect(cookies.some((cookie) => cookie.name === "to_clear_b")).toBe(true);

    await ctx.clearCookies();
    cookies = await ctx.cookies(fixtureServer.url);
    expect(cookies.some((cookie) => cookie.name === "to_clear_a")).toBe(false);
    expect(cookies.some((cookie) => cookie.name === "to_clear_b")).toBe(false);
  });

  it("clearCookies() with name filter removes only matching cookies", async () => {
    const ctx = stagehand.context;
    const page = (await ctx.pages())[0]!;
    await page.goto(fixtureServer.url);
    await ctx.addCookies([
      { name: "keep_me", value: "1", url: fixtureServer.url, httpOnly: false },
      { name: "remove_me", value: "2", url: fixtureServer.url, httpOnly: false },
    ]);

    await ctx.clearCookies({ name: "remove_me" });
    const cookies = await ctx.cookies(fixtureServer.url);
    expect(cookies.some((cookie) => cookie.name === "keep_me")).toBe(true);
    expect(cookies.some((cookie) => cookie.name === "remove_me")).toBe(false);
  });

  it("clearCookies() with regex filter removes matching cookies", async () => {
    const ctx = stagehand.context;
    const page = (await ctx.pages())[0]!;
    await page.goto(fixtureServer.url);
    await ctx.addCookies([
      { name: "_ga_ABC", value: "1", url: fixtureServer.url, httpOnly: false },
      { name: "_ga_DEF", value: "2", url: fixtureServer.url, httpOnly: false },
      { name: "session", value: "3", url: fixtureServer.url, httpOnly: false },
    ]);

    await ctx.clearCookies({ name: /^_ga/ });
    const cookies = await ctx.cookies(fixtureServer.url);
    expect(cookies.some((cookie) => cookie.name === "session")).toBe(true);
    expect(cookies.some((cookie) => cookie.name === "_ga_ABC")).toBe(false);
    expect(cookies.some((cookie) => cookie.name === "_ga_DEF")).toBe(false);
  });

  it("cookies are visible from a second page on the same domain", async () => {
    const ctx = stagehand.context;
    const page1 = (await ctx.pages())[0]!;
    await page1.goto(fixtureServer.url);

    const name = `stagehand_multi_${Date.now()}`;
    await ctx.addCookies([{ name, value: "shared", url: fixtureServer.url, httpOnly: false }]);

    const page2 = await ctx.newPage();
    await page2.goto(fixtureServer.url);
    const cookieString = await page2.evaluate<string>(() => document.cookie);
    expect(cookieString).toContain(`${name}=shared`);
    await page2.close();
  });

  it("cookies persist across navigation to a different path", async () => {
    const ctx = stagehand.context;
    const page = (await ctx.pages())[0]!;
    await page.goto(fixtureServer.url);

    const name = `stagehand_nav_${Date.now()}`;
    await ctx.addCookies([
      {
        name,
        value: "persisted",
        domain: "127.0.0.1",
        path: "/",
        httpOnly: false,
      },
    ]);

    await page.goto(new URL("/different-path", fixtureServer.url).href);
    const cookieString = await page.evaluate<string>(() => document.cookie);
    expect(cookieString).toContain(`${name}=persisted`);
  });

  it("httpOnly cookie is hidden from document.cookie but returned by cookies()", async () => {
    const ctx = stagehand.context;
    const page = (await ctx.pages())[0]!;
    await page.goto(fixtureServer.url);

    const name = `stagehand_http_${Date.now()}`;
    await ctx.addCookies([{ name, value: "secret", url: fixtureServer.url, httpOnly: true }]);
    await page.reload();

    const cookieString = await page.evaluate<string>(() => document.cookie);
    expect(cookieString).not.toContain(name);
    const cookies = await ctx.cookies(fixtureServer.url);
    const match = cookies.find((cookie) => cookie.name === name);
    expect(match).toBeDefined();
    expect(match!.value).toBe("secret");
    expect(match!.httpOnly).toBe(true);
  });

  it("cookies() returns correct shape for a fully-specified cookie", async () => {
    const ctx = stagehand.context;
    const page = (await ctx.pages())[0]!;
    await page.goto(fixtureServer.url);

    const name = `stagehand_shape_${Date.now()}`;
    const expires = Math.floor(Date.now() / 1000) + 3600;
    await ctx.addCookies([
      {
        name,
        value: "full",
        domain: "127.0.0.1",
        path: "/",
        expires,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);

    const cookies = await ctx.cookies(fixtureServer.url);
    const match = cookies.find((cookie) => cookie.name === name);
    expect(match).toBeDefined();
    expect(match!.value).toBe("full");
    expect(match!.domain).toMatch(/127\.0\.0\.1/);
    expect(match!.path).toBe("/");
    expect(match!.expires).toBeGreaterThan(0);
    expect(match!.httpOnly).toBe(true);
    expect(match!.secure).toBe(true);
    expect(match!.sameSite).toBe("Lax");

    const keys = Object.keys(match!);
    expect(keys.sort()).toEqual(
      ["name", "value", "domain", "path", "expires", "httpOnly", "secure", "sameSite"].sort(),
    );
  });
});
