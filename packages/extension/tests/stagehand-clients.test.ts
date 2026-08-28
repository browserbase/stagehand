import { trace } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";
import { JSONRPCRequestSchema, JSONRPCResponseSchema } from "../../protocol/json-rpc/schemas.ts";
import type { JSONRPCResponse } from "../../protocol/json-rpc/types.ts";
import { STAGEHAND_PROTOCOL_VERSION } from "../../protocol/schemas.ts";
import {
  STAGEHAND_SEND_TO_HOST_BINDING,
  StagehandRpcNotificationSchema,
  StagehandSendToHostBindingSchema,
} from "../../protocol/schema-registry.ts";
import { startStagehandServiceWorker } from "../service-worker.ts";
import { STAGEHAND_RUNTIME_VERSION } from "../version.ts";
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
import { DuplicatePageEventSubscriptionError } from "../errors.ts";
import type { StagehandTracing } from "../tracing.ts";
import type {
  ContextSetExtraHTTPHeadersParams,
  Cookie,
  CookieParam,
  DomainPolicy,
  LoadState,
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
  PageCDPEvent,
  PageCDPEventNotification,
  PageDragAndDropParams,
  PageEvaluateParams,
  PageKeyPressParams,
  PageNavigationOptions,
  PageReloadParams,
  PageSnapshotOptions,
  PageSetExtraHTTPHeadersParams,
  PageSetViewportSizeParams,
  PageTypeParams,
  PageWaitForSelectorParams,
  PageWaitForTimeoutParams,
  SnapshotResult,
  WebMCPInvocationDescriptor,
  WebMCPInvokeOptions,
  WebMCPResultOptions,
  WebMCPToolDescriptor,
  WebMCPToolResponse,
  WebMCPToolsOptions,
} from "../../protocol/types.ts";

