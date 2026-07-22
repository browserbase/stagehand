import { trace } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vite-plus/test";
import { JSONRPCRequestSchema, JSONRPCResponseSchema } from "../../protocol/json-rpc/schemas.ts";
import type { JSONRPCResponse } from "../../protocol/json-rpc/types.ts";
import {
  STAGEHAND_SEND_TO_HOST_BINDING,
  StagehandRpcNotificationSchema,
  StagehandSendToHostBindingSchema,
} from "../../protocol/schema-registry.ts";
import { startStagehandServiceWorker } from "../service-worker.ts";
import type {
  StagehandBrowserSession,
  UnderstudyRuntimeClipboardOptions,
  UnderstudyRuntimeClipboardPasteOptions,
  UnderstudyRuntimeClearCookieOptions,
  UnderstudyRuntimeLocator,
  UnderstudyRuntimePage,
  UnderstudyRuntimeScreenshotOptions,
} from "../runtime.ts";
import { createStagehandRuntime, type StagehandRuntimeAdapters } from "../runtime.ts";
import type { StagehandTracing } from "../tracing.ts";
import type {
  ContextSetExtraHTTPHeadersParams,
  Cookie,
  CookieParam,
  DomainPolicy,
  LocatorCentroidResult,
  LocatorClickParams,
  LocatorHighlightParams,
  LocatorScrollToParams,
  LocatorSelectOptionResult,
  LocatorSelectOptionParams,
  LocatorSendClickEventParams,
  LocatorTypeParams,
  PageAddInitScriptParams,
  PageClickParams,
  PageDragAndDropParams,
  PageEvaluateParams,
  PageGoBackParams,
  PageGoForwardParams,
  PageHoverParams,
  PageKeyPressParams,
  PageReloadParams,
  PageScrollParams,
  PageSnapshotOptions,
  PageSetExtraHTTPHeadersParams,
  PageSetViewportSizeParams,
  SnapshotResult,
  PageTypeParams,
  PageWaitForLoadStateParams,
  PageWaitForSelectorParams,
  PageWaitForTimeoutParams,
} from "../../protocol/types.ts";

vi.mock("../understudy/context.js", () => ({
  V3Context: {
    create: vi.fn(),
  },
}));

class FakeRuntimeClipboard {
  readTextResult = "clipboard text";
  readonly readTextCalls: Array<UnderstudyRuntimeClipboardOptions | undefined> = [];
  readonly writeTextCalls: Array<{
    text: string;
    options?: UnderstudyRuntimeClipboardOptions;
  }> = [];
  readonly clearCalls: Array<UnderstudyRuntimeClipboardOptions | undefined> = [];
  readonly pasteCalls: Array<UnderstudyRuntimeClipboardPasteOptions | undefined> = [];
  readonly copyCalls: Array<UnderstudyRuntimeClipboardOptions | undefined> = [];
  readonly cutCalls: Array<UnderstudyRuntimeClipboardOptions | undefined> = [];

  async readText(options?: UnderstudyRuntimeClipboardOptions): Promise<string> {
    this.readTextCalls.push(options);
    return this.readTextResult;
  }

  async writeText(text: string, options?: UnderstudyRuntimeClipboardOptions): Promise<void> {
    this.writeTextCalls.push({ text, options });
  }

  async clear(options?: UnderstudyRuntimeClipboardOptions): Promise<void> {
    this.clearCalls.push(options);
  }

  async paste(options?: UnderstudyRuntimeClipboardPasteOptions): Promise<void> {
    this.pasteCalls.push(options);
  }

  async copy(options?: UnderstudyRuntimeClipboardOptions): Promise<void> {
    this.copyCalls.push(options);
  }

  async cut(options?: UnderstudyRuntimeClipboardOptions): Promise<void> {
    this.cutCalls.push(options);
  }
}

class FakeBrowserSession implements StagehandBrowserSession {
  closed = false;
  connected = true;
  getVersionCalls = 0;
  readonly pageRefs: FakeUnderstudyRuntimePage[];
  activePageRef: UnderstudyRuntimePage | undefined;
  readonly setActivePageCalls: UnderstudyRuntimePage[] = [];
  readonly contextAddInitScriptCalls: string[] = [];
  readonly contextSetExtraHTTPHeadersCalls: ContextSetExtraHTTPHeadersParams["headers"][] = [];
  domainPolicy: DomainPolicy | null = null;
  readonly setDomainPolicyCalls: Array<DomainPolicy | null> = [];
  cookieValues: Cookie[] = [];
  readonly cookiesCalls: Array<string | string[] | undefined> = [];
  readonly addCookiesCalls: CookieParam[][] = [];
  readonly clearCookiesCalls: Array<UnderstudyRuntimeClearCookieOptions | undefined> = [];
  readonly clipboard = new FakeRuntimeClipboard();

  constructor(
    pages: FakeUnderstudyRuntimePage[] = [],
    readonly version = {
      protocolVersion: "1.3",
      product: "Chrome/143.0.0.0",
      revision: "@abc123",
      userAgent: "Mozilla/5.0",
      jsVersion: "14.3",
    },
  ) {
    this.pageRefs = pages;
    this.activePageRef = pages.at(-1);
  }

  async getVersion() {
    this.getVersionCalls += 1;
    return this.version;
  }

  pages(): UnderstudyRuntimePage[] {
    return this.pageRefs;
  }

  async newPage(url = "about:blank"): Promise<UnderstudyRuntimePage> {
    const page = new FakeUnderstudyRuntimePage(`page-${this.pageRefs.length + 1}`, url);
    this.pageRefs.push(page);
    this.activePageRef = page;
    return page;
  }

  activePage(): UnderstudyRuntimePage | undefined {
    return this.activePageRef;
  }

  setActivePage(page: UnderstudyRuntimePage): void {
    this.setActivePageCalls.push(page);
    this.activePageRef = page;
  }

  async addInitScript(source: string): Promise<void> {
    this.contextAddInitScriptCalls.push(source);
  }

  async setExtraHTTPHeaders(headers: ContextSetExtraHTTPHeadersParams["headers"]): Promise<void> {
    this.contextSetExtraHTTPHeadersCalls.push(headers);
  }

  getDomainPolicy(): DomainPolicy | null {
    return this.domainPolicy;
  }

  async setDomainPolicy(policy: DomainPolicy | null): Promise<void> {
    this.setDomainPolicyCalls.push(policy);
    this.domainPolicy = policy;
  }

  async cookies(urls?: string | string[]): Promise<Cookie[]> {
    this.cookiesCalls.push(urls);
    return this.cookieValues;
  }

  async addCookies(cookies: CookieParam[]): Promise<void> {
    this.addCookiesCalls.push(cookies);
  }

  async clearCookies(options?: UnderstudyRuntimeClearCookieOptions): Promise<void> {
    this.clearCookiesCalls.push(options);
  }

  close(): void {
    this.closed = true;
    this.connected = false;
  }
}

