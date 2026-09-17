import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlaywrightCompatRuntime } from "../src/facade/runtime.js";

const playwrightRequire = createRequire(import.meta.url);
const playwrightCore = path.dirname(playwrightRequire.resolve("playwright-core/package.json"));
const { urlMatches } = playwrightRequire(
  path.join(playwrightCore, "lib/utils/isomorphic/urlMatch.js"),
) as { urlMatches(base: undefined, url: string, match: URLMatch): boolean };

type URLMatch = string | RegExp | ((url: URL) => boolean);
type CompatPage = {
  url(): string;
  waitForURL(match: URLMatch, options?: { timeout?: number; waitUntil?: string }): Promise<void>;
};

async function fixture(initialUrl = "https://example.com/start") {
  let currentUrl = initialUrl;
  const rawPage = {
    pageId: "test-page",
    url: vi.fn(async () => currentUrl),
    evaluate: vi.fn(async () => ({ width: 800, height: 600 })),
    waitForLoadState: vi.fn(async (_state: string, _timeout?: number) => undefined),
  };
  const rawContext = { pages: vi.fn(async () => [rawPage]) };
  // Exercise the same self-contained serialization boundary as callback batches.
  const create = new Function(
    `return (${createPlaywrightCompatRuntime.toString()})`,
  )() as typeof createPlaywrightCompatRuntime;
  const runtime = await create({
    page: rawPage,
    context: rawContext,
  } as unknown as Parameters<typeof createPlaywrightCompatRuntime>[0]);
  return {
    page: runtime.page as CompatPage,
    rawPage,
    runtime,
    navigate: (url: string) => {
      currentUrl = url;
    },
  };
}

