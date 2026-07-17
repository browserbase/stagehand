import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod/v4";
import type { RPCMethod } from "../../protocol/json-rpc/schemas.js";
import { StagehandMethods } from "../../protocol/schema-registry.js";
import { BrowserContext, Locator, Page } from "../src/index.js";
import { RPCClient } from "../src/rpcClient.js";
import { createStagehandWithClientForTest } from "../src/stagehand.js";

type ProtocolCall = { method: string; params: unknown };

class FakeProtocolClient extends RPCClient {
  readonly calls: ProtocolCall[] = [];
  responses = new Map<string, unknown[]>();

  constructor() {
    super(
      {
        serviceWorker: {
          targetId: "worker-target",
          url: "chrome-extension://stagehand/service-worker.js",
          title: "Stagehand",
          extensionId: "stagehand",
        },
        send: async () => {},
        close: () => {},
      },
      1_000,
    );
  }

  queueResponse<Method extends RPCMethod>(
    method: Method,
    response: z.input<Method["result"]>,
  ): void {
    const responses = this.responses.get(method.name) ?? [];
    responses.push(response);
    this.responses.set(method.name, responses);
  }

  async send<Method extends RPCMethod>(
    method: Method,
    params: z.input<Method["params"]>,
  ): Promise<z.output<Method["result"]>> {
    this.calls.push({ method: method.name, params });
    const responses = this.responses.get(method.name);
    if (!responses?.length) {
      throw new Error(`No fake response queued for ${method.name}`);
    }
    return method.result.parse(responses.shift()) as z.output<Method["result"]>;
  }

  onNotification(): () => void {
    return () => {};
  }

  close(): void {}
}

function requestCall<Method extends RPCMethod>(
  method: Method,
  params: z.input<Method["params"]>,
): ProtocolCall {
  return { method: method.name, params };
}