vi.mock("../understudy/context.js", () => ({
  BrowserContext: {
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
  prepareForInitializationCalls = 0;
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

  constructor(pages: FakeUnderstudyRuntimePage[] = []) {
    this.pageRefs = pages;
    this.activePageRef = pages.at(-1);
  }

  async prepareForInitialization(): Promise<void> {
    this.prepareForInitializationCalls += 1;
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

  async activePage(): Promise<UnderstudyRuntimePage | undefined> {
    return this.activePageRef;
  }

  async setActivePage(page: UnderstudyRuntimePage): Promise<void> {
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
  readonly goBackCalls: Array<PageNavigationOptions | undefined> = [];
  readonly goForwardCalls: Array<PageNavigationOptions | undefined> = [];
  readonly clickCalls: Array<{ x: number; y: number; options?: PageClickParams["options"] }> = [];
  readonly hoverCalls: Array<{ x: number; y: number }> = [];
  readonly scrollCalls: Array<{
    x: number;
    y: number;
    deltaX: number;
    deltaY: number;
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
    state: LoadState;
    timeout?: number;
  }> = [];
  readonly waitForTimeoutCalls: Array<PageWaitForTimeoutParams["ms"]> = [];
  readonly waitForSelectorCalls: Array<{
    selector: string;
    options?: PageWaitForSelectorParams["options"];
  }> = [];
  readonly screenshotCalls: Array<UnderstudyRuntimeScreenshotOptions | undefined> = [];
  readonly snapshotCalls: Array<PageSnapshotOptions | undefined> = [];
  readonly listWebMCPToolsCalls: Array<Partial<WebMCPToolsOptions> | undefined> = [];
  readonly invokeWebMCPToolCalls: Array<{
    frameId: string;
    toolName: string;
    options?: Partial<WebMCPInvokeOptions>;
  }> = [];
  readonly waitForWebMCPInvocationResultCalls: Array<{
    invocationId: string;
    options?: WebMCPResultOptions;
  }> = [];
  readonly cancelWebMCPInvocationCalls: string[] = [];
  readonly webMCPInvocations = new Set<string>();
  readonly locatorRefs: FakeUnderstudyRuntimeLocator[] = [];
  readonly locatorsBySelector = new Map<string, FakeUnderstudyRuntimeLocator>();
  readonly cdpEventListeners = new Map<
    PageCDPEvent["method"],
    Set<(event: PageCDPEvent) => void>
  >();
  closed = false;
  currentUrl: string;
  backUrl?: string;
  forwardUrl?: string;
  evaluationResult: unknown = null;
  waitForSelectorResult = true;
  screenshotBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  snapshotResult: SnapshotResult = {
    formattedTree: "root",
    xpathMap: { frameOne: "/html/body" },
    urlMap: { frameOne: "https://example.test" },
  };
  webMCPTools: WebMCPToolDescriptor[] = [
    {
      name: "search",
      description: "Search this site",
      inputSchema: {
        type: "object",
        properties: { searchQuery: { type: "string" } },
      },
      frameId: "frame-1",
    },
  ];
  webMCPToolResponse: WebMCPToolResponse = {
    invocationId: "page-a-invocation-1",
    status: "Completed",
    output: { resultValue: "done" },
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

  async goBack(options?: PageNavigationOptions): Promise<void> {
    this.goBackCalls.push(options);
    if (this.backUrl) this.currentUrl = this.backUrl;
  }

  async goForward(options?: PageNavigationOptions): Promise<void> {
    this.goForwardCalls.push(options);
    if (this.forwardUrl) this.currentUrl = this.forwardUrl;
  }

  async click(x: number, y: number, options?: PageClickParams["options"]): Promise<void> {
    this.clickCalls.push({ x, y, options });
  }

  async hover(x: number, y: number): Promise<void> {
    this.hoverCalls.push({ x, y });
  }

  async scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    this.scrollCalls.push({ x, y, deltaX, deltaY });
  }

  async dragAndDrop(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    options?: PageDragAndDropParams["options"],
  ): Promise<void> {
    this.dragAndDropCalls.push({ fromX, fromY, toX, toY, options });
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

  async waitForLoadState(state: LoadState, timeout?: number): Promise<void> {
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

  async listWebMCPTools(options?: Partial<WebMCPToolsOptions>): Promise<WebMCPToolDescriptor[]> {
    this.listWebMCPToolsCalls.push(options);
    return this.webMCPTools;
  }

  async invokeWebMCPTool(
    frameId: string,
    toolName: string,
    options?: Partial<WebMCPInvokeOptions>,
  ): Promise<WebMCPInvocationDescriptor> {
    this.invokeWebMCPToolCalls.push({ frameId, toolName, options });
    const invocationId = `${this.id}-invocation-${this.webMCPInvocations.size + 1}`;
    this.webMCPInvocations.add(invocationId);
    return {
      invocationId,
      toolName,
      frameId,
      input: options?.input ?? {},
    };
  }

  async waitForWebMCPInvocationResult(
    invocationId: string,
    options?: WebMCPResultOptions,
  ): Promise<WebMCPToolResponse> {
    this.waitForWebMCPInvocationResultCalls.push({ invocationId, options });
    if (!this.webMCPInvocations.has(invocationId)) {
      throw new Error(`WebMCP invocation "${invocationId}" was not found on page "${this.id}".`);
    }
    return { ...this.webMCPToolResponse, invocationId };
  }

  async cancelWebMCPInvocation(invocationId: string): Promise<void> {
    this.cancelWebMCPInvocationCalls.push(invocationId);
    if (!this.webMCPInvocations.has(invocationId)) {
      throw new Error(`WebMCP invocation "${invocationId}" was not found on page "${this.id}".`);
    }
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

  subscribeCDPEvent(listener: (event: PageCDPEvent) => void): () => void {
    const method = "Runtime.consoleAPICalled";
    const listeners = this.cdpEventListeners.get(method) ?? new Set();
    listeners.add(listener);
    this.cdpEventListeners.set(method, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.cdpEventListeners.delete(method);
    };
  }

  emitCDPEvent(event: PageCDPEvent): void {
    for (const listener of this.cdpEventListeners.get(event.method) ?? []) listener(event);
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
  readonly setInputFilesCalls: Array<Parameters<UnderstudyRuntimeLocator["setInputFiles"]>[0]> = [];
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
      selectedValues?: LocatorSelectOptionResult;
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

  async setInputFiles(
    files: Parameters<UnderstudyRuntimeLocator["setInputFiles"]>[0],
  ): Promise<void> {
    this.setInputFilesCalls.push(files);
  }

  nth(index: number): UnderstudyRuntimeLocator {
    this.nthCalls.push(index);
    return this;
  }
}

const testTracing: StagehandTracing = {
  tracer: trace.getTracer("stagehand-app-test"),
  configure: async () => {},
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
    __stagehandReceiveFromHost?: (
      raw: unknown,
      runtimeAttachments?: { callback?: unknown },
    ) => Promise<void>;
  } = {
    [STAGEHAND_SEND_TO_HOST_BINDING]: (payload) => {
      const response = JSONRPCResponseSchema.safeParse(JSON.parse(payload));
      if (!response.success) return;
      resolveResponse?.(response.data);
      resolveResponse = undefined;
    },
  };
  startStagehandServiceWorker(scope, runtime);

  return async (
    input: unknown,
    runtimeAttachments?: { callback?: unknown },
  ): Promise<JSONRPCResponse> => {
    const request = JSONRPCRequestSchema.parse(input);
    const response = new Promise<JSONRPCResponse>((resolve) => {
      resolveResponse = resolve;
    });
    const received = scope.__stagehandReceiveFromHost?.(
      JSON.stringify(request),
      runtimeAttachments,
    );
    const [result] = await Promise.all([response, received]);
    return result;
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
    method: "stagehand.init",
    params: configuredInitParams("ws://127.0.0.1:9222/devtools/browser/session"),
  });

  return handle;
}

async function createConfiguredRuntime(session: FakeBrowserSession) {
  const runtime = createStagehandRuntime({
    browserSessionFactory: async () => session,
  });

  await runtime.replaceBrowserConnection({
    cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
  });

  return runtime;
}

function configuredInitParams(cdpUrl: string) {
  return {
    protocol_version: STAGEHAND_PROTOCOL_VERSION,
    client_info: { name: "stagehand-sdk-test", version: "1.0.0" },
    browser_cdp_url: cdpUrl,
  };
}

describe("Stagehand worker clients", () => {
  it("routes callback batches through the registered JSON-RPC method", async () => {
    const page = new FakeUnderstudyRuntimePage("page-1", "https://example.com", "Example");
    const handle = await createConfiguredHandler(new FakeBrowserSession([page]));
    const callback = async (stagehand: { page: { title(): Promise<string> } }, input: unknown) => ({
      title: await stagehand.page.title(),
      input,
    });

    await expect(
      handle(
        {
          jsonrpc: "2.0",
          id: 8,
          method: "stagehand.callback_batch",
          params: {
            callback_source: Function.prototype.toString.call(callback),
            input: { id: 7 },
            options: { timeout: 2_000 },
          },
        },
        { callback },
      ),
    ).resolves.toEqual({
      jsonrpc: "2.0",
      id: 8,
      result: { value: { title: "Example", input: { id: 7 } } },
    });
  });

  it("returns callback failures through the standard JSON-RPC error path", async () => {
    const page = new FakeUnderstudyRuntimePage("page-1", "https://example.com", "Example");
    const handle = await createConfiguredHandler(new FakeBrowserSession([page]));
    const callback = async () => {
      throw new TypeError("callback failed");
    };

    await expect(
      handle(
        {
          jsonrpc: "2.0",
          id: 9,
          method: "stagehand.callback_batch",
          params: {
            callback_source: Function.prototype.toString.call(callback),
            options: { timeout: 2_000 },
          },
        },
        { callback },
      ),
    ).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 9,
      error: {
        code: -32603,
        message: "callback failed",
        data: { name: "TypeError" },
      },
    });
  });

  it("canonicalizes the console alias and stops page notifications after page.off", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "about:blank");
    const session = new FakeBrowserSession([page]);
    const notifications: PageCDPEventNotification[] = [];
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () => session,
      emitPageCDPEvent: (notification) => notifications.push(notification),
    });
    await runtime.replaceBrowserConnection({
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
    });
    await runtime.contextPages();

    runtime.pageOn({ pageId: "page-a", subscriptionId: "subscription-1", event: "console" });
    page.emitCDPEvent({
      pageId: "page-a",
      method: "Runtime.consoleAPICalled",
      params: { type: "log", executionContextId: 1 },
      sessionId: "session-1",
      targetId: "target-1",
    });

    expect(notifications).toStrictEqual([
      {
        subscriptionId: "subscription-1",
        event: {
          pageId: "page-a",
          method: "Runtime.consoleAPICalled",
          params: { type: "log", executionContextId: 1 },
          sessionId: "session-1",
          targetId: "target-1",
        },
      },
    ]);
    expect(page.cdpEventListeners.has("Runtime.consoleAPICalled")).toBe(true);

    runtime.pageOff({ subscriptionId: "subscription-1" });
    page.emitCDPEvent({
      pageId: "page-a",
      method: "Runtime.consoleAPICalled",
      params: { type: "log" },
      sessionId: "session-1",
      targetId: "target-1",
    });
    expect(notifications).toHaveLength(1);
    expect(page.cdpEventListeners.has("Runtime.consoleAPICalled")).toBe(false);
  });

  it("rejects duplicate page event subscriptions without reflecting their identifier", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "about:blank");
    const runtime = await createConfiguredRuntime(new FakeBrowserSession([page]));
    const subscriptionId = 'caller-controlled-<script>alert("x")</script>';

    runtime.pageOn({ pageId: "page-a", subscriptionId, event: "console" });

    expect(() => runtime.pageOn({ pageId: "page-a", subscriptionId, event: "console" })).toThrow(
      DuplicatePageEventSubscriptionError,
    );
    expect(() => runtime.pageOn({ pageId: "page-a", subscriptionId, event: "console" })).toThrow(
      "A page event subscription with this identifier already exists",
    );
    try {
      runtime.pageOn({ pageId: "page-a", subscriptionId, event: "console" });
    } catch (error) {
      expect((error as Error).message).not.toContain(subscriptionId);
    }
  });

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
        protocolVersion: STAGEHAND_PROTOCOL_VERSION,
        serverInfo: {
          name: "stagehand",
          version: STAGEHAND_RUNTIME_VERSION,
        },
      },
      __stagehandReceiveFromHost: expect.any(Function),
    });
  });

  it("returns responses without streaming debug logs at the default info level", async () => {
    const messages: unknown[] = [];
    const scope: {
      [STAGEHAND_SEND_TO_HOST_BINDING](payload: string): void;
      __stagehandReceiveFromHost?: (raw: unknown) => Promise<void>;
    } = {
      [STAGEHAND_SEND_TO_HOST_BINDING]: (payload) => messages.push(JSON.parse(payload)),
    };
    startStagehandServiceWorker(
      scope,
      createStagehandRuntime({
        browserSessionFactory: async () => new FakeBrowserSession(),
      }),
    );

    await scope.__stagehandReceiveFromHost?.(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "stagehand.init",
        params: configuredInitParams("ws://127.0.0.1:9222/devtools/browser/session"),
      }),
    );

    expect(
      messages.find((message) => JSONRPCResponseSchema.safeParse(message).success),
    ).toStrictEqual({
      jsonrpc: "2.0",
      id: 7,
      result: {
        initialized: true,
        pages: [],
      },
    });
    expect(
      messages.find((message) => StagehandRpcNotificationSchema.safeParse(message).success),
    ).toBeUndefined();
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

    await scope.__stagehandReceiveFromHost?.(
      JSON.stringify({ method: "stagehand.close", params: {} }),
    );

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

  it("configures the browser session during stagehand.init", async () => {
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
        method: "stagehand.init",
        params: configuredInitParams("ws://127.0.0.1:9222/devtools/browser/session"),
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        initialized: true,
        pages: [],
      },
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.prepareForInitializationCalls).toBe(1);
  });

  it("rejects a second stagehand.init while the first instance is initialized", async () => {
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
      method: "stagehand.init",
      params: configuredInitParams("ws://127.0.0.1:9222/devtools/browser/first"),
    });
    await expect(
      handle({
        jsonrpc: "2.0",
        id: 2,
        method: "stagehand.init",
        params: configuredInitParams("ws://127.0.0.1:9222/devtools/browser/second"),
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 2,
      error: {
        code: -32603,
        message: "A Stagehand instance is already initialized",
        data: { name: "Error" },
      },
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.closed).toBe(false);
    expect(sessions[0]?.prepareForInitializationCalls).toBe(1);
  });

  it("keeps the active browser session and reuses it after stagehand.close", async () => {
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
      method: "stagehand.init",
      params: configuredInitParams("ws://127.0.0.1:9222/devtools/browser/session"),
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

    expect(sessions[0]?.closed).toBe(false);

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 6,
        method: "stagehand.init",
        params: configuredInitParams("ws://127.0.0.1:9222/devtools/browser/session"),
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 6,
      result: {
        initialized: true,
        pages: [],
      },
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.prepareForInitializationCalls).toBe(2);
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
      method: "stagehand.init",
      params: configuredInitParams("ws://127.0.0.1:9222/devtools/browser/session"),
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
      method: "stagehand.init",
      params: configuredInitParams("ws://127.0.0.1:9222/devtools/browser/session"),
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

  it("returns active-page lookup failures through the standard JSON-RPC error path", async () => {
    const context = new FakeBrowserSession();
    vi.spyOn(context, "activePage").mockRejectedValue(new Error("Chrome tabs query failed"));
    const handle = await createConfiguredHandler(context);

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 9,
        method: "context.active_page",
        params: {},
      }),
    ).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 9,
      error: {
        code: -32603,
        message: "Chrome tabs query failed",
        data: { name: "Error" },
      },
    });
  });

  it("awaits set-active-page failures and rejects unknown page ids before activation", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "https://example.test/a");
    const context = new FakeBrowserSession([page]);
    const setActivePage = vi
      .spyOn(context, "setActivePage")
      .mockRejectedValueOnce(new Error("Chrome tab activation failed"));
    const handle = await createConfiguredHandler(context);

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 10,
        method: "context.set_active_page",
        params: { page_id: "page-a" },
      }),
    ).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 10,
      error: {
        code: -32603,
        message: "Chrome tab activation failed",
        data: { name: "Error" },
      },
    });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 11,
        method: "context.set_active_page",
        params: { page_id: "missing-page" },
      }),
    ).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 11,
      error: {
        code: -32603,
        message: 'Stagehand page "missing-page" was not found; call context.pages and retry',
        data: { name: "Error" },
      },
    });
    expect(setActivePage).toHaveBeenCalledTimes(1);
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
        allowed_domains: ["example.test"],
        blocked_domains: ["blocked.example.test"],
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
      result: null,
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
      result: [
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
      result: "clipboard text",
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
        page: {
          page_id: "page-a",
          url: "https://example.test/next",
        },
        response: null,
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
      result: {
        page: { page_id: "page-a", url: "https://example.test/current" },
        response: null,
      },
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
      result: {
        page: { page_id: "page-a", url: "https://example.test/back" },
        response: null,
      },
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
      result: {
        page: { page_id: "page-a", url: "https://example.test/forward" },
        response: null,
      },
    });

    expect(page.reloadCalls).toStrictEqual([
      { waitUntil: "load", timeout: 5_000, ignoreCache: true },
    ]);
    expect(page.goBackCalls).toStrictEqual([{ waitUntil: "domcontentloaded" }]);
    expect(page.goForwardCalls).toStrictEqual([{ timeout: 2_500 }]);
  });

  it("routes page coordinate interactions", async () => {
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
          options: { button: "right", click_count: 2 },
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 16,
      result: { ok: true },
    });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 17,
        method: "page.hover",
        params: { page_id: "page-a", x: 30, y: 40 },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 17,
      result: { ok: true },
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
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 18,
      result: { ok: true },
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
          options: {
            button: "left",
            steps: 5,
            delay: 10,
            route: [
              { x: 1, y: 2 },
              { x: 2, y: 5 },
              { x: 3, y: 4 },
            ],
          },
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 19,
      result: { ok: true },
    });

    expect(page.clickCalls).toStrictEqual([
      { x: 10, y: 20, options: { button: "right", clickCount: 2 } },
    ]);
    expect(page.hoverCalls).toStrictEqual([{ x: 30, y: 40 }]);
    expect(page.scrollCalls).toStrictEqual([{ x: 50, y: 60, deltaX: -25, deltaY: 400 }]);
    expect(page.dragAndDropCalls).toStrictEqual([
      {
        fromX: 1,
        fromY: 2,
        toX: 3,
        toY: 4,
        options: {
          button: "left",
          steps: 5,
          delay: 10,
          route: [
            { x: 1, y: 2 },
            { x: 2, y: 5 },
            { x: 3, y: 4 },
          ],
        },
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
      result: { data: "iVBORw0KGgo=" },
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

  it("routes WebMCP discovery and invocation operations through the owning page", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "https://example.test/current");
    const handle = await createConfiguredHandler(new FakeBrowserSession([page]));

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 40,
        method: "page.webmcp_tools",
        params: {
          page_id: "page-a",
          options: { timeout: 250 },
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 40,
      result: {
        tools: [
          {
            name: "search",
            description: "Search this site",
            input_schema: {
              type: "object",
              properties: { searchQuery: { type: "string" } },
            },
            frame_id: "frame-1",
          },
        ],
      },
    });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 41,
        method: "page.webmcp_invoke_tool",
        params: {
          page_id: "page-a",
          frame_id: "frame-1",
          tool_name: "search",
          input: { searchQuery: "Stagehand" },
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 41,
      result: {
        invocation_id: "page-a-invocation-1",
        tool_name: "search",
        frame_id: "frame-1",
        input: { searchQuery: "Stagehand" },
      },
    });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 42,
        method: "page.webmcp_invocation_result",
        params: {
          page_id: "page-a",
          invocation_id: "page-a-invocation-1",
          options: { timeout: 5_000 },
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 42,
      result: {
        invocation_id: "page-a-invocation-1",
        status: "Completed",
        output: { resultValue: "done" },
      },
    });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 43,
        method: "page.webmcp_cancel_invocation",
        params: {
          page_id: "page-a",
          invocation_id: "page-a-invocation-1",
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 43,
      result: { ok: true },
    });

    expect(page.listWebMCPToolsCalls).toStrictEqual([{ timeout: 250 }]);
    expect(page.invokeWebMCPToolCalls).toStrictEqual([
      {
        frameId: "frame-1",
        toolName: "search",
        options: { input: { searchQuery: "Stagehand" } },
      },
    ]);
    expect(page.waitForWebMCPInvocationResultCalls).toStrictEqual([
      {
        invocationId: "page-a-invocation-1",
        options: { timeout: 5_000 },
      },
    ]);
    expect(page.cancelWebMCPInvocationCalls).toStrictEqual(["page-a-invocation-1"]);
  });

  it("rejects use of a WebMCP invocation through another page", async () => {
    const page = new FakeUnderstudyRuntimePage("page-a", "https://example.test/current");
    const otherPage = new FakeUnderstudyRuntimePage("page-b", "https://example.test/other");
    const runtime = await createConfiguredRuntime(new FakeBrowserSession([page, otherPage]));
    const invocation = await runtime.pageWebMCPInvokeTool({
      pageId: "page-a",
      frameId: "frame-1",
      toolName: "search",
      input: {},
    });

    await expect(
      runtime.pageWebMCPInvocationResult({
        pageId: "page-b",
        invocationId: invocation.invocationId,
      }),
    ).rejects.toThrow(
      `WebMCP invocation "${invocation.invocationId}" was not found on page "page-b".`,
    );
    expect(page.waitForWebMCPInvocationResultCalls).toStrictEqual([]);
    expect(otherPage.waitForWebMCPInvocationResultCalls).toStrictEqual([
      { invocationId: invocation.invocationId, options: undefined },
    ]);
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
      result: "https://example.test/current",
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
      result: "Current Title",
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
    ).resolves.toBe(true);

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
    ).resolves.toBe("hello from locator");

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
    ).resolves.toBe(1);

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

    await expect(runtime.locatorCount(descriptor)).resolves.toBe(3);
    await expect(runtime.locatorIsChecked(descriptor)).resolves.toBe(true);
    await expect(runtime.locatorInputValue(descriptor)).resolves.toBe("user@example.com");
    await expect(runtime.locatorInnerText(descriptor)).resolves.toBe("visible text");
    await expect(runtime.locatorInnerHtml(descriptor)).resolves.toBe("<span>visible text</span>");
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
    ).resolves.toStrictEqual(["b"]);
    await expect(
      runtime.locatorSetInputFiles({
        ...descriptor,
        files: [{ name: "hello.txt", data: "aGVsbG8=", mimeType: "text/plain" }],
      }),
    ).resolves.toStrictEqual({ set: true });

    expect(locator.scrollToCalls).toStrictEqual([50]);
    expect(locator.highlightCalls).toStrictEqual([
      { durationMs: 0, borderColor: { r: 1, g: 2, b: 3 } },
    ]);
    expect(locator.sendClickEventCalls).toStrictEqual([{ detail: 2 }]);
    expect(locator.typeCalls).toStrictEqual([{ text: "hello", options: { delay: 1 } }]);
    expect(locator.selectOptionCalls).toStrictEqual([["a", "b"]]);
    expect(locator.setInputFilesCalls).toHaveLength(1);
    expect(locator.setInputFilesCalls[0]).toStrictEqual([
      {
        name: "hello.txt",
        mimeType: "text/plain",
        buffer: new Uint8Array([104, 101, 108, 108, 111]),
        lastModified: undefined,
      },
    ]);
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
      result: true,
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
      result: "hello from locator",
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
      result: 2,
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
      result: ["pro"],
    });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 19,
        method: "locator.set_input_files",
        params: {
          page_id: "page-a",
          selector: "select.plan",
          nth: 1,
          files: [{ name: "hello.txt", data: "aGVsbG8=", mime_type: "text/plain" }],
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 19,
      result: { set: true },
    });

    await expect(
      handle({
        jsonrpc: "2.0",
        id: 20,
        method: "locator.set_input_files",
        params: {
          page_id: "page-a",
          selector: "select.plan",
          files: [],
        },
      }),
    ).resolves.toStrictEqual({
      jsonrpc: "2.0",
      id: 20,
      result: { set: true },
    });

    expect(locator.nthCalls).toStrictEqual([0, 1]);
    expect(locator.selectOptionCalls).toStrictEqual(["pro"]);
    expect(locator.setInputFilesCalls).toStrictEqual([
      [
        {
          name: "hello.txt",
          mimeType: "text/plain",
          buffer: new Uint8Array([104, 101, 108, 108, 111]),
          lastModified: undefined,
        },
      ],
      [],
    ]);
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

  it("returns invalid params for known methods with bad params", async () => {
    await expect(
      createHandle()({
        jsonrpc: "2.0",
        id: 2,
        method: "stagehand.metrics",
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
