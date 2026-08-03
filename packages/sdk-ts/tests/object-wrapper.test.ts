import { mkdtemp, readFile, rm, truncate, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import type { RPCMethod } from "../../protocol/json-rpc/schemas.js";
import { StagehandMethods } from "../../protocol/schema-registry.js";
import {
  BrowserClipboard,
  BrowserContext,
  Locator,
  Page,
  Stagehand,
  WebMCPInvocation,
  WebMCPTool,
} from "../src/index.js";
import { RPCClient } from "../src/rpcClient.js";

type ProtocolCall = { method: string; params: unknown };

class FakeProtocolClient extends RPCClient {
  readonly calls: ProtocolCall[] = [];
  responses = new Map<string, unknown[]>();

  constructor() {
    super(
      {
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/test",
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
    response: z.input<Method["result"]> | Error,
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
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return method.result.parse(response) as z.output<Method["result"]>;
  }

  onNotification(): () => void {
    return () => {};
  }

  close(): void {}
}

function createStagehandWithClientForTest(client: RPCClient): Stagehand {
  // This lightweight wrapper intentionally has no browser handle; these tests must not use .browser.
  const stagehand = Object.create(Stagehand.prototype) as Stagehand;
  stagehand.rpcClient = client;
  stagehand.browserContext = new BrowserContext(client);
  stagehand.isInitialized = true;
  return stagehand;
}

function requestCall<Method extends RPCMethod>(
  method: Method,
  params: z.input<Method["params"]>,
): ProtocolCall {
  return { method: method.name, params };
}

const zeroUsage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  inferenceTimeMs: 0,
};
describe("Stagehand TS object wrapper", () => {
  it("provides an initialized Stagehand test wrapper", () => {
    const client = new FakeProtocolClient();
    const stagehand = createStagehandWithClientForTest(client);

    expect(stagehand.initialized).toBe(true);
    expect(stagehand.context).toBeInstanceOf(BrowserContext);
    expect(client.calls).toStrictEqual([]);
  });

  it("closes the remote runtime", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.stagehandClose, { closed: true });
    const stagehand = createStagehandWithClientForTest(client);

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

  it("wraps the active page and maps a missing active page to undefined", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.contextActivePage, {
      pageId: "active-page",
      url: "https://example.com/active",
    });
    client.queueResponse(StagehandMethods.contextActivePage, null);
    const stagehand = createStagehandWithClientForTest(client);

    const activePage = await stagehand.context.activePage();
    const missingActivePage = await stagehand.context.activePage();

    expect(activePage).toBeInstanceOf(Page);
    expect(activePage?.ref).toStrictEqual({
      pageId: "active-page",
      url: "https://example.com/active",
    });
    expect(missingActivePage).toBeUndefined();
    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.contextActivePage, {}),
      requestCall(StagehandMethods.contextActivePage, {}),
    ]);
  });

  it("routes context.setActivePage and context.close", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.contextSetActivePage, { ok: true });
    client.queueResponse(StagehandMethods.contextClose, { closed: true });
    const stagehand = createStagehandWithClientForTest(client);
    const page = new Page(client, { pageId: "page-1" });

    await stagehand.context.setActivePage(page);
    await stagehand.context.close();

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.contextSetActivePage, { pageId: "page-1" }),
      requestCall(StagehandMethods.contextClose, {}),
    ]);
  });

  it("normalizes context init script content and functions", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.contextAddInitScript, { ok: true });
    client.queueResponse(StagehandMethods.contextAddInitScript, { ok: true });
    const stagehand = createStagehandWithClientForTest(client);
    const script = (arg: { ready: boolean }) => {
      globalThis.document.title = String(arg.ready);
    };

    await stagehand.context.addInitScript({ content: "globalThis.fromContent = true" });
    await stagehand.context.addInitScript(script, { ready: true });

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.contextAddInitScript, {
        source: "globalThis.fromContent = true",
      }),
      requestCall(StagehandMethods.contextAddInitScript, {
        source: `(${script.toString()})({"ready":true})`,
      }),
    ]);
  });

  it("routes context headers and adapts domain policy results", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.contextSetExtraHTTPHeaders, { ok: true });
    client.queueResponse(StagehandMethods.contextGetDomainPolicy, {
      allowedDomains: ["example.com"],
      blockedDomains: ["blocked.example.com"],
    });
    client.queueResponse(StagehandMethods.contextGetDomainPolicy, null);
    client.queueResponse(StagehandMethods.contextSetDomainPolicy, { ok: true });
    client.queueResponse(StagehandMethods.contextSetDomainPolicy, { ok: true });
    const stagehand = createStagehandWithClientForTest(client);

    await stagehand.context.setExtraHTTPHeaders({
      "X-Request-ID": "request-1",
      doNotRenameMe: "value",
    });
    await expect(stagehand.context.getDomainPolicy()).resolves.toStrictEqual({
      allowedDomains: ["example.com"],
      blockedDomains: ["blocked.example.com"],
    });
    await expect(stagehand.context.getDomainPolicy()).resolves.toBeNull();
    await stagehand.context.setDomainPolicy({ allowedDomains: ["example.test"] });
    await stagehand.context.setDomainPolicy(null);

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.contextSetExtraHTTPHeaders, {
        headers: { "X-Request-ID": "request-1", doNotRenameMe: "value" },
      }),
      requestCall(StagehandMethods.contextGetDomainPolicy, {}),
      requestCall(StagehandMethods.contextGetDomainPolicy, {}),
      requestCall(StagehandMethods.contextSetDomainPolicy, {
        policy: { allowedDomains: ["example.test"] },
      }),
      requestCall(StagehandMethods.contextSetDomainPolicy, { policy: null }),
    ]);
  });

  it("routes context cookies and serializes regular-expression filters", async () => {
    const client = new FakeProtocolClient();
    const cookie = {
      name: "session-id",
      value: "abc123",
      domain: "example.test",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    };
    client.queueResponse(StagehandMethods.contextCookies, [cookie]);
    client.queueResponse(StagehandMethods.contextCookies, []);
    client.queueResponse(StagehandMethods.contextAddCookies, { ok: true });
    client.queueResponse(StagehandMethods.contextClearCookies, { ok: true });
    client.queueResponse(StagehandMethods.contextClearCookies, { ok: true });
    const stagehand = createStagehandWithClientForTest(client);
    const cookieParam = {
      name: "preference",
      value: "compact",
      url: "https://example.test/account",
      httpOnly: false,
      sameSite: "Lax" as const,
    };

    await expect(stagehand.context.cookies("https://example.test/account")).resolves.toStrictEqual([
      cookie,
    ]);
    await expect(stagehand.context.cookies()).resolves.toStrictEqual([]);
    await stagehand.context.addCookies([cookieParam]);
    await stagehand.context.clearCookies({
      name: /^session-/gi,
      domain: "example.test",
      path: /^\/account/,
    });
    await stagehand.context.clearCookies();

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.contextCookies, {
        urls: "https://example.test/account",
      }),
      requestCall(StagehandMethods.contextCookies, {}),
      requestCall(StagehandMethods.contextAddCookies, { cookies: [cookieParam] }),
      requestCall(StagehandMethods.contextClearCookies, {
        options: {
          name: { source: "^session-", flags: "gi" },
          domain: "example.test",
          path: { source: "^\\/account", flags: "" },
        },
      }),
      requestCall(StagehandMethods.contextClearCookies, {}),
    ]);
  });

  it("lazily exposes a clipboard facade and routes all clipboard operations", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.contextClipboardReadText, "clipboard text");
    client.queueResponse(StagehandMethods.contextClipboardWriteText, { ok: true });
    client.queueResponse(StagehandMethods.contextClipboardClear, { ok: true });
    client.queueResponse(StagehandMethods.contextClipboardPaste, { ok: true });
    client.queueResponse(StagehandMethods.contextClipboardCopy, { ok: true });
    client.queueResponse(StagehandMethods.contextClipboardCut, { ok: true });
    const stagehand = createStagehandWithClientForTest(client);
    const page = new Page(client, { pageId: "page-1" });

    const clipboard = stagehand.context.clipboard;
    expect(clipboard).toBeInstanceOf(BrowserClipboard);
    expect(stagehand.context.clipboard).toBe(clipboard);
    expect(client.calls).toStrictEqual([]);

    await expect(clipboard.readText({ page })).resolves.toBe("clipboard text");
    await clipboard.writeText("new clipboard text");
    await clipboard.clear({ page });
    await clipboard.paste({ page, shortcut: "Control+V" });
    await clipboard.copy();
    await clipboard.cut({ page });

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.contextClipboardReadText, { pageId: "page-1" }),
      requestCall(StagehandMethods.contextClipboardWriteText, { text: "new clipboard text" }),
      requestCall(StagehandMethods.contextClipboardClear, { pageId: "page-1" }),
      requestCall(StagehandMethods.contextClipboardPaste, {
        pageId: "page-1",
        shortcut: "Control+V",
      }),
      requestCall(StagehandMethods.contextClipboardCopy, {}),
      requestCall(StagehandMethods.contextClipboardCut, { pageId: "page-1" }),
    ]);
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
      timeout: 5000,
    });

    expect(returnedPage).toBe(page);
    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.pageGoto, {
        pageId: "page-1",
        url: "https://example.com/next",
        options: {
          waitUntil: "load",
          timeout: 5000,
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
      page.reload({ waitUntil: "load", timeout: 5_000, ignoreCache: true }),
    ).resolves.toBe(page);
    expect(page.ref.url).toBe("https://example.com/reloaded");

    await expect(page.goBack({ waitUntil: "domcontentloaded" })).resolves.toBe(page);
    expect(page.ref.url).toBe("https://example.com/back");

    await expect(page.goForward()).resolves.toBe(page);
    expect(page.ref.url).toBe("https://example.com/forward");

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.pageReload, {
        pageId: "page-1",
        options: { waitUntil: "load", timeout: 5_000, ignoreCache: true },
      }),
      requestCall(StagehandMethods.pageGoBack, {
        pageId: "page-1",
        options: { waitUntil: "domcontentloaded" },
      }),
      requestCall(StagehandMethods.pageGoForward, { pageId: "page-1" }),
    ]);
  });

  it("routes page coordinate interactions", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.pageClick, { ok: true });
    client.queueResponse(StagehandMethods.pageHover, { ok: true });
    client.queueResponse(StagehandMethods.pageScroll, { ok: true });
    client.queueResponse(StagehandMethods.pageDragAndDrop, { ok: true });
    const page = new Page(client, { pageId: "page-1" });

    await expect(page.click(10, 20, { button: "right", clickCount: 2 })).resolves.toBeUndefined();
    await expect(page.hover(30, 40)).resolves.toBeUndefined();
    await expect(page.scroll(50, 60, -25, 400)).resolves.toBeUndefined();
    await expect(
      page.dragAndDrop(1, 2, 3, 4, {
        button: "left",
        steps: 5,
        delay: 10,
      }),
    ).resolves.toBeUndefined();

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.pageClick, {
        pageId: "page-1",
        x: 10,
        y: 20,
        options: { button: "right", clickCount: 2 },
      }),
      requestCall(StagehandMethods.pageHover, {
        pageId: "page-1",
        x: 30,
        y: 40,
      }),
      requestCall(StagehandMethods.pageScroll, {
        pageId: "page-1",
        x: 50,
        y: 60,
        deltaX: -25,
        deltaY: 400,
      }),
      requestCall(StagehandMethods.pageDragAndDrop, {
        pageId: "page-1",
        fromX: 1,
        fromY: 2,
        toX: 3,
        toY: 4,
        options: { button: "left", steps: 5, delay: 10 },
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
        timeout: 0,
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

  it("wraps callable WebMCP tools and invocations with their owned identity", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.pageWebMCPTools, {
      tools: [
        {
          name: "search",
          description: "Search this site",
          inputSchema: {
            type: "object",
            properties: { searchQuery: { type: "string" } },
          },
          annotations: { readOnly: true },
          frameId: "frame-1",
          backendNodeId: 42,
        },
      ],
    });
    client.queueResponse(StagehandMethods.pageWebMCPInvokeTool, {
      invocationId: "invocation-1",
      toolName: "search",
      frameId: "frame-1",
      input: { searchQuery: "Stagehand" },
    });
    client.queueResponse(StagehandMethods.pageWebMCPInvokeTool, {
      invocationId: "invocation-2",
      toolName: "search",
      frameId: "frame-1",
      input: {},
    });
    client.queueResponse(
      StagehandMethods.pageWebMCPInvocationResult,
      new Error("RPC request timed out: page.webmcp_invocation_result"),
    );
    client.queueResponse(StagehandMethods.pageWebMCPInvocationResult, {
      invocationId: "invocation-1",
      status: "Completed",
      output: { resultValue: "done" },
    });
    client.queueResponse(StagehandMethods.pageWebMCPCancelInvocation, { ok: true });
    const page = new Page(client, { pageId: "page-1" });

    const [tool] = await page.tools({ timeout: 250 });
    expect(tool).toBeInstanceOf(WebMCPTool);
    expect(tool).toMatchObject({
      name: "search",
      description: "Search this site",
      inputSchema: {
        type: "object",
        properties: { searchQuery: { type: "string" } },
      },
      annotations: { readOnly: true },
      frameId: "frame-1",
      backendNodeId: 42,
    });

    const invocation = await tool!.invoke({ input: { searchQuery: "Stagehand" } });
    expect(invocation).toBeInstanceOf(WebMCPInvocation);
    expect(invocation).toMatchObject({
      invocationId: "invocation-1",
      toolName: "search",
      frameId: "frame-1",
      input: { searchQuery: "Stagehand" },
    });
    await tool!.invoke();

    await expect(invocation.result({ timeout: 1 })).rejects.toThrow(
      "RPC request timed out: page.webmcp_invocation_result",
    );
    const result = await invocation.result({ timeout: 5_000 });
    await expect(invocation.result({ timeout: 1 })).resolves.toBe(result);
    expect(result).toStrictEqual({
      invocationId: "invocation-1",
      status: "Completed",
      output: { resultValue: "done" },
    });
    await invocation.cancel();

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.pageWebMCPTools, {
        pageId: "page-1",
        options: { timeout: 250 },
      }),
      requestCall(StagehandMethods.pageWebMCPInvokeTool, {
        pageId: "page-1",
        frameId: "frame-1",
        toolName: "search",
        input: { searchQuery: "Stagehand" },
      }),
      requestCall(StagehandMethods.pageWebMCPInvokeTool, {
        pageId: "page-1",
        frameId: "frame-1",
        toolName: "search",
        input: {},
      }),
      requestCall(StagehandMethods.pageWebMCPInvocationResult, {
        pageId: "page-1",
        invocationId: "invocation-1",
        options: { timeout: 1 },
      }),
      requestCall(StagehandMethods.pageWebMCPInvocationResult, {
        pageId: "page-1",
        invocationId: "invocation-1",
        options: { timeout: 5_000 },
      }),
      requestCall(StagehandMethods.pageWebMCPCancelInvocation, {
        pageId: "page-1",
        invocationId: "invocation-1",
      }),
    ]);
  });

  it("routes page.url", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.pageUrl, "https://example.com");
    const page = new Page(client, { pageId: "page-1" });

    await expect(page.url()).resolves.toBe("https://example.com");
    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.pageUrl, { pageId: "page-1" }),
    ]);
  });

  it("routes page.title", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.pageTitle, "Example");
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

  it("routes stagehand.act with an explicit page and returns the action result", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.stagehandAct, {
      data: {
        success: true,
        message: "Clicked the submit button",
        actionDescription: "Click the submit button",
        actions: [
          {
            selector: "xpath=/html/body/button",
            description: "Submit button",
            method: "click",
            arguments: [],
          },
        ],
      },
      metadata: { cache: { status: "HIT" }, usage: zeroUsage },
    });
    const stagehand = createStagehandWithClientForTest(client);
    const page = new Page(client, { pageId: "page-1" });

    await expect(
      stagehand.act("Click the submit button", {
        page,
        timeout: 5_000,
        variables: { accountEmail: "user@example.com" },
      }),
    ).resolves.toStrictEqual({
      data: {
        success: true,
        message: "Clicked the submit button",
        actionDescription: "Click the submit button",
        actions: [
          {
            selector: "xpath=/html/body/button",
            description: "Submit button",
            method: "click",
            arguments: [],
          },
        ],
      },
      metadata: { cache: { status: "HIT" }, usage: zeroUsage },
    });
    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.stagehandAct, {
        pageId: "page-1",
        instruction: "Click the submit button",
        options: {
          timeout: 5_000,
          variables: { accountEmail: "user@example.com" },
        },
      }),
    ]);
  });

  it("passes an Action returned by observe back to act unchanged", async () => {
    const client = new FakeProtocolClient();
    const observedAction = {
      selector: "xpath=/html/body/button",
      description: "Submit button",
      method: "click",
      arguments: [],
    };
    client.queueResponse(StagehandMethods.stagehandObserve, {
      data: [observedAction],
      metadata: { usage: zeroUsage, cache: { status: "DISABLED" } },
    });
    client.queueResponse(StagehandMethods.stagehandAct, {
      data: {
        success: true,
        message: "Clicked the submit button",
        actionDescription: "Submit button",
        actions: [observedAction],
      },
      metadata: { usage: zeroUsage, cache: { status: "DISABLED" } },
    });
    const stagehand = createStagehandWithClientForTest(client);
    const page = new Page(client, { pageId: "page-1" });

    const actions = await stagehand.observe("Find the submit button", { page });
    await expect(stagehand.act(actions.data[0]!, { page })).resolves.toMatchObject({
      data: {
        success: true,
        actions: [observedAction],
      },
    });

    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.stagehandObserve, {
        pageId: "page-1",
        instruction: "Find the submit button",
        options: {},
      }),
      requestCall(StagehandMethods.stagehandAct, {
        pageId: "page-1",
        instruction: observedAction,
        options: {},
      }),
    ]);
  });

  it("routes stagehand.observe with an explicit page and options", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.stagehandObserve, {
      data: [
        {
          selector: "xpath=/html/body/button",
          description: "Submit button",
          method: "click",
          arguments: [],
        },
      ],
      metadata: { cache: { status: "MISS" }, usage: zeroUsage },
    });
    const stagehand = createStagehandWithClientForTest(client);
    const page = new Page(client, { pageId: "page-1" });

    await expect(
      stagehand.observe("Find the submit button", {
        page,
        selector: "main",
        locator: { selector: "main" },
        variables: {
          accountEmail: {
            value: "user@example.com",
            description: "The account email",
          },
        },
      }),
    ).resolves.toStrictEqual({
      data: [
        {
          selector: "xpath=/html/body/button",
          description: "Submit button",
          method: "click",
          arguments: [],
        },
      ],
      metadata: { cache: { status: "MISS" }, usage: zeroUsage },
    });
    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.stagehandObserve, {
        pageId: "page-1",
        instruction: "Find the submit button",
        options: {
          selector: "main",
          locator: { selector: "main" },
          variables: {
            accountEmail: {
              value: "user@example.com",
              description: "The account email",
            },
          },
        },
      }),
    ]);
  });

  it("uses the active page when stagehand.observe has no explicit page or instruction", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.contextActivePage, { pageId: "page-1" });
    client.queueResponse(StagehandMethods.stagehandObserve, {
      data: [],
      metadata: { usage: zeroUsage, cache: { status: "DISABLED" } },
    });
    const stagehand = createStagehandWithClientForTest(client);

    await expect(stagehand.observe()).resolves.toStrictEqual({
      data: [],
      metadata: { usage: zeroUsage, cache: { status: "DISABLED" } },
    });
    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.contextActivePage, {}),
      requestCall(StagehandMethods.stagehandObserve, { pageId: "page-1" }),
    ]);
  });

  it("rejects stagehand methods when there is no active page", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.contextActivePage, null);
    const stagehand = createStagehandWithClientForTest(client);

    await expect(stagehand.act("Click the submit button")).rejects.toThrow(
      "Stagehand has no active page",
    );
    expect(client.calls).toStrictEqual([requestCall(StagehandMethods.contextActivePage, {})]);
  });

  it("sends the caller's Zod schema through stagehand.extract", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.stagehandExtract, {
      data: { heading: "Example Domain" },
      metadata: { cache: { status: "HIT" }, usage: zeroUsage },
    });
    const stagehand = createStagehandWithClientForTest(client);
    const page = new Page(client, { pageId: "page-1" });
    const schema = z.object({ heading: z.string() });

    await expect(
      stagehand.extract("Extract the page heading", schema, { page, selector: "main" }),
    ).resolves.toStrictEqual({
      data: { heading: "Example Domain" },
      metadata: { cache: { status: "HIT" }, usage: zeroUsage },
    });
    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.stagehandExtract, {
        pageId: "page-1",
        instruction: "Extract the page heading",
        schema: z.json().parse(z.toJSONSchema(schema)),
        options: { selector: "main" },
      }),
    ]);
  });

  it("validates stagehand.extract data with the caller's original Zod schema", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.stagehandExtract, {
      data: { heading: 42 },
      metadata: { usage: zeroUsage, cache: { status: "DISABLED" } },
    });
    const stagehand = createStagehandWithClientForTest(client);
    const page = new Page(client, { pageId: "page-1" });

    await expect(
      stagehand.extract("Extract the page heading", z.object({ heading: z.string() }), { page }),
    ).rejects.toThrow();
  });

  it("does not expose AI methods on Page", () => {
    const client = new FakeProtocolClient();
    const page = new Page(client, { pageId: "page-1" });

    expect(page).not.toHaveProperty("act");
    expect(page).not.toHaveProperty("observe");
    expect(page).not.toHaveProperty("extract");
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

  it("routes locator.isVisible", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.locatorIsVisible, true);
    const page = new Page(client, { pageId: "page-1" });

    await expect(page.locator("#message").isVisible()).resolves.toBe(true);
    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.locatorIsVisible, {
        pageId: "page-1",
        selector: "#message",
      }),
    ]);
  });

  it("routes locator.textContent", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.locatorTextContent, "hello");
    const page = new Page(client, { pageId: "page-1" });

    await expect(page.locator("#message").textContent()).resolves.toBe("hello");
    expect(client.calls).toStrictEqual([
      requestCall(StagehandMethods.locatorTextContent, {
        pageId: "page-1",
        selector: "#message",
      }),
    ]);
  });

  it("routes read locator methods", async () => {
    const client = new FakeProtocolClient();
    client.queueResponse(StagehandMethods.locatorCount, 2);
    client.queueResponse(StagehandMethods.locatorIsChecked, true);
    client.queueResponse(StagehandMethods.locatorInputValue, "user@example.com");
    client.queueResponse(StagehandMethods.locatorInnerText, "visible text");
    client.queueResponse(StagehandMethods.locatorInnerHtml, "<span>visible text</span>");
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
    client.queueResponse(StagehandMethods.locatorSelectOption, ["pro"]);
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

  it("normalizes files and payloads and routes locator.setInputFiles", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "stagehand-upload-test-"));
    const filePath = path.join(directory, "hello.txt");
    const historicalPath = path.join(directory, "historical.txt");
    await writeFile(filePath, "hello");
    await writeFile(historicalPath, "old");
    await utimes(historicalPath, new Date(0), new Date(-1_000));
    try {
      const client = new FakeProtocolClient();
      client.queueResponse(StagehandMethods.locatorSetInputFiles, { set: true });
      client.queueResponse(StagehandMethods.locatorSetInputFiles, { set: true });
      client.queueResponse(StagehandMethods.locatorSetInputFiles, { set: true });
      client.queueResponse(StagehandMethods.locatorSetInputFiles, { set: true });
      const page = new Page(client, { pageId: "page-1" });
      const locator = page.locator("#upload");

      await locator.setInputFiles(filePath);
      await locator.setInputFiles([
        {
          name: "bytes.bin",
          mimeType: "application/octet-stream",
          buffer: new Uint8Array([0, 127, 255]),
          lastModified: 42,
        },
        { name: "message.txt", buffer: "hello" },
      ]);
      await locator.setInputFiles([]);
      await locator.setInputFiles(historicalPath);

      expect(client.calls[0]).toMatchObject({
        method: "locator.set_input_files",
        params: {
          pageId: "page-1",
          selector: "#upload",
          files: [{ name: "hello.txt", data: "aGVsbG8=" }],
        },
      });
      expect(client.calls[1]).toStrictEqual(
        requestCall(StagehandMethods.locatorSetInputFiles, {
          pageId: "page-1",
          selector: "#upload",
          files: [
            {
              name: "bytes.bin",
              mimeType: "application/octet-stream",
              data: "AH//",
              lastModified: 42,
            },
            { name: "message.txt", data: "aGVsbG8=" },
          ],
        }),
      );
      expect(client.calls[2]).toStrictEqual(
        requestCall(StagehandMethods.locatorSetInputFiles, {
          pageId: "page-1",
          selector: "#upload",
          files: [],
        }),
      );
      expect(client.calls[3]).toStrictEqual(
        requestCall(StagehandMethods.locatorSetInputFiles, {
          pageId: "page-1",
          selector: "#upload",
          files: [{ name: "historical.txt", data: "b2xk" }],
        }),
      );

      const missingPath = path.join(directory, "private", "missing.txt");
      const missingError = await locator
        .setInputFiles(missingPath)
        .catch((error: unknown) => error);
      expect(missingError).toBeInstanceOf(TypeError);
      expect((missingError as Error).message).toBe("setInputFiles(): could not read file");
      expect((missingError as Error).message).not.toContain(directory);
      await expect(
        locator.setInputFiles({ name: "historical.txt", buffer: "old", lastModified: -1 }),
      ).rejects.toThrow("lastModified must be a non-negative integer");

      const oversizedPath = path.join(directory, "oversized.bin");
      await writeFile(oversizedPath, "");
      await truncate(oversizedPath, 50 * 1024 * 1024 + 1);
      await expect(locator.setInputFiles(oversizedPath)).rejects.toThrow(
        "file is larger than the 50 MiB upload limit",
      );

      const oversizedMemoryPayload = new Uint8Array(50 * 1024 * 1024 + 1);
      const bufferFrom = vi.spyOn(Buffer, "from");
      try {
        await expect(
          locator.setInputFiles({ name: "oversized.bin", buffer: oversizedMemoryPayload }),
        ).rejects.toThrow("file is larger than the 50 MiB upload limit");
        expect(bufferFrom).not.toHaveBeenCalled();
      } finally {
        bufferFrom.mockRestore();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