class FakeUnderstudyRuntimePage implements UnderstudyRuntimePage {
  readonly gotoCalls: Array<{
    url: string;
    options?: {
      waitUntil?: "load" | "domcontentloaded" | "networkidle";
      timeout?: number;
    };
  }> = [];
  readonly reloadCalls: Array<PageReloadParams["options"]> = [];
  readonly goBackCalls: Array<PageGoBackParams["options"]> = [];
  readonly goForwardCalls: Array<PageGoForwardParams["options"]> = [];
  readonly clickCalls: Array<{ x: number; y: number; options?: PageClickParams["options"] }> = [];
  readonly hoverCalls: Array<{ x: number; y: number; options?: PageHoverParams["options"] }> = [];
  readonly scrollCalls: Array<{
    x: number;
    y: number;
    deltaX: number;
    deltaY: number;
    options?: PageScrollParams["options"];
  }> = [];
  readonly dragAndDropCalls: Array<{
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    options?: PageDragAndDropParams["options"];
  }> = [];
  readonly pageTypeCalls: Array<{ text: string; options?: PageTypeParams["options"] }> = [];
  readonly keyPressCalls: Array<{ key: string; options?: PageKeyPressParams["options"] }> = [];
  readonly evaluateCalls: string[] = [];
  readonly addInitScriptCalls: string[] = [];
  readonly setExtraHTTPHeadersCalls: Array<PageSetExtraHTTPHeadersParams["headers"]> = [];
  readonly setViewportSizeCalls: Array<{
    width: number;
    height: number;
    options?: PageSetViewportSizeParams["options"];
  }> = [];
  readonly waitForLoadStateCalls: Array<{
    state: PageWaitForLoadStateParams["state"];
    timeout?: number;
  }> = [];
  readonly waitForTimeoutCalls: Array<PageWaitForTimeoutParams["ms"]> = [];
  readonly waitForSelectorCalls: Array<{
    selector: string;
    options?: PageWaitForSelectorParams["options"];
  }> = [];
  readonly screenshotCalls: Array<UnderstudyRuntimeScreenshotOptions | undefined> = [];
  readonly snapshotCalls: Array<PageSnapshotOptions | undefined> = [];
  readonly locatorRefs: FakeUnderstudyRuntimeLocator[] = [];
  readonly locatorsBySelector = new Map<string, FakeUnderstudyRuntimeLocator>();
  closed = false;
  currentUrl: string;
  backUrl?: string;
  forwardUrl?: string;
  clickXpath = "/html/body/button";
  hoverXpath = "/html/body/a";
  scrollXpath = "/html/body/main";
  dragXpaths: [string, string] = ["/html/body/div[1]", "/html/body/div[2]"];
  evaluationResult: unknown = null;
  waitForSelectorResult = true;
  screenshotBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  snapshotResult: SnapshotResult = {
    formattedTree: "root",
    xpathMap: { frameOne: "/html/body" },
    urlMap: { frameOne: "https://example.test" },
  };

  constructor(
    readonly id: string,
    currentUrl: string,
    readonly currentTitle = "",
  ) {
    this.currentUrl = currentUrl;
  }

  async goto(
    url: string,
    options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number },
  ): Promise<void> {
    this.gotoCalls.push({ url, options });
    this.currentUrl = url;
  }

  async reload(options?: PageReloadParams["options"]): Promise<void> {
    this.reloadCalls.push(options);
  }

  async goBack(options?: PageGoBackParams["options"]): Promise<void> {
    this.goBackCalls.push(options);
    if (this.backUrl) this.currentUrl = this.backUrl;
  }

  async goForward(options?: PageGoForwardParams["options"]): Promise<void> {
    this.goForwardCalls.push(options);
    if (this.forwardUrl) this.currentUrl = this.forwardUrl;
  }

  async click(x: number, y: number, options?: PageClickParams["options"]): Promise<string> {
    this.clickCalls.push({ x, y, options });
    return this.clickXpath;
  }

  async hover(x: number, y: number, options?: PageHoverParams["options"]): Promise<string> {
    this.hoverCalls.push({ x, y, options });
    return this.hoverXpath;
  }

  async scroll(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    options?: PageScrollParams["options"],
  ): Promise<string> {
    this.scrollCalls.push({ x, y, deltaX, deltaY, options });
    return this.scrollXpath;
  }

  async dragAndDrop(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    options?: PageDragAndDropParams["options"],
  ): Promise<[string, string]> {
    this.dragAndDropCalls.push({ fromX, fromY, toX, toY, options });
    return this.dragXpaths;
  }

  async type(text: string, options?: PageTypeParams["options"]): Promise<void> {
    this.pageTypeCalls.push({ text, options });
  }

  async keyPress(key: string, options?: PageKeyPressParams["options"]): Promise<void> {
    this.keyPressCalls.push({ key, options });
  }

  async evaluate(expression: PageEvaluateParams["expression"]): Promise<unknown> {
    this.evaluateCalls.push(expression);
    return this.evaluationResult;
  }

  async addInitScript(source: PageAddInitScriptParams["source"]): Promise<void> {
    this.addInitScriptCalls.push(source);
  }

  async setExtraHTTPHeaders(headers: PageSetExtraHTTPHeadersParams["headers"]): Promise<void> {
    this.setExtraHTTPHeadersCalls.push(headers);
  }

  async setViewportSize(
    width: number,
    height: number,
    options?: PageSetViewportSizeParams["options"],
  ): Promise<void> {
    this.setViewportSizeCalls.push({ width, height, options });
  }

  async waitForLoadState(
    state: PageWaitForLoadStateParams["state"],
    timeout?: number,
  ): Promise<void> {
    this.waitForLoadStateCalls.push({ state, timeout });
  }

  async waitForTimeout(ms: PageWaitForTimeoutParams["ms"]): Promise<void> {
    this.waitForTimeoutCalls.push(ms);
  }

  async waitForSelector(
    selector: string,
    options?: PageWaitForSelectorParams["options"],
  ): Promise<boolean> {
    this.waitForSelectorCalls.push({ selector, options });
    return this.waitForSelectorResult;
  }

  async screenshot(options?: UnderstudyRuntimeScreenshotOptions): Promise<Uint8Array> {
    this.screenshotCalls.push(options);
    return this.screenshotBytes;
  }

  async snapshot(options?: PageSnapshotOptions): Promise<SnapshotResult> {
    this.snapshotCalls.push(options);
    return this.snapshotResult;
  }

  targetId(): string {
    return this.id;
  }

  url(): string {
    return this.currentUrl;
  }

  async title(): Promise<string> {
    return this.currentTitle;
  }

  async captureSnapshot() {
    return {
      combinedTree: `[0-1] heading: ${this.currentTitle || "Example Domain"}`,
      combinedXpathMap: { "0-1": "/html/body/h1" },
      combinedUrlMap: {},
    };
  }

  close(): void {
    this.closed = true;
  }

  deepLocator(selector: string): UnderstudyRuntimeLocator {
    const locator =
      this.locatorsBySelector.get(selector) ?? new FakeUnderstudyRuntimeLocator(selector);
    this.locatorRefs.push(locator);
    return locator;
  }
}

class FakeUnderstudyRuntimeLocator implements UnderstudyRuntimeLocator {
  readonly clickCalls: Array<LocatorClickParams["options"]> = [];
  readonly fillCalls: string[] = [];
  readonly scrollToCalls: LocatorScrollToParams["percent"][] = [];
  readonly highlightCalls: Array<LocatorHighlightParams["options"]> = [];
  readonly sendClickEventCalls: Array<LocatorSendClickEventParams["options"]> = [];
  readonly typeCalls: Array<{ text: string; options?: LocatorTypeParams["options"] }> = [];
  readonly selectOptionCalls: Array<LocatorSelectOptionParams["values"]> = [];
  readonly nthCalls: number[] = [];

