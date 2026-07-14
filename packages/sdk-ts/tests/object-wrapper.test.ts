import { describe, expect, it } from "vite-plus/test";
import { BrowserContext, Locator, Page } from "../src/index.js";
import { createStagehandWithClientForTest } from "../src/stagehand.js";
import type {
  StagehandMethod,
  StagehandMethodParams,
  StagehandMethodResult,
  StagehandProtocolClient,
  StagehandProtocolRequest,
} from "../src/index.js";

type ProtocolCall<Method extends StagehandMethod = StagehandMethod> = {
  [K in Method]: {
    request: Extract<StagehandProtocolRequest, { method: K }>;
  };
}[Method];

class FakeProtocolClient implements StagehandProtocolClient {
  readonly calls: ProtocolCall[] = [];
  #responses = new Map<StagehandMethod, unknown[]>();

  queueResponse<Method extends StagehandMethod>(
    method: Method,
    response: StagehandMethodResult<Method>,
  ): void {
    const responses = this.#responses.get(method) ?? [];
    responses.push(response);
    this.#responses.set(method, responses);
  }

  queueRawResponse(method: StagehandMethod, response: unknown): void {
    const responses = this.#responses.get(method) ?? [];
    responses.push(response);
    this.#responses.set(method, responses);
  }

  async send(request: StagehandProtocolRequest): Promise<unknown> {
    this.calls.push({ request } as ProtocolCall);
    const responses = this.#responses.get(request.method);
    if (!responses?.length) {
      throw new Error(`No fake response queued for ${request.method}`);
    }
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: responses.shift(),
    };
  }
}

function requestCall<Method extends StagehandMethod>(
  method: Method,
  params: StagehandMethodParams<Method>,
): ProtocolCall<Method> {
  return {
    request: {
      jsonrpc: "2.0",
      id: 0,
      method,
      params,
    },
  } as ProtocolCall<Method>;
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
    client.queueResponse("stagehand.close", { closed: true });
    const stagehand = createStagehandWithClientForTest(client);
    await stagehand.init();

    await stagehand.close();

    expect(stagehand.initialized).toBe(false);
    expect(client.calls).toStrictEqual([requestCall("stagehand.close", {})]);
  });

  it("wraps context.pages results as Page objects", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse("context.pages", [
      { pageId: "page-1", url: "https://example.com", title: "Example" },
      { pageId: "page-2" },
    ]);
    const stagehand = createStagehandWithClientForTest(client);
    await stagehand.init();

    const pages = await stagehand.context.pages();

    expect(client.calls).toStrictEqual([requestCall("context.pages", {})]);
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
    client.queueResponse("context.new_page", {
      pageId: "new-page",
      url: "https://browserbase.com",
    });
    const stagehand = createStagehandWithClientForTest(client);
    await stagehand.init();

    const page = await stagehand.context.newPage({ url: "https://browserbase.com" });

    expect(client.calls).toStrictEqual([
      requestCall("context.new_page", { url: "https://browserbase.com" }),
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
    client.queueResponse("page.goto", {
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
      requestCall("page.goto", {
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

  it("rejects invalid params before sending to the protocol client", async () => {
    const client = new FakeProtocolClient();
    const page = new Page(client, { pageId: "page-1" });

    await expect(
      page.goto("https://example.com/next", {
        timeoutMs: "not-a-number",
      } as never),
    ).rejects.toThrow("Invalid input: expected number, received string");
    expect(client.calls).toStrictEqual([]);
  });

  it("routes page.url and unwraps the result", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse("page.url", { url: "https://example.com" });
    const page = new Page(client, { pageId: "page-1" });

    await expect(page.url()).resolves.toBe("https://example.com");
    expect(client.calls).toStrictEqual([requestCall("page.url", { pageId: "page-1" })]);
  });

  it("rejects invalid protocol results before unwrapping", async () => {
    const client = new FakeProtocolClient();
    client.queueRawResponse("page.url", { url: 123 });
    const page = new Page(client, { pageId: "page-1" });

    await expect(page.url()).rejects.toThrow("Invalid input: expected string, received number");
    expect(client.calls).toStrictEqual([requestCall("page.url", { pageId: "page-1" })]);
  });

  it("routes page.title and unwraps the result", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse("page.title", { title: "Example" });
    const page = new Page(client, { pageId: "page-1" });

    await expect(page.title()).resolves.toBe("Example");
    expect(client.calls).toStrictEqual([requestCall("page.title", { pageId: "page-1" })]);
  });

  it("routes page.close", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse("page.close", { closed: true });
    const page = new Page(client, { pageId: "page-1" });

    await page.close();

    expect(client.calls).toStrictEqual([requestCall("page.close", { pageId: "page-1" })]);
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
    client.queueResponse("locator.click", { clicked: true });
    const page = new Page(client, { pageId: "page-1" });

    await page.locator("button").click({
      button: "left",
      clickCount: 2,
    });

    expect(client.calls).toStrictEqual([
      requestCall("locator.click", {
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
    client.queueResponse("locator.fill", { filled: true });
    const page = new Page(client, { pageId: "page-1" });

    await page.locator("#email").fill("user@example.com");

    expect(client.calls).toStrictEqual([
      requestCall("locator.fill", {
        pageId: "page-1",
        selector: "#email",
        value: "user@example.com",
      }),
    ]);
  });

  it("routes locator.isVisible and unwraps the result", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse("locator.is_visible", { visible: true });
    const page = new Page(client, { pageId: "page-1" });

    await expect(page.locator("#message").isVisible()).resolves.toBe(true);
    expect(client.calls).toStrictEqual([
      requestCall("locator.is_visible", {
        pageId: "page-1",
        selector: "#message",
      }),
    ]);
  });

  it("routes locator.textContent and unwraps the result", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse("locator.text_content", { textContent: "hello" });
    const page = new Page(client, { pageId: "page-1" });

    await expect(page.locator("#message").textContent()).resolves.toBe("hello");
    expect(client.calls).toStrictEqual([
      requestCall("locator.text_content", {
        pageId: "page-1",
        selector: "#message",
      }),
    ]);
  });
});
