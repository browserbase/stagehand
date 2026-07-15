import { describe, expect, it } from "vite-plus/test";
import { z } from "zod/v4";
import type { RPCMethod } from "../../protocol/json-rpc/schemas.js";
import { StagehandRPC } from "../../protocol/schema-registry.js";
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
    client.queueResponse(StagehandRPC.stagehandClose, { closed: true });
    const stagehand = createStagehandWithClientForTest(client);
    await stagehand.init();

    await stagehand.close();

    expect(stagehand.initialized).toBe(false);
    expect(client.calls).toStrictEqual([requestCall(StagehandRPC.stagehandClose, {})]);
  });

  it("wraps context.pages results as Page objects", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandRPC.contextPages, [
      { pageId: "page-1", url: "https://example.com", title: "Example" },
      { pageId: "page-2" },
    ]);
    const stagehand = createStagehandWithClientForTest(client);
    await stagehand.init();

    const pages = await stagehand.context.pages();

    expect(client.calls).toStrictEqual([requestCall(StagehandRPC.contextPages, {})]);
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
    client.queueResponse(StagehandRPC.contextNewPage, {
      pageId: "new-page",
      url: "https://browserbase.com",
    });
    const stagehand = createStagehandWithClientForTest(client);
    await stagehand.init();

    const page = await stagehand.context.newPage({ url: "https://browserbase.com" });

    expect(client.calls).toStrictEqual([
      requestCall(StagehandRPC.contextNewPage, { url: "https://browserbase.com" }),
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
    client.queueResponse(StagehandRPC.pageGoto, {
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
      requestCall(StagehandRPC.pageGoto, {
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

  it("routes page.url and unwraps the result", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandRPC.pageUrl, { url: "https://example.com" });
    const page = new Page(client, { pageId: "page-1" });

    await expect(page.url()).resolves.toBe("https://example.com");
    expect(client.calls).toStrictEqual([requestCall(StagehandRPC.pageUrl, { pageId: "page-1" })]);
  });

  it("routes page.title and unwraps the result", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandRPC.pageTitle, { title: "Example" });
    const page = new Page(client, { pageId: "page-1" });

    await expect(page.title()).resolves.toBe("Example");
    expect(client.calls).toStrictEqual([requestCall(StagehandRPC.pageTitle, { pageId: "page-1" })]);
  });

  it("routes page.close", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandRPC.pageClose, { closed: true });
    const page = new Page(client, { pageId: "page-1" });

    await page.close();

    expect(client.calls).toStrictEqual([requestCall(StagehandRPC.pageClose, { pageId: "page-1" })]);
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
    client.queueResponse(StagehandRPC.locatorClick, { clicked: true });
    const page = new Page(client, { pageId: "page-1" });

    await page.locator("button").click({
      button: "left",
      clickCount: 2,
    });

    expect(client.calls).toStrictEqual([
      requestCall(StagehandRPC.locatorClick, {
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
    client.queueResponse(StagehandRPC.locatorFill, { filled: true });
    const page = new Page(client, { pageId: "page-1" });

    await page.locator("#email").fill("user@example.com");

    expect(client.calls).toStrictEqual([
      requestCall(StagehandRPC.locatorFill, {
        pageId: "page-1",
        selector: "#email",
        value: "user@example.com",
      }),
    ]);
  });

  it("routes locator.isVisible and unwraps the result", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandRPC.locatorIsVisible, { visible: true });
    const page = new Page(client, { pageId: "page-1" });

    await expect(page.locator("#message").isVisible()).resolves.toBe(true);
    expect(client.calls).toStrictEqual([
      requestCall(StagehandRPC.locatorIsVisible, {
        pageId: "page-1",
        selector: "#message",
      }),
    ]);
  });

  it("routes locator.textContent and unwraps the result", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandRPC.locatorTextContent, { textContent: "hello" });
    const page = new Page(client, { pageId: "page-1" });

    await expect(page.locator("#message").textContent()).resolves.toBe("hello");
    expect(client.calls).toStrictEqual([
      requestCall(StagehandRPC.locatorTextContent, {
        pageId: "page-1",
        selector: "#message",
      }),
    ]);
  });

  it("routes read locator methods and unwraps their results", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandRPC.locatorCount, { count: 2 });
    client.queueResponse(StagehandRPC.locatorIsChecked, { checked: true });
    client.queueResponse(StagehandRPC.locatorInputValue, { value: "user@example.com" });
    client.queueResponse(StagehandRPC.locatorInnerText, { text: "visible text" });
    client.queueResponse(StagehandRPC.locatorInnerHtml, { html: "<span>visible text</span>" });
    client.queueResponse(StagehandRPC.locatorCentroid, { x: 12, y: 34 });
    const page = new Page(client, { pageId: "page-1" });
    const locator = page.locator("#field");

    await expect(locator.count()).resolves.toBe(2);
    await expect(locator.isChecked()).resolves.toBe(true);
    await expect(locator.inputValue()).resolves.toBe("user@example.com");
    await expect(locator.innerText()).resolves.toBe("visible text");
    await expect(locator.innerHtml()).resolves.toBe("<span>visible text</span>");
    await expect(locator.centroid()).resolves.toStrictEqual({ x: 12, y: 34 });

    expect(client.calls).toStrictEqual([
      requestCall(StagehandRPC.locatorCount, { pageId: "page-1", selector: "#field" }),
      requestCall(StagehandRPC.locatorIsChecked, { pageId: "page-1", selector: "#field" }),
      requestCall(StagehandRPC.locatorInputValue, { pageId: "page-1", selector: "#field" }),
      requestCall(StagehandRPC.locatorInnerText, { pageId: "page-1", selector: "#field" }),
      requestCall(StagehandRPC.locatorInnerHtml, { pageId: "page-1", selector: "#field" }),
      requestCall(StagehandRPC.locatorCentroid, { pageId: "page-1", selector: "#field" }),
    ]);
  });

  it("routes write locator methods with their options", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandRPC.locatorHover, { hovered: true });
    client.queueResponse(StagehandRPC.locatorScrollTo, { scrolled: true });
    client.queueResponse(StagehandRPC.locatorHighlight, { highlighted: true });
    client.queueResponse(StagehandRPC.locatorSendClickEvent, { clicked: true });
    client.queueResponse(StagehandRPC.locatorType, { typed: true });
    client.queueResponse(StagehandRPC.locatorSelectOption, { values: ["pro"] });
    const page = new Page(client, { pageId: "page-1" });
    const locator = page.locator("#field");

    await locator.hover();
    await locator.scrollTo(50);
    await locator.highlight({ durationMs: 0, borderColor: { r: 1, g: 2, b: 3 } });
    await locator.sendClickEvent({ detail: 2 });
    await locator.type("hello", { delay: 1 });
    await expect(locator.selectOption(["starter", "pro"])).resolves.toStrictEqual(["pro"]);

    expect(client.calls).toStrictEqual([
      requestCall(StagehandRPC.locatorHover, { pageId: "page-1", selector: "#field" }),
      requestCall(StagehandRPC.locatorScrollTo, {
        pageId: "page-1",
        selector: "#field",
        percent: 50,
      }),
      requestCall(StagehandRPC.locatorHighlight, {
        pageId: "page-1",
        selector: "#field",
        options: { durationMs: 0, borderColor: { r: 1, g: 2, b: 3 } },
      }),
      requestCall(StagehandRPC.locatorSendClickEvent, {
        pageId: "page-1",
        selector: "#field",
        options: { detail: 2 },
      }),
      requestCall(StagehandRPC.locatorType, {
        pageId: "page-1",
        selector: "#field",
        text: "hello",
        options: { delay: 1 },
      }),
      requestCall(StagehandRPC.locatorSelectOption, {
        pageId: "page-1",
        selector: "#field",
        values: ["starter", "pro"],
      }),
    ]);
  });

  it("creates descriptor-backed nth locators without sending protocol calls", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandRPC.locatorClick, { clicked: true });
    const page = new Page(client, { pageId: "page-1" });

    const locator = page.locator("button").first().nth(2);

    expect(locator).toBeInstanceOf(Locator);
    expect(client.calls).toStrictEqual([]);

    await locator.click();

    expect(client.calls).toStrictEqual([
      requestCall(StagehandRPC.locatorClick, {
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