  constructor(
    readonly selector: string,
    readonly visible = true,
    readonly text = "",
    readonly values: {
      checked?: boolean;
      inputValue?: string;
      innerText?: string;
      innerHtml?: string;
      count?: number;
      centroid?: LocatorCentroidResult;
      selectedValues?: LocatorSelectOptionResult["values"];
    } = {},
  ) {}

  click(options?: LocatorClickParams["options"]): void {
    this.clickCalls.push(options ?? {});
  }

  hover(): void {}

  fill(value: string): void {
    this.fillCalls.push(value);
  }

  async count(): Promise<number> {
    return this.values.count ?? 1;
  }

  async isChecked(): Promise<boolean> {
    return this.values.checked ?? false;
  }

  async inputValue(): Promise<string> {
    return this.values.inputValue ?? "";
  }

  async isVisible(): Promise<boolean> {
    return this.visible;
  }

  async innerText(): Promise<string> {
    return this.values.innerText ?? this.text;
  }

  async innerHtml(): Promise<string> {
    return this.values.innerHtml ?? this.text;
  }

  async textContent(): Promise<string> {
    return this.text;
  }

  scrollTo(percent: LocatorScrollToParams["percent"]): void {
    this.scrollToCalls.push(percent);
  }

  async centroid(): Promise<LocatorCentroidResult> {
    return this.values.centroid ?? { x: 0, y: 0 };
  }

  highlight(options?: LocatorHighlightParams["options"]): void {
    this.highlightCalls.push(options);
  }

  sendClickEvent(options?: LocatorSendClickEventParams["options"]): void {
    this.sendClickEventCalls.push(options);
  }

  type(text: string, options?: LocatorTypeParams["options"]): void {
    this.typeCalls.push({ text, options });
  }

  async selectOption(values: LocatorSelectOptionParams["values"]): Promise<string[]> {
    this.selectOptionCalls.push(values);
    return this.values.selectedValues ?? (Array.isArray(values) ? values : [values]);
  }

  nth(index: number): UnderstudyRuntimeLocator {
    this.nthCalls.push(index);
    return new FakeUnderstudyRuntimeLocator(this.selector, this.visible, this.text, {
      ...this.values,
    });
  }
}

const testTracing: StagehandTracing = {
  tracer: trace.getTracer("stagehand-app-test"),
  configure: () => {},
  forceFlush: async () => {},
  shutdown: async () => {},
};

function createHandle(adapters: StagehandRuntimeAdapters = {}) {
  const runtime = createStagehandRuntime(
    {
      browserSessionFactory: async () => {
        throw new Error("Stagehand browser session factory is not configured");
      },
      ...adapters,
    },
    testTracing,
  );
  let resolveResponse: ((response: JSONRPCResponse) => void) | undefined;
  const scope: {
    [STAGEHAND_SEND_TO_HOST_BINDING](payload: string): void;
    __stagehandReceiveFromHost?: (raw: unknown) => Promise<void>;
  } = {
    [STAGEHAND_SEND_TO_HOST_BINDING]: (payload) => {
      const response = JSONRPCResponseSchema.safeParse(JSON.parse(payload));
      if (!response.success) return;
      resolveResponse?.(response.data);
      resolveResponse = undefined;
    },
  };
  startStagehandServiceWorker(scope, runtime);

  return async (input: unknown): Promise<JSONRPCResponse> => {
    const request = JSONRPCRequestSchema.parse(input);
    return await new Promise((resolve, reject) => {
      resolveResponse = resolve;
      void scope.__stagehandReceiveFromHost?.(JSON.stringify(request)).catch(reject);
    });
  };
}

async function createConfiguredHandler(
  session: FakeBrowserSession,
): Promise<ReturnType<typeof createHandle>> {
  const handle = createHandle({
    browserSessionFactory: async () => session,
  });

  await handle({
    jsonrpc: "2.0",
    id: 1,
    method: "runtime.configure",
    params: {
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
    },
  });

  return handle;
}

async function createConfiguredRuntime(session: FakeBrowserSession) {
  const runtime = createStagehandRuntime({
    browserSessionFactory: async () => session,
  });

  await runtime.configureLoopback({
    cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
    telemetry: {
      traces: {
        endpoint: "https://example.com/v1/traces",
        headers: {},
      },
    },
  });

  return runtime;
}

