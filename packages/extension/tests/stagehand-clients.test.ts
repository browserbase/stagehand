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
  UnderstudyRuntimeLocator,
  UnderstudyRuntimePage,
} from "../runtime.ts";
import { createStagehandRuntime, type StagehandRuntimeAdapters } from "../runtime.ts";
import type { StagehandTracing } from "../tracing.ts";
import type {
  LocatorCentroidResult,
  LocatorClickParams,
  LocatorHighlightParams,
  LocatorScrollToParams,
  LocatorSelectOptionResult,
  LocatorSelectOptionParams,
  LocatorSendClickEventParams,
  LocatorTypeParams,
} from "../../protocol/types.ts";

vi.mock("../understudy/context.js", () => ({
  V3Context: {
    create: vi.fn(),
  },
}));

class FakeBrowserSession implements StagehandBrowserSession {
  closed = false;
  connected = true;
  getVersionCalls = 0;
  readonly pageRefs: FakeUnderstudyRuntimePage[];

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
    return page;
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
      timeoutMs?: number;
    };
  }> = [];
  readonly locatorRefs: FakeUnderstudyRuntimeLocator[] = [];
  readonly locatorsBySelector = new Map<string, FakeUnderstudyRuntimeLocator>();
  closed = false;
  currentUrl: string;

  constructor(
    readonly id: string,
    currentUrl: string,
    readonly currentTitle = "",
  ) {
    this.currentUrl = currentUrl;
  }

  async goto(
    url: string,
    options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number },
  ): Promise<void> {
    this.gotoCalls.push({ url, options });
    this.currentUrl = url;
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
            timeoutMs: 5000,
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
          timeoutMs: 5000,
        },
      },
    ]);
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