describe("facade page.waitForURL", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const matchCases: Array<[string, string, URLMatch]> = [
    ["exact", "https://example.com/done", "https://example.com/done"],
    ["exact mismatch", "https://example.com/done/extra", "https://example.com/done"],
    ["single star", "https://example.com/a", "https://example.com/*"],
    ["single star does not cross slash", "https://example.com/a/b", "https://example.com/*"],
    ["double star", "https://example.com/a/b", "https://example.com/**"],
    ["suffix glob", "https://example.com/a/checkout", "**/checkout"],
    ["alternatives", "https://example.com/cart", "**/{cart,checkout}"],
    ["alternative mismatch", "https://example.com/account", "**/{cart,checkout}"],
    ["literal query", "https://example.com/search?q=x", "**/search?q=*"],
    ["question mark is not wildcard", "https://example.com/searchXq=x", "**/search?q=*"],
    ["escaped star", "https://example.com/a*", "**/a\\*"],
    ["absolute host normalization", "https://example.com/a", "HTTPS://EXAMPLE.COM/a"],
    ["dot segment normalization", "https://example.com/b", "https://example.com/a/../b"],
    ["about URL", "about:blank", "about:blank"],
    ["empty string", "about:blank", ""],
    ["relative has no baseURL", "https://example.com/done", "/done"],
    ["regex", "https://example.com/Done", /\/done$/i],
    ["predicate", "https://example.com/done?ok=1", (url) => url.searchParams.get("ok") === "1"],
  ];
  it.each(matchCases)("matches installed Playwright: %s", async (_name, currentUrl, match) => {
    const expected = urlMatches(undefined, currentUrl, match);
    const { page, rawPage } = await fixture(currentUrl);
    const result = page.waitForURL(match, { timeout: 5 }).then(
      () => true,
      () => false,
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toBe(expected);
    expect(rawPage.waitForLoadState).toHaveBeenCalledTimes(expected ? 1 : 0);
  });

  it("waits for the default load state even when URL already matches", async () => {
    const { page, rawPage, runtime } = await fixture("https://example.com/done");
    await expect(page.waitForURL("**/done")).resolves.toBeUndefined();
    expect(rawPage.waitForLoadState).toHaveBeenCalledWith("load", 30_000);
    expect(runtime.telemetry().calls["page.waitForURL"]).toBe(1);
  });

  it.each(["domcontentloaded", "networkidle"])("passes supported waitUntil=%s", async (state) => {
    const { page, rawPage } = await fixture("https://example.com/done");
    await page.waitForURL("**/done", { waitUntil: state, timeout: 500 });
    expect(rawPage.waitForLoadState).toHaveBeenCalledWith(state, 500);
  });

  it("shares one timeout budget between URL matching and load completion", async () => {
    const { page, rawPage, navigate } = await fixture();
    const pending = page.waitForURL("**/done", { timeout: 150 });
    await vi.advanceTimersByTimeAsync(75);
    navigate("https://example.com/done");
    await vi.advanceTimersByTimeAsync(25);
    await pending;
    expect(rawPage.waitForLoadState).toHaveBeenCalledWith("load", 50);
    expect(page.url()).toBe("https://example.com/done");
  });

  it("times out while the URL does not match", async () => {
    const { page } = await fixture();
    const pending = expect(page.waitForURL("**/done", { timeout: 100 })).rejects.toMatchObject({
      name: "TimeoutError",
      message: "page.waitForURL: timed out after 100ms",
    });
    await vi.advanceTimersByTimeAsync(100);
    await pending;
  });

  it("enforces the deadline when a raw URL read stalls", async () => {
    const { page, rawPage } = await fixture();
    rawPage.url.mockImplementationOnce(() => new Promise<string>(() => undefined));
    const pending = expect(page.waitForURL("**/done", { timeout: 100 })).rejects.toMatchObject({
      name: "TimeoutError",
    });
    await vi.advanceTimersByTimeAsync(100);
    await pending;
  });

  it("enforces the remaining deadline when the load wait stalls", async () => {
    const { page, rawPage } = await fixture("https://example.com/done");
    rawPage.waitForLoadState.mockImplementationOnce(() => new Promise<undefined>(() => undefined));
    const pending = expect(page.waitForURL("**/done", { timeout: 100 })).rejects.toMatchObject({
      name: "TimeoutError",
    });
    await vi.advanceTimersByTimeAsync(100);
    await pending;
  });

  it("timeout zero permits URL matching after the normal 30-second deadline", async () => {
    const { page, navigate } = await fixture();
    let settled = false;
    const pending = page.waitForURL("**/done", { timeout: 0 }).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(40_000);
    expect(settled).toBe(false);
    navigate("https://example.com/done");
    await vi.advanceTimersByTimeAsync(50);
    await pending;
  });

  it("timeout zero renews only timed-out raw load waits with positive budgets", async () => {
    const { page, rawPage } = await fixture("https://example.com/done");
    rawPage.waitForLoadState.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(
            () => reject(new Error("waitForMainLoadState(load) timed out after 30000ms")),
            30_000,
          );
        }),
    );
    const pending = page.waitForURL("**/done", { timeout: 0 });
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect(rawPage.waitForLoadState.mock.calls).toEqual([
      ["load", 30_000],
      ["load", 30_000],
    ]);
  });

  it("preserves predicate and non-timeout load errors", async () => {
    const { page, rawPage } = await fixture("https://example.com/done");
    const predicateError = new Error("predicate failed");
    await expect(
      page.waitForURL(() => {
        throw predicateError;
      }),
    ).rejects.toBe(predicateError);
    const loadError = new Error("connection closed");
    rawPage.waitForLoadState.mockRejectedValueOnce(loadError);
    await expect(page.waitForURL("**/done", { timeout: 0 })).rejects.toBe(loadError);
    expect(rawPage.waitForLoadState).toHaveBeenCalledTimes(1);
  });

  it("explicitly rejects the unsupported raw commit load state", async () => {
    const { page, rawPage } = await fixture("https://example.com/done");
    await expect(page.waitForURL("**/done", { waitUntil: "commit" })).rejects.toThrow(
      'unsupported waitUntil "commit"',
    );
    expect(rawPage.waitForLoadState).not.toHaveBeenCalled();
  });
});