describe("Stagehand TS object wrapper", () => {
  it("initializes locally without sending stagehand.init", async () => {
    const client = new FakeProtocolClient();
    const stagehand = createStagehandWithClientForTest(client);

    expect(stagehand.initialized).toBe(false);
    await stagehand.init();

    expect(stagehand.initialized).toBe(true);
    expect(stagehand.context).toBeInstanceOf(BrowserContext);
    expect(client.calls).toStrictEqual([]);
  });

  it("closes the remote runtime", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.stagehandClose, { closed: true });
    const stagehand = createStagehandWithClientForTest(client);
    await stagehand.init();

    await stagehand.close();

    expect(stagehand.initialized).toBe(false);
    expect(client.calls).toStrictEqual([requestCall(StagehandMethods.stagehandClose, {})]);
  });

  it("wraps context.pages results as Page objects", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.contextPages, [
      { pageId: "page-1", url: "https://example.com", title: "Example" },
      { pageId: "page-2" },
    ]);
    const stagehand = createStagehandWithClientForTest(client);
    await stagehand.init();

    const pages = await stagehand.context.pages();

    expect(client.calls).toStrictEqual([requestCall(StagehandMethods.contextPages, {})]);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toBeInstanceOf(Page);
    expect(pages[0]?.pageId).toBe("page-1");
    expect(pages[0]?.ref).toStrictEqual({
      pageId: "page-1",
      url: "https://example.com",
      title: "Example",
    });
    expect(pages[1]?.pageId).toBe("page-2");
  });

  it("wraps context.newPage results as a Page", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.contextNewPage, {
      pageId: "new-page",
      url: "https://browserbase.com",
    });
    const stagehand = createStagehandWithClientForTest(client);
    await stagehand.init();

    const page = await stagehand.context.newPage({ url: "https://browserbase.com" });

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.contextNewPage, { url: "https://browserbase.com" }),
    ]);
    expect(page).toBeInstanceOf(Page);
    expect(page.pageId).toBe("new-page");
    expect(page.ref).toStrictEqual({
      pageId: "new-page",
      url: "https://browserbase.com",
    });
  });

  it("routes page.goto and updates the page ref", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.pageGoto, {
      pageId: "page-1",
      url: "https://example.com/next",
      title: "Next",
    });
    const page = new Page(client, { pageId: "page-1", url: "about:blank" });

    const returnedPage = await page.goto("https://example.com/next", {
      waitUntil: "load",
      timeoutMs: 5000,
    });

    expect(returnedPage).toBe(page);
    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.pageGoto, {
        pageId: "page-1",
        url: "https://example.com/next",
        options: {
          waitUntil: "load",
          timeoutMs: 5000,
        },
      }),
    ]);
    expect(page.ref).toStrictEqual({
      pageId: "page-1",
      url: "https://example.com/next",
      title: "Next",
    });
  });

  it("routes page navigation methods and updates the page ref", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.pageReload, {
      pageId: "page-1",
      url: "https://example.com/reloaded",
    });
    client.queueResponse(StagehandMethods.pageGoBack, {
      pageId: "page-1",
      url: "https://example.com/back",
    });
    client.queueResponse(StagehandMethods.pageGoForward, {
      pageId: "page-1",
      url: "https://example.com/forward",
    });
    const page = new Page(client, { pageId: "page-1", url: "https://example.com/current" });

    await expect(
      page.reload({ waitUntil: "load", timeoutMs: 5_000, ignoreCache: true }),
    ).resolves.toBe(page);
    expect(page.ref.url).toBe("https://example.com/reloaded");

    await expect(page.goBack({ waitUntil: "domcontentloaded" })).resolves.toBe(page);
    expect(page.ref.url).toBe("https://example.com/back");

    await expect(page.goForward()).resolves.toBe(page);
    expect(page.ref.url).toBe("https://example.com/forward");

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.pageReload, {
        pageId: "page-1",
        options: { waitUntil: "load", timeoutMs: 5_000, ignoreCache: true },
      }),
      requestCall(StagehandMethods.pageGoBack, {
        pageId: "page-1",
        options: { waitUntil: "domcontentloaded" },
      }),
      requestCall(StagehandMethods.pageGoForward, { pageId: "page-1" }),
    ]);
  });

  it("routes page coordinate interactions and unwraps xpath results", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.pageClick, { xpath: "/html/body/button" });
    client.queueResponse(StagehandMethods.pageHover, { xpath: "/html/body/a" });
    client.queueResponse(StagehandMethods.pageScroll, { xpath: "/html/body/main" });
    client.queueResponse(StagehandMethods.pageDragAndDrop, {
      fromXpath: "/html/body/div[1]",
      toXpath: "/html/body/div[2]",
    });
    const page = new Page(client, { pageId: "page-1" });

    await expect(
      page.click(10, 20, { button: "right", clickCount: 2, returnXpath: true }),
    ).resolves.toBe("/html/body/button");
    await expect(page.hover(30, 40, { returnXpath: true })).resolves.toBe("/html/body/a");
    await expect(page.scroll(50, 60, -25, 400, { returnXpath: true })).resolves.toBe(
      "/html/body/main",
    );
    await expect(
      page.dragAndDrop(1, 2, 3, 4, {
        button: "left",
        steps: 5,
        delay: 10,
        returnXpath: true,
      }),
    ).resolves.toStrictEqual(["/html/body/div[1]", "/html/body/div[2]"]);

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.pageClick, {
        pageId: "page-1",
        x: 10,
        y: 20,
        options: { button: "right", clickCount: 2, returnXpath: true },
      }),
      requestCall(StagehandMethods.pageHover, {
        pageId: "page-1",
        x: 30,
        y: 40,
        options: { returnXpath: true },
      }),
      requestCall(StagehandMethods.pageScroll, {
        pageId: "page-1",
        x: 50,
        y: 60,
        deltaX: -25,
        deltaY: 400,
        options: { returnXpath: true },
      }),
      requestCall(StagehandMethods.pageDragAndDrop, {
        pageId: "page-1",
        fromX: 1,
        fromY: 2,
        toX: 3,
        toY: 4,
        options: { button: "left", steps: 5, delay: 10, returnXpath: true },
      }),
    ]);
  });

  it("routes page keyboard interactions", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.pageType, { ok: true });
    client.queueResponse(StagehandMethods.pageKeyPress, { ok: true });
    const page = new Page(client, { pageId: "page-1" });

    await page.type("hello", { delay: 25, withMistakes: true });
    await page.keyPress("Control+A", { delay: 10 });

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.pageType, {
        pageId: "page-1",
        text: "hello",
        options: { delay: 25, withMistakes: true },
      }),
      requestCall(StagehandMethods.pageKeyPress, {
        pageId: "page-1",
        key: "Control+A",
        options: { delay: 10 },
      }),
    ]);
  });

  it("normalizes page evaluation functions and preserves result keys", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.pageEvaluate, {
      value: { camelCase: "kept", nestedValue: { staysCamelCase: true } },
    });
    const page = new Page(client, { pageId: "page-1" });
    const expression = (arg: { camelCase: string }) => ({ camelCase: arg.camelCase });

    await expect(page.evaluate(expression, { camelCase: "kept" })).resolves.toStrictEqual({
      camelCase: "kept",
      nestedValue: { staysCamelCase: true },
    });
    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.pageEvaluate, {
        pageId: "page-1",
        expression: `(${expression.toString()})({"camelCase":"kept"})`,
      }),
    ]);
  });

  it("normalizes page init script content and functions", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.pageAddInitScript, { ok: true });
    client.queueResponse(StagehandMethods.pageAddInitScript, { ok: true });
    const page = new Page(client, { pageId: "page-1" });
    const script = (arg: { ready: boolean }) => {
      globalThis.document.title = String(arg.ready);
    };

    await page.addInitScript({ content: "globalThis.fromContent = true" });
    await page.addInitScript(script, { ready: true });

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.pageAddInitScript, {
        pageId: "page-1",
        source: "globalThis.fromContent = true",
      }),
      requestCall(StagehandMethods.pageAddInitScript, {
        pageId: "page-1",
        source: `(${script.toString()})({"ready":true})`,
      }),
    ]);
  });

  it("routes page headers and viewport configuration", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.pageSetExtraHTTPHeaders, { ok: true });
    client.queueResponse(StagehandMethods.pageSetViewportSize, { ok: true });
    const page = new Page(client, { pageId: "page-1" });

    await page.setExtraHTTPHeaders({ "X-Request-ID": "request-1", doNotRenameMe: "value" });
    await page.setViewportSize(1280, 720, { deviceScaleFactor: 2 });

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.pageSetExtraHTTPHeaders, {
        pageId: "page-1",
        headers: { "X-Request-ID": "request-1", doNotRenameMe: "value" },
      }),
      requestCall(StagehandMethods.pageSetViewportSize, {
        pageId: "page-1",
        width: 1280,
        height: 720,
        options: { deviceScaleFactor: 2 },
      }),
    ]);
  });

  it("routes page wait methods and unwraps selector results", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.pageWaitForLoadState, { ok: true });
    client.queueResponse(StagehandMethods.pageWaitForTimeout, { ok: true });
    client.queueResponse(StagehandMethods.pageWaitForSelector, { matched: false });
    const page = new Page(client, { pageId: "page-1" });

    await page.waitForLoadState("networkidle", 0);
    await page.waitForTimeout(250);
    await expect(
      page.waitForSelector("button.submit", {
        state: "visible",
        timeout: 1_000,
        pierceShadow: false,
      }),
    ).resolves.toBe(false);

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.pageWaitForLoadState, {
        pageId: "page-1",
        state: "networkidle",
        timeoutMs: 0,
      }),
      requestCall(StagehandMethods.pageWaitForTimeout, { pageId: "page-1", ms: 250 }),
      requestCall(StagehandMethods.pageWaitForSelector, {
        pageId: "page-1",
        selector: "button.submit",
        options: { state: "visible", timeout: 1_000, pierceShadow: false },
      }),
    ]);
  });

  it("returns screenshot bytes, writes paths locally, and serializes masks", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.pageScreenshot, {
      data: "iVBORw0KGgo=",
      type: "png",
    });
    const page = new Page(client, { pageId: "page-1" });
    const mask = page.locator("[data-secret]");
    const directory = await mkdtemp(path.join(tmpdir(), "stagehand-screenshot-"));
    const screenshotPath = path.join(directory, "screenshot.png");

    try {
      const bytes = await page.screenshot({
        fullPage: true,
        mask: [mask],
        path: screenshotPath,
      });

      expect(bytes).toStrictEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      expect(await readFile(screenshotPath)).toStrictEqual(bytes);
      expect(client.calls).toStrictEqual([
        requestCall(StagehandMethods.pageScreenshot, {
          pageId: "page-1",
          options: {
            fullPage: true,
            mask: [{ pageId: "page-1", selector: "[data-secret]" }],
          },
        }),
      ]);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("routes page snapshots and preserves opaque map keys", async () => {
    const client = new FakeProtocolClient();
    const snapshot = {
      formattedTree: "root",
      xpathMap: { frameOne: "/html/body" },
      urlMap: { frameOne: "https://example.test" },
    };
    client.queueResponse(StagehandMethods.pageSnapshot, snapshot);
    const page = new Page(client, { pageId: "page-1" });

    await expect(page.snapshot({ includeIframes: true })).resolves.toStrictEqual(snapshot);
    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.pageSnapshot, {
        pageId: "page-1",
        options: { includeIframes: true },
      }),
    ]);
  });

  it("routes page.url and unwraps the result", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.pageUrl, { url: "https://example.com" });
    const page = new Page(client, { pageId: "page-1" });

    await expect(page.url()).resolves.toBe("https://example.com");
    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.pageUrl, { pageId: "page-1" }),
    ]);
  });

  it("routes page.title and unwraps the result", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.pageTitle, { title: "Example" });
    const page = new Page(client, { pageId: "page-1" });

    await expect(page.title()).resolves.toBe("Example");
    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.pageTitle, { pageId: "page-1" }),
    ]);
  });

  it("routes page.close", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.pageClose, { closed: true });
    const page = new Page(client, { pageId: "page-1" });

    await page.close();

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.pageClose, { pageId: "page-1" }),
    ]);
  });

  it("creates descriptor-backed locators without sending protocol calls", () => {
    const client = new FakeProtocolClient();
    const page = new Page(client, { pageId: "page-1" });

    const locator = page.locator("button[type=submit]");

    expect(locator).toBeInstanceOf(Locator);
    expect(client.calls).toStrictEqual([]);
  });

  it("routes locator.click with the page descriptor", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.locatorClick, { clicked: true });
    const page = new Page(client, { pageId: "page-1" });

    await page.locator("button").click({
      button: "left",
      clickCount: 2,
    });

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.locatorClick, {
        pageId: "page-1",
        selector: "button",
        options: {
          button: "left",
          clickCount: 2,
        },
      }),
    ]);
  });

  it("routes locator.fill with the page descriptor", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.locatorFill, { filled: true });
    const page = new Page(client, { pageId: "page-1" });

    await page.locator("#email").fill("user@example.com");

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.locatorFill, {
        pageId: "page-1",
        selector: "#email",
        value: "user@example.com",
      }),
    ]);
  });

  it("routes locator.isVisible and unwraps the result", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.locatorIsVisible, { visible: true });
    const page = new Page(client, { pageId: "page-1" });

    await expect(page.locator("#message").isVisible()).resolves.toBe(true);
    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.locatorIsVisible, {
        pageId: "page-1",
        selector: "#message",
      }),
    ]);
  });

  it("routes locator.textContent and unwraps the result", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.locatorTextContent, { textContent: "hello" });
    const page = new Page(client, { pageId: "page-1" });

    await expect(page.locator("#message").textContent()).resolves.toBe("hello");
    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.locatorTextContent, {
        pageId: "page-1",
        selector: "#message",
      }),
    ]);
  });

  it("routes read locator methods and unwraps their results", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.locatorCount, { count: 2 });
    client.queueResponse(StagehandMethods.locatorIsChecked, { checked: true });
    client.queueResponse(StagehandMethods.locatorInputValue, { value: "user@example.com" });
    client.queueResponse(StagehandMethods.locatorInnerText, { text: "visible text" });
    client.queueResponse(StagehandMethods.locatorInnerHtml, { html: "<span>visible text</span>" });
    client.queueResponse(StagehandMethods.locatorCentroid, { x: 12, y: 34 });
    const page = new Page(client, { pageId: "page-1" });
    const locator = page.locator("#field");

    await expect(locator.count()).resolves.toBe(2);
    await expect(locator.isChecked()).resolves.toBe(true);
    await expect(locator.inputValue()).resolves.toBe("user@example.com");
    await expect(locator.innerText()).resolves.toBe("visible text");
    await expect(locator.innerHtml()).resolves.toBe("<span>visible text</span>");
    await expect(locator.centroid()).resolves.toStrictEqual({ x: 12, y: 34 });

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.locatorCount, { pageId: "page-1", selector: "#field" }),
      requestCall(StagehandMethods.locatorIsChecked, { pageId: "page-1", selector: "#field" }),
      requestCall(StagehandMethods.locatorInputValue, { pageId: "page-1", selector: "#field" }),
      requestCall(StagehandMethods.locatorInnerText, { pageId: "page-1", selector: "#field" }),
      requestCall(StagehandMethods.locatorInnerHtml, { pageId: "page-1", selector: "#field" }),
      requestCall(StagehandMethods.locatorCentroid, { pageId: "page-1", selector: "#field" }),
    ]);
  });

  it("routes write locator methods with their options", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.locatorHover, { hovered: true });
    client.queueResponse(StagehandMethods.locatorScrollTo, { scrolled: true });
    client.queueResponse(StagehandMethods.locatorHighlight, { highlighted: true });
    client.queueResponse(StagehandMethods.locatorSendClickEvent, { clicked: true });
    client.queueResponse(StagehandMethods.locatorType, { typed: true });
    client.queueResponse(StagehandMethods.locatorSelectOption, { values: ["pro"] });
    const page = new Page(client, { pageId: "page-1" });
    const locator = page.locator("#field");

    await locator.hover();
    await locator.scrollTo(50);
    await locator.highlight({ durationMs: 0, borderColor: { r: 1, g: 2, b: 3 } });
    await locator.sendClickEvent({ detail: 2 });
    await locator.type("hello", { delay: 1 });
    await expect(locator.selectOption(["starter", "pro"])).resolves.toStrictEqual(["pro"]);

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.locatorHover, { pageId: "page-1", selector: "#field" }),
      requestCall(StagehandMethods.locatorScrollTo, {
        pageId: "page-1",
        selector: "#field",
        percent: 50,
      }),
      requestCall(StagehandMethods.locatorHighlight, {
        pageId: "page-1",
        selector: "#field",
        options: { durationMs: 0, borderColor: { r: 1, g: 2, b: 3 } },
      }),
      requestCall(StagehandMethods.locatorSendClickEvent, {
        pageId: "page-1",
        selector: "#field",
        options: { detail: 2 },
      }),
      requestCall(StagehandMethods.locatorType, {
        pageId: "page-1",
        selector: "#field",
        text: "hello",
        options: { delay: 1 },
      }),
      requestCall(StagehandMethods.locatorSelectOption, {
        pageId: "page-1",
        selector: "#field",
        values: ["starter", "pro"],
      }),
    ]);
  });

  it("creates descriptor-backed nth locators without sending protocol calls", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.locatorClick, { clicked: true });
    const page = new Page(client, { pageId: "page-1" });

    const locator = page.locator("button").first().nth(2);

    expect(locator).toBeInstanceOf(Locator);
    expect(client.calls).toStrictEqual([]);

    await locator.click();

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.locatorClick, {
        pageId: "page-1",
        selector: "button",
        nth: 2,
      }),
    ]);
  });

  it("rejects invalid nth indexes before sending protocol calls", () => {
    const client = new FakeProtocolClient();
    const page = new Page(client, { pageId: "page-1" });

    expect(() => page.locator("button").nth(-1)).toThrow("Too small: expected number to be >=0");
    expect(client.calls).toStrictEqual([]);
  });
});