describe("Stagehand worker clients", () => {
  it("accepts only the shared Stagehand Chrome binding name", () => {
    expect(StagehandSendToHostBindingSchema.parse(STAGEHAND_SEND_TO_HOST_BINDING)).toBe(
      STAGEHAND_SEND_TO_HOST_BINDING,
    );
    expect(() => StagehandSendToHostBindingSchema.parse("__other_binding")).toThrow();
  });

  it("installs the Stagehand runtime identity marker", () => {
    const scope = {};

    startStagehandServiceWorker(scope);

    expect(scope).toMatchObject({
      __stagehand_runtime: {
        name: "stagehand",
        version: "stagehand.v4",
      },
      __stagehandReceiveFromHost: expect.any(Function),
    });
  });

  it("streams Stagehand logs and responses through the shared RPC binding", async () => {
    const messages: unknown[] = [];
    const scope: {
      [STAGEHAND_SEND_TO_HOST_BINDING](payload: string): void;
      __stagehandReceiveFromHost?: (raw: unknown) => Promise<void>;
    } = {
      [STAGEHAND_SEND_TO_HOST_BINDING]: (payload) => messages.push(JSON.parse(payload)),
    };
    startStagehandServiceWorker(scope);

    await scope.__stagehandReceiveFromHost?.(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "ping",
        params: {},
      }),
    );

    expect(
      messages.find((message) => JSONRPCResponseSchema.safeParse(message).success),
    ).toStrictEqual({
      jsonrpc: "2.0",
      id: 7,
      result: {
        ok: true,
        runtime: "service_worker",
      },
    });
    expect(
      messages.find((message) => StagehandRpcNotificationSchema.safeParse(message).success),
    ).toStrictEqual({
      jsonrpc: "2.0",
      method: "stagehand.log",
      params: {
        level: "info",
        message: "[stagehand] ping",
        data: {},
      },
    });
  });

  it("rejects malformed JSON-RPC before it reaches the request handler", async () => {
    const messages: unknown[] = [];
    const scope: {
      [STAGEHAND_SEND_TO_HOST_BINDING](payload: string): void;
      __stagehandReceiveFromHost?: (raw: unknown) => Promise<void>;
    } = {
      [STAGEHAND_SEND_TO_HOST_BINDING]: (payload) => messages.push(JSON.parse(payload)),
    };
    startStagehandServiceWorker(scope);

    await scope.__stagehandReceiveFromHost?.(JSON.stringify({ method: "ping", params: {} }));

    expect(messages).toContainEqual({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32600,
        message: "Invalid request",
      },
    });
  });

  it("returns a parse error for invalid JSON before it reaches the request handler", async () => {
    const messages: unknown[] = [];
    const scope: {
      [STAGEHAND_SEND_TO_HOST_BINDING](payload: string): void;
      __stagehandReceiveFromHost?: (raw: unknown) => Promise<void>;
    } = {
      [STAGEHAND_SEND_TO_HOST_BINDING]: (payload) => messages.push(JSON.parse(payload)),
    };
    startStagehandServiceWorker(scope);

    await scope.__stagehandReceiveFromHost?.("{");

    expect(messages).toContainEqual({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: "Parse error",
      },
    });
  });

  it("rejects non-string messages at the Chrome binding boundary", async () => {
    const scope: {
      [STAGEHAND_SEND_TO_HOST_BINDING](payload: string): void;
      __stagehandReceiveFromHost?: (raw: unknown) => Promise<void>;
    } = {
      [STAGEHAND_SEND_TO_HOST_BINDING]: () => {},
    };
    startStagehandServiceWorker(scope);

    await expect(scope.__stagehandReceiveFromHost?.({ jsonrpc: "2.0" })).rejects.toThrow(
      "expected string",
    );
  });

  it("handles ping", async () => {
    await expect(
      createHandle()({
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
        params: {},
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        ok: true,
        runtime: "service_worker",
      },
    });
  });

  it("reports unconfigured loopback status", async () => {
    const handle = createHandle();

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runtime.loopback_status",
        params: {},
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 3,
      result: {
        configured: false,
        connected: false,
      },
    });
  });

  it("configures the browser session and reports connected status", async () => {
    const sessions: FakeBrowserSession[] = [];
    const handle = createHandle({
      browserSessionFactory: async () => {
        const session = new FakeBrowserSession();
        sessions.push(session);
        return session;
      },
    });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runtime.configure",
        params: {
          cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        configured: true,
      },
    });

    expect(sessions).toHaveLength(1);

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 4,
        method: "runtime.loopback_status",
        params: {},
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 4,
      result: {
        configured: true,
        connected: true,
      },
    });
  });

  it("closes the previous browser session when reconfigured", async () => {
    const sessions: FakeBrowserSession[] = [];
    const handle = createHandle({
      browserSessionFactory: async () => {
        const session = new FakeBrowserSession();
        sessions.push(session);
        return session;
      },
    });

    await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runtime.configure",
      params: {
        cdpUrl: "ws://127.0.0.1:9222/devtools/browser/first",
      },
    });
    await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runtime.configure",
      params: {
        cdpUrl: "ws://127.0.0.1:9222/devtools/browser/second",
      },
    });

    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.closed).toBe(true);
    expect(sessions[1]?.closed).toBe(false);
  });

  it("closes the browser session on stagehand.close", async () => {
    const session = new FakeBrowserSession();
    const handle = createHandle({
      browserSessionFactory: async () => session,
    });

    await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runtime.configure",
      params: {
        cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
      },
    });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 5,
        method: "stagehand.close",
        params: {},
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 5,
      result: {
        closed: true,
      },
    });

    expect(session.closed).toBe(true);

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 3,
        method: "runtime.loopback_status",
        params: {},
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 3,
      result: {
        configured: false,
        connected: false,
      },
    });
  });

  it("calls Browser.getVersion through the browser session", async () => {
    const session = new FakeBrowserSession([], {
      protocolVersion: "1.3",
      product: "Chrome/143.0.0.0",
      revision: "@abc123",
      userAgent: "Mozilla/5.0",
      jsVersion: "14.3",
    });
    const handle = createHandle({
      browserSessionFactory: async () => session,
    });

    await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runtime.configure",
      params: {
        cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
      },
    });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 6,
        method: "browser.get_version",
        params: {},
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 6,
      result: {
        protocol_version: "1.3",
        product: "Chrome/143.0.0.0",
        revision: "@abc123",
        user_agent: "Mozilla/5.0",
        js_version: "14.3",
      },
    });

    expect(session.getVersionCalls).toBe(1);
  });

  it("returns a clear error for context.pages before runtime is configured", async () => {
    const handle = createHandle();

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 7,
        method: "context.pages",
        params: {},
      }),
    ).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 7,
      error: {
        code: -32603,
        message: "Stagehand loopback CDP is not configured",
        data: { name: "Error" },
      },
    });
  });

  it("returns PageRefs from the configured understudy context", async () => {
    const context = new FakeBrowserSession([
      new FakeUnderstudyRuntimePage("page-a", "https://example.test/a"),
      new FakeUnderstudyRuntimePage("page-b", "about:blank"),
    ]);
    const handle = createHandle({
      browserSessionFactory: async () => context,
    });

    await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runtime.configure",
      params: {
        cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
      },
    });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 7,
        method: "context.pages",
        params: {},
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 7,
      result: [
        {
          page_id: "page-a",
          url: "https://example.test/a",
        },
        {
          page_id: "page-b",
          url: "about:blank",
        },
      ],
    });
  });

  it("creates a new understudy page and returns a PageRef", async () => {
    const context = new FakeBrowserSession();
    const handle = createHandle({
      browserSessionFactory: async () => context,
    });

    await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runtime.configure",
      params: {
        cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
      },
    });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 8,
        method: "context.new_page",
        params: {
          url: "https://example.test/new",
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 8,
      result: {
        page_id: "page-1",
        url: "https://example.test/new",
      },
    });

    expect(context.pages().map((page) => page.targetId())).toStrictEqual(["page-1"]);
  });

  it("returns and updates the active understudy page", async () => {
    const pageA = new FakeUnderstudyRuntimePage("page-a", "https://example.test/a");
    const pageB = new FakeUnderstudyRuntimePage("page-b", "https://example.test/b");
    const context = new FakeBrowserSession([pageA, pageB]);
    const handle = await createConfiguredHandler(context);

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 9,
        method: "context.active_page",
        params: {},
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 9,
      result: {
        page_id: "page-b",
        url: "https://example.test/b",
      },
    });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 10,
        method: "context.set_active_page",
        params: { page_id: "page-a" },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 10,
      result: { ok: true },
    });

    expect(context.setActivePageCalls).toStrictEqual([pageA]);
    await expect(
      handle({
        jsonrpc: "2.0",
        id: 11,
        method: "context.active_page",
        params: {},
      }),
    ).resolves.toMatchObject({
      result: { page_id: "page-a" },
    });
  });

  it("returns null when the context has no active page", async () => {
    const handle = await createConfiguredHandler(new FakeBrowserSession());

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 9,
        method: "context.active_page",
        params: {},
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 9,
      result: null,
    });
  });

  it("closes the configured context", async () => {
    const context = new FakeBrowserSession();
    const handle = await createConfiguredHandler(context);

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 9,
        method: "context.close",
        params: {},
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 9,
      result: { closed: true },
    });
    expect(context.closed).toBe(true);
  });

  it("routes context scripts, headers, and domain policy", async () => {
    const context = new FakeBrowserSession();
    const handle = await createConfiguredHandler(context);

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 12,
        method: "context.add_init_script",
        params: { source: "globalThis.ready = true" },
      }),
    ).resolves.toMatchObject({ result: { ok: true } });
    await expect(
      handle({
        jsonrpc: "2.0",
        id: 13,
        method: "context.set_extra_http_headers",
        params: {
          headers: { "X-Request-ID": "request-1", doNotRenameMe: "value" },
        },
      }),
    ).resolves.toMatchObject({ result: { ok: true } });
    await expect(
      handle({
        jsonrpc: "2.0",
        id: 14,
        method: "context.set_domain_policy",
        params: {
          policy: {
            allowed_domains: ["example.test"],
            blocked_domains: ["blocked.example.test"],
          },
        },
      }),
    ).resolves.toMatchObject({ result: { ok: true } });
    await expect(
      handle({
        jsonrpc: "2.0",
        id: 15,
        method: "context.get_domain_policy",
        params: {},
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 15,
      result: {
        policy: {
          allowed_domains: ["example.test"],
          blocked_domains: ["blocked.example.test"],
        },
      },
    });

    expect(context.contextAddInitScriptCalls).toStrictEqual(["globalThis.ready = true"]);
    expect(context.contextSetExtraHTTPHeadersCalls).toStrictEqual([
      { "X-Request-ID": "request-1", doNotRenameMe: "value" },
    ]);
    expect(context.setDomainPolicyCalls).toStrictEqual([
      {
        allowedDomains: ["example.test"],
        blockedDomains: ["blocked.example.test"],
      },
    ]);
  });

  it("forwards an explicit null domain policy", async () => {
    const context = new FakeBrowserSession();
    const handle = await createConfiguredHandler(context);

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 16,
        method: "context.set_domain_policy",
        params: { policy: null },
      }),
    ).resolves.toMatchObject({ result: { ok: true } });
    await expect(
      handle({
        jsonrpc: "2.0",
        id: 17,
        method: "context.get_domain_policy",
        params: {},
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 17,
      result: { policy: null },
    });

    expect(context.setDomainPolicyCalls).toStrictEqual([null]);
  });

  it("routes context cookie reads, writes, and clears", async () => {
    const context = new FakeBrowserSession();
    context.cookieValues = [
      {
        name: "session-id",
        value: "abc123",
        domain: "example.test",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ];
    const handle = await createConfiguredHandler(context);

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 18,
        method: "context.cookies",
        params: { urls: ["https://example.test/account"] },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 18,
      result: {
        cookies: [
          {
            name: "session-id",
            value: "abc123",
            domain: "example.test",
            path: "/",
            expires: -1,
            http_only: true,
            secure: true,
            same_site: "Lax",
          },
        ],
      },
    });
    await expect(
      handle({
        jsonrpc: "2.0",
        id: 19,
        method: "context.add_cookies",
        params: {
          cookies: [
            {
              name: "preference",
              value: "compact",
              url: "https://example.test/account",
              http_only: false,
              same_site: "Lax",
            },
          ],
        },
      }),
    ).resolves.toMatchObject({ result: { ok: true } });
    await expect(
      handle({
        jsonrpc: "2.0",
        id: 20,
        method: "context.clear_cookies",
        params: {
          options: {
            name: { source: "^session-", flags: "i" },
            domain: "example.test",
          },
        },
      }),
    ).resolves.toMatchObject({ result: { ok: true } });
    await expect(
      handle({
        jsonrpc: "2.0",
        id: 21,
        method: "context.clear_cookies",
        params: {},
      }),
    ).resolves.toMatchObject({ result: { ok: true } });

    expect(context.cookiesCalls).toStrictEqual([["https://example.test/account"]]);
    expect(context.addCookiesCalls).toStrictEqual([
      [
        {
          name: "preference",
          value: "compact",
          url: "https://example.test/account",
          httpOnly: false,
          sameSite: "Lax",
        },
      ],
    ]);
    expect(context.clearCookiesCalls).toHaveLength(2);
    expect(context.clearCookiesCalls[0]).toStrictEqual({
      name: /^session-/i,
      domain: "example.test",
    });
    expect(context.clearCookiesCalls[1]).toBeUndefined();
  });

  it("routes clipboard operations with resolved and active-page targets", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "https://example.test");
    const context = new FakeBrowserSession([page]);
    const handle = await createConfiguredHandler(context);

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 22,
        method: "context.clipboard_read_text",
        params: { page_id: "page-a" },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 22,
      result: { text: "clipboard text" },
    });
    await expect(
      handle({
        jsonrpc: "2.0",
        id: 23,
        method: "context.clipboard_write_text",
        params: { text: "new clipboard text" },
      }),
    ).resolves.toMatchObject({ result: { ok: true } });
    await expect(
      handle({
        jsonrpc: "2.0",
        id: 24,
        method: "context.clipboard_clear",
        params: { page_id: "page-a" },
      }),
    ).resolves.toMatchObject({ result: { ok: true } });
    await expect(
      handle({
        jsonrpc: "2.0",
        id: 25,
        method: "context.clipboard_paste",
        params: { page_id: "page-a", shortcut: "Meta+V" },
      }),
    ).resolves.toMatchObject({ result: { ok: true } });
    await expect(
      handle({
        jsonrpc: "2.0",
        id: 26,
        method: "context.clipboard_copy",
        params: {},
      }),
    ).resolves.toMatchObject({ result: { ok: true } });
    await expect(
      handle({
        jsonrpc: "2.0",
        id: 27,
        method: "context.clipboard_cut",
        params: { page_id: "page-a" },
      }),
    ).resolves.toMatchObject({ result: { ok: true } });

    expect(context.clipboard.readTextCalls).toStrictEqual([{ page }]);
    expect(context.clipboard.writeTextCalls).toStrictEqual([
      { text: "new clipboard text", options: undefined },
    ]);
    expect(context.clipboard.clearCalls).toStrictEqual([{ page }]);
    expect(context.clipboard.pasteCalls).toStrictEqual([{ page, shortcut: "Meta+V" }]);
    expect(context.clipboard.copyCalls).toStrictEqual([undefined]);
    expect(context.clipboard.cutCalls).toStrictEqual([{ page }]);
  });

  it("returns page resolution errors for clipboard targets", async () => {
    const context = new FakeBrowserSession();
    const handle = await createConfiguredHandler(context);

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 28,
        method: "context.clipboard_read_text",
        params: { page_id: "missing-page" },
      }),
    ).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 28,
      error: {
        code: -32603,
        message: 'Stagehand page "missing-page" was not found; call context.pages and retry',
        data: { name: "Error" },
      },
    });
    expect(context.clipboard.readTextCalls).toStrictEqual([]);
  });

  it("routes page.goto to the resolved understudy page", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "about:blank");
    const handle = await createConfiguredHandler(new FakeBrowserSession([page]));

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 9,
        method: "page.goto",
        params: {
          pageId: "page-a",
          url: "https://example.test/next",
          options: {
            waitUntil: "domcontentloaded",
            timeout: 5000,
          },
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 9,
      result: {
        page_id: "page-a",
        url: "https://example.test/next",
      },
    });

    expect(page.gotoCalls).toStrictEqual([
      {
        url: "https://example.test/next",
        options: {
          waitUntil: "domcontentloaded",
          timeout: 5000,
        },
      },
    ]);
  });

  it("routes page navigation commands and returns refreshed page refs", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "https://example.test/current");
    page.backUrl = "https://example.test/back";
    page.forwardUrl = "https://example.test/forward";
    const handle = await createConfiguredHandler(new FakeBrowserSession([page]));

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 13,
        method: "page.reload",
        params: {
          page_id: "page-a",
          options: { wait_until: "load", timeout: 5_000, ignore_cache: true },
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 13,
      result: { page_id: "page-a", url: "https://example.test/current" },
    });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 14,
        method: "page.go_back",
        params: { page_id: "page-a", options: { wait_until: "domcontentloaded" } },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 14,
      result: { page_id: "page-a", url: "https://example.test/back" },
    });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 15,
        method: "page.go_forward",
        params: { page_id: "page-a", options: { timeout: 2_500 } },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 15,
      result: { page_id: "page-a", url: "https://example.test/forward" },
    });

    expect(page.reloadCalls).toStrictEqual([
      { waitUntil: "load", timeout: 5_000, ignoreCache: true },
    ]);
    expect(page.goBackCalls).toStrictEqual([{ waitUntil: "domcontentloaded" }]);
    expect(page.goForwardCalls).toStrictEqual([{ timeout: 2_500 }]);
  });

  it("routes page coordinate interactions and adapts their results", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "https://example.test/current");
    const handle = await createConfiguredHandler(new FakeBrowserSession([page]));

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 16,
        method: "page.click",
        params: {
          page_id: "page-a",
          x: 10,
          y: 20,
          options: { button: "right", click_count: 2, return_xpath: true },
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 16,
      result: { xpath: "/html/body/button" },
    });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 17,
        method: "page.hover",
        params: { page_id: "page-a", x: 30, y: 40, options: { return_xpath: true } },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 17,
      result: { xpath: "/html/body/a" },
    });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 18,
        method: "page.scroll",
        params: {
          page_id: "page-a",
          x: 50,
          y: 60,
          delta_x: -25,
          delta_y: 400,
          options: { return_xpath: true },
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 18,
      result: { xpath: "/html/body/main" },
    });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 19,
        method: "page.drag_and_drop",
        params: {
          page_id: "page-a",
          from_x: 1,
          from_y: 2,
          to_x: 3,
          to_y: 4,
          options: { button: "left", steps: 5, delay: 10, return_xpath: true },
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 19,
      result: {
        from_xpath: "/html/body/div[1]",
        to_xpath: "/html/body/div[2]",
      },
    });

    expect(page.clickCalls).toStrictEqual([
      { x: 10, y: 20, options: { button: "right", clickCount: 2, returnXpath: true } },
    ]);
    expect(page.hoverCalls).toStrictEqual([{ x: 30, y: 40, options: { returnXpath: true } }]);
    expect(page.scrollCalls).toStrictEqual([
      { x: 50, y: 60, deltaX: -25, deltaY: 400, options: { returnXpath: true } },
    ]);
    expect(page.dragAndDropCalls).toStrictEqual([
      {
        fromX: 1,
        fromY: 2,
        toX: 3,
        toY: 4,
        options: { button: "left", steps: 5, delay: 10, returnXpath: true },
      },
    ]);
  });

  it("routes page keyboard interactions", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "https://example.test/current");
    const handle = await createConfiguredHandler(new FakeBrowserSession([page]));

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 20,
        method: "page.type",
        params: {
          page_id: "page-a",
          text: "hello",
          options: { delay: 25, with_mistakes: true },
        },
      }),
    ).resolves.toStrictEqual({ jsonrpc: "2.0", id: 20, result: { ok: true } });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 21,
        method: "page.key_press",
        params: { page_id: "page-a", key: "Control+A", options: { delay: 10 } },
      }),
    ).resolves.toStrictEqual({ jsonrpc: "2.0", id: 21, result: { ok: true } });

    expect(page.pageTypeCalls).toStrictEqual([
      { text: "hello", options: { delay: 25, withMistakes: true } },
    ]);
    expect(page.keyPressCalls).toStrictEqual([{ key: "Control+A", options: { delay: 10 } }]);
  });

  it("routes page evaluation and init scripts with JSON-safe results", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "https://example.test/current");
    page.evaluationResult = { camelCase: true, nestedValue: { staysCamelCase: true } };
    const handle = await createConfiguredHandler(new FakeBrowserSession([page]));

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 22,
        method: "page.evaluate",
        params: { page_id: "page-a", expression: "({ camelCase: true })" },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 22,
      result: { value: { camelCase: true, nestedValue: { staysCamelCase: true } } },
    });

    page.evaluationResult = undefined;
    await expect(
      handle({
        jsonrpc: "2.0",
        id: 23,
        method: "page.evaluate",
        params: { page_id: "page-a", expression: "undefined" },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 23,
      result: { value: null },
    });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 24,
        method: "page.add_init_script",
        params: { page_id: "page-a", source: "globalThis.ready = true" },
      }),
    ).resolves.toStrictEqual({ jsonrpc: "2.0", id: 24, result: { ok: true } });

    expect(page.evaluateCalls).toStrictEqual(["({ camelCase: true })", "undefined"]);
    expect(page.addInitScriptCalls).toStrictEqual(["globalThis.ready = true"]);
  });

  it("routes page headers and viewport configuration", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "https://example.test/current");
    const handle = await createConfiguredHandler(new FakeBrowserSession([page]));

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 25,
        method: "page.set_extra_http_headers",
        params: {
          page_id: "page-a",
          headers: { "X-Request-ID": "request-1", doNotRenameMe: "value" },
        },
      }),
    ).resolves.toStrictEqual({ jsonrpc: "2.0", id: 25, result: { ok: true } });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 26,
        method: "page.set_viewport_size",
        params: {
          page_id: "page-a",
          width: 1280,
          height: 720,
          options: { device_scale_factor: 2 },
        },
      }),
    ).resolves.toStrictEqual({ jsonrpc: "2.0", id: 26, result: { ok: true } });

    expect(page.setExtraHTTPHeadersCalls).toStrictEqual([
      { "X-Request-ID": "request-1", doNotRenameMe: "value" },
    ]);
    expect(page.setViewportSizeCalls).toStrictEqual([
      { width: 1280, height: 720, options: { deviceScaleFactor: 2 } },
    ]);
  });

  it("routes page wait methods and adapts selector results", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "https://example.test/current");
    page.waitForSelectorResult = false;
    const handle = await createConfiguredHandler(new FakeBrowserSession([page]));

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 27,
        method: "page.wait_for_load_state",
        params: { page_id: "page-a", state: "networkidle", timeout: 0 },
      }),
    ).resolves.toStrictEqual({ jsonrpc: "2.0", id: 27, result: { ok: true } });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 28,
        method: "page.wait_for_timeout",
        params: { page_id: "page-a", ms: 250 },
      }),
    ).resolves.toStrictEqual({ jsonrpc: "2.0", id: 28, result: { ok: true } });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 29,
        method: "page.wait_for_selector",
        params: {
          page_id: "page-a",
          selector: "button.submit",
          options: { state: "visible", timeout: 1_000, pierce_shadow: false },
        },
      }),
    ).resolves.toStrictEqual({ jsonrpc: "2.0", id: 29, result: { matched: false } });

    expect(page.waitForLoadStateCalls).toStrictEqual([{ state: "networkidle", timeout: 0 }]);
    expect(page.waitForTimeoutCalls).toStrictEqual([250]);
    expect(page.waitForSelectorCalls).toStrictEqual([
      {
        selector: "button.submit",
        options: { state: "visible", timeout: 1_000, pierceShadow: false },
      },
    ]);
  });

  it("routes page screenshots and snapshots", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "https://example.test/current");
    const handle = await createConfiguredHandler(new FakeBrowserSession([page]));

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 30,
        method: "page.screenshot",
        params: {
          page_id: "page-a",
          options: {
            full_page: true,
            mask: [{ page_id: "page-a", selector: "[data-secret]" }],
            mask_color: "#000000",
          },
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 30,
      result: { data: "iVBORw0KGgo=", type: "png" },
    });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 31,
        method: "page.snapshot",
        params: { page_id: "page-a", options: { include_iframes: true } },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 31,
      result: {
        formatted_tree: "root",
        xpath_map: { frameOne: "/html/body" },
        url_map: { frameOne: "https://example.test" },
      },
    });

    expect(page.screenshotCalls).toStrictEqual([
      {
        fullPage: true,
        mask: [page.locatorRefs[0]],
        maskColor: "#000000",
      },
    ]);
    expect(page.snapshotCalls).toStrictEqual([{ includeIframes: true }]);
  });

  it("rejects screenshot masks from another page", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "https://example.test/current");
    const otherPage = new FakeUnderstudyRuntimePage("page-b", "https://example.test/other");
    const runtime = await createConfiguredRuntime(new FakeBrowserSession([page, otherPage]));

    await expect(
      runtime.pageScreenshot({
        pageId: "page-a",
        options: { mask: [{ pageId: "page-b", selector: "[data-secret]" }] },
      }),
    ).rejects.toThrow("mask locators must belong to the target page");
    expect(page.screenshotCalls).toStrictEqual([]);
  });

  it("returns page.url from the resolved understudy page", async () => {
    const handle = await createConfiguredHandler(
      new FakeBrowserSession([
        new FakeUnderstudyRuntimePage("page-a", "https://example.test/current"),
      ]),
    );

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 10,
        method: "page.url",
        params: {
          pageId: "page-a",
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 10,
      result: {
        url: "https://example.test/current",
      },
    });
  });

  it("returns page.title from the resolved understudy page", async () => {
    const handle = await createConfiguredHandler(
      new FakeBrowserSession([
        new FakeUnderstudyRuntimePage("page-a", "https://example.test/current", "Current Title"),
      ]),
    );

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 11,
        method: "page.title",
        params: {
          pageId: "page-a",
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 11,
      result: {
        title: "Current Title",
      },
    });
  });

  it("closes the resolved understudy page", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "https://example.test/current");
    const handle = await createConfiguredHandler(new FakeBrowserSession([page]));

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 12,
        method: "page.close",
        params: {
          pageId: "page-a",
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 12,
      result: {
        closed: true,
      },
    });

    expect(page.closed).toBe(true);
  });

  it("returns a clear error when a page id cannot be resolved", async () => {
    const handle = await createConfiguredHandler(new FakeBrowserSession());

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 10,
        method: "page.url",
        params: {
          pageId: "missing-page",
        },
      }),
    ).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 10,
      error: {
        code: -32603,
        message: 'Stagehand page "missing-page" was not found; call context.pages and retry',
        data: { name: "Error" },
      },
    });
  });

  it("returns a clear error for page commands before runtime is configured", async () => {
    const handle = createHandle();

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 10,
        method: "page.url",
        params: {
          pageId: "page-a",
        },
      }),
    ).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 10,
      error: {
        code: -32603,
        message: "Stagehand loopback CDP is not configured",
        data: { name: "Error" },
      },
    });
  });

  it("resolves locator.click through an understudy deep locator", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "about:blank");
    const runtime = await createConfiguredRuntime(new FakeBrowserSession([page]));

    await expect(
      runtime.locatorClick({
        pageId: "page-a",
        selector: "button.submit",
        options: {
          button: "left",
          clickCount: 2,
        },
      }),
    ).resolves.toStrictEqual({
      clicked: true,
    });

    expect(page.locatorRefs).toHaveLength(1);
    expect(page.locatorRefs[0]?.selector).toBe("button.submit");
    expect(page.locatorRefs[0]?.clickCalls).toStrictEqual([
      {
        button: "left",
        clickCount: 2,
      },
    ]);
  });

  it("resolves locator.fill through an understudy deep locator", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "about:blank");
    const runtime = await createConfiguredRuntime(new FakeBrowserSession([page]));

    await expect(
      runtime.locatorFill({
        pageId: "page-a",
        selector: "input[name=email]",
        value: "user@example.com",
      }),
    ).resolves.toStrictEqual({
      filled: true,
    });

    expect(page.locatorRefs).toHaveLength(1);
    expect(page.locatorRefs[0]?.selector).toBe("input[name=email]");
    expect(page.locatorRefs[0]?.fillCalls).toStrictEqual(["user@example.com"]);
  });

  it("resolves locator.is_visible through an understudy deep locator", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "about:blank");
    page.locatorsBySelector.set(
      "section.visible",
      new FakeUnderstudyRuntimeLocator("section.visible", true),
    );
    const runtime = await createConfiguredRuntime(new FakeBrowserSession([page]));

    await expect(
      runtime.locatorIsVisible({
        pageId: "page-a",
        selector: "section.visible",
      }),
    ).resolves.toStrictEqual({
      visible: true,
    });

    expect(page.locatorRefs).toHaveLength(1);
    expect(page.locatorRefs[0]?.selector).toBe("section.visible");
  });

  it("resolves locator.text_content through an understudy deep locator", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "about:blank");
    page.locatorsBySelector.set(
      "p.message",
      new FakeUnderstudyRuntimeLocator("p.message", true, "hello from locator"),
    );
    const runtime = await createConfiguredRuntime(new FakeBrowserSession([page]));

    await expect(
      runtime.locatorTextContent({
        pageId: "page-a",
        selector: "p.message",
      }),
    ).resolves.toStrictEqual({
      textContent: "hello from locator",
    });

    expect(page.locatorRefs).toHaveLength(1);
    expect(page.locatorRefs[0]?.selector).toBe("p.message");
  });

  it("resolves locator.nth through the understudy deep locator", async () => {
    const locator = new FakeUnderstudyRuntimeLocator("li.item", true, "", { count: 1 });
    const page = new FakeUnderstudyRuntimePage("page-a", "about:blank");
    page.locatorsBySelector.set("li.item", locator);
    const runtime = await createConfiguredRuntime(new FakeBrowserSession([page]));

    await expect(
      runtime.locatorCount({
        pageId: "page-a",
        selector: "li.item",
        nth: 2,
      }),
    ).resolves.toStrictEqual({
      count: 1,
    });

    expect(locator.nthCalls).toStrictEqual([2]);
  });

  it("resolves read locator methods through an understudy deep locator", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "about:blank");
    page.locatorsBySelector.set(
      "input.email",
      new FakeUnderstudyRuntimeLocator("input.email", true, "hello text", {
        checked: true,
        inputValue: "user@example.com",
        innerText: "visible text",
        innerHtml: "<span>visible text</span>",
        count: 3,
        centroid: { x: 12, y: 34 },
      }),
    );
    const runtime = await createConfiguredRuntime(new FakeBrowserSession([page]));
    const descriptor = {
      pageId: "page-a",
      selector: "input.email",
    };

    await expect(runtime.locatorCount(descriptor)).resolves.toStrictEqual({ count: 3 });
    await expect(runtime.locatorIsChecked(descriptor)).resolves.toStrictEqual({ checked: true });
    await expect(runtime.locatorInputValue(descriptor)).resolves.toStrictEqual({
      value: "user@example.com",
    });
    await expect(runtime.locatorInnerText(descriptor)).resolves.toStrictEqual({
      text: "visible text",
    });
    await expect(runtime.locatorInnerHtml(descriptor)).resolves.toStrictEqual({
      html: "<span>visible text</span>",
    });
    await expect(runtime.locatorCentroid(descriptor)).resolves.toStrictEqual({ x: 12, y: 34 });
  });

  it("resolves write locator methods through an understudy deep locator", async () => {
    const locator = new FakeUnderstudyRuntimeLocator("input.email", true, "", {
      selectedValues: ["b"],
    });
    const page = new FakeUnderstudyRuntimePage("page-a", "about:blank");
    page.locatorsBySelector.set("input.email", locator);
    const runtime = await createConfiguredRuntime(new FakeBrowserSession([page]));
    const descriptor = {
      pageId: "page-a",
      selector: "input.email",
    };

    await expect(runtime.locatorHover(descriptor)).resolves.toStrictEqual({ hovered: true });
    await expect(runtime.locatorScrollTo({ ...descriptor, percent: 50 })).resolves.toStrictEqual({
      scrolled: true,
    });
    await expect(
      runtime.locatorHighlight({
        ...descriptor,
        options: { durationMs: 0, borderColor: { r: 1, g: 2, b: 3 } },
      }),
    ).resolves.toStrictEqual({ highlighted: true });
    await expect(
      runtime.locatorSendClickEvent({ ...descriptor, options: { detail: 2 } }),
    ).resolves.toStrictEqual({ clicked: true });
    await expect(
      runtime.locatorType({ ...descriptor, text: "hello", options: { delay: 1 } }),
    ).resolves.toStrictEqual({ typed: true });
    await expect(
      runtime.locatorSelectOption({ ...descriptor, values: ["a", "b"] }),
    ).resolves.toStrictEqual({ values: ["b"] });

    expect(locator.scrollToCalls).toStrictEqual([50]);
    expect(locator.highlightCalls).toStrictEqual([
      { durationMs: 0, borderColor: { r: 1, g: 2, b: 3 } },
    ]);
    expect(locator.sendClickEventCalls).toStrictEqual([{ detail: 2 }]);
    expect(locator.typeCalls).toStrictEqual([{ text: "hello", options: { delay: 1 } }]);
    expect(locator.selectOptionCalls).toStrictEqual([["a", "b"]]);
  });

  it("returns a clear error when locator page id cannot be resolved", async () => {
    const runtime = await createConfiguredRuntime(new FakeBrowserSession());

    await expect(
      runtime.locatorClick({
        pageId: "missing-page",
        selector: "button",
      }),
    ).rejects.toThrow('Stagehand page "missing-page" was not found; call context.pages and retry');
  });

  it("returns a clear error for locator commands before runtime is configured", async () => {
    const runtime = createStagehandRuntime();

    await expect(
      runtime.locatorIsVisible({
        pageId: "page-a",
        selector: "button",
      }),
    ).rejects.toThrow("Stagehand loopback CDP is not configured");
  });

  it("routes locator.click through the RPC app", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "about:blank");
    const handle = await createConfiguredHandler(new FakeBrowserSession([page]));

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 13,
        method: "locator.click",
        params: {
          page_id: "page-a",
          selector: "button.submit",
          options: {
            button: "left",
            click_count: 2,
          },
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 13,
      result: {
        clicked: true,
      },
    });

    expect(page.locatorRefs).toHaveLength(1);
    expect(page.locatorRefs[0]?.selector).toBe("button.submit");
    expect(page.locatorRefs[0]?.clickCalls).toStrictEqual([
      {
        button: "left",
        clickCount: 2,
      },
    ]);
  });

  it("routes locator.fill through the RPC app", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "about:blank");
    const handle = await createConfiguredHandler(new FakeBrowserSession([page]));

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 14,
        method: "locator.fill",
        params: {
          page_id: "page-a",
          selector: "input[name=email]",
          value: "user@example.com",
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 14,
      result: {
        filled: true,
      },
    });

    expect(page.locatorRefs).toHaveLength(1);
    expect(page.locatorRefs[0]?.selector).toBe("input[name=email]");
    expect(page.locatorRefs[0]?.fillCalls).toStrictEqual(["user@example.com"]);
  });

  it("routes locator.is_visible through the RPC app", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "about:blank");
    page.locatorsBySelector.set(
      "section.visible",
      new FakeUnderstudyRuntimeLocator("section.visible", true),
    );
    const handle = await createConfiguredHandler(new FakeBrowserSession([page]));

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 15,
        method: "locator.is_visible",
        params: {
          page_id: "page-a",
          selector: "section.visible",
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 15,
      result: {
        visible: true,
      },
    });
  });

  it("routes locator.text_content through the RPC app", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "about:blank");
    page.locatorsBySelector.set(
      "p.message",
      new FakeUnderstudyRuntimeLocator("p.message", true, "hello from locator"),
    );
    const handle = await createConfiguredHandler(new FakeBrowserSession([page]));

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 16,
        method: "locator.text_content",
        params: {
          page_id: "page-a",
          selector: "p.message",
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 16,
      result: {
        text_content: "hello from locator",
      },
    });
  });

  it("routes new locator methods through the RPC app", async () => {
    const locator = new FakeUnderstudyRuntimeLocator("select.plan", true, "starter", {
      count: 2,
      selectedValues: ["pro"],
    });
    const page = new FakeUnderstudyRuntimePage("page-a", "about:blank");
    page.locatorsBySelector.set("select.plan", locator);
    const handle = await createConfiguredHandler(new FakeBrowserSession([page]));

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 17,
        method: "locator.count",
        params: {
          page_id: "page-a",
          selector: "select.plan",
          nth: 0,
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 17,
      result: {
        count: 2,
      },
    });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 18,
        method: "locator.select_option",
        params: {
          page_id: "page-a",
          selector: "select.plan",
          values: "pro",
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 18,
      result: {
        values: ["pro"],
      },
    });

    expect(locator.nthCalls).toStrictEqual([0]);
    expect(locator.selectOptionCalls).toStrictEqual(["pro"]);
  });

  it("returns page resolution errors for locator RPC commands", async () => {
    const handle = await createConfiguredHandler(new FakeBrowserSession());

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 17,
        method: "locator.click",
        params: {
          page_id: "missing-page",
          selector: "button",
        },
      }),
    ).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 17,
      error: {
        code: -32603,
        message: 'Stagehand page "missing-page" was not found; call context.pages and retry',
        data: { name: "Error" },
      },
    });
  });

  it("returns configure errors for locator RPC commands before runtime is configured", async () => {
    const handle = createHandle();

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 18,
        method: "locator.is_visible",
        params: {
          page_id: "page-a",
          selector: "button",
        },
      }),
    ).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 18,
      error: {
        code: -32603,
        message: "Stagehand loopback CDP is not configured",
        data: { name: "Error" },
      },
    });
  });

  it("returns a clear error before loopback is configured", async () => {
    const handle = createHandle();

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 6,
        method: "browser.get_version",
        params: {},
      }),
    ).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 6,
      error: {
        code: -32603,
        message: "Stagehand loopback CDP is not configured",
        data: { name: "Error" },
      },
    });
  });

  it("returns invalid params for known methods with bad params", async () => {
    await expect(
      createHandle()({
        jsonrpc: "2.0",
        id: 2,
        method: "ping",
        params: { extra: true },
      }),
    ).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      error: {
        code: -32602,
        data: { name: "ZodError", issues: expect.any(Array) },
      },
    });
  });

  it("returns method not found for unknown commands", async () => {
    await expect(
      createHandle()({
        jsonrpc: "2.0",
        id: 3,
        method: "browser.raw_cdp",
        params: {},
      }),
    ).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      error: {
        code: -32601,
        data: { type: "stagehand.unknown_command" },
      },
    });
  });
});
