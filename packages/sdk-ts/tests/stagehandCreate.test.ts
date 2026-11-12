import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { JSONRPCMessage } from "@browserbasehq/stagehand-protocol/json-rpc/types";
import type {
  DecisionChooseParams,
  DecisionChooseResult,
  LLMGenerateParams,
  LLMGenerateResult,
  StagehandMetrics,
} from "@browserbasehq/stagehand-protocol/types";
import {
  BrowserContext,
  Stagehand,
  StagehandCreateOptionsSchema,
  type StagehandBrowser,
} from "../src/index.js";
import { createBrowserFactoriesForTest } from "../src/browser/factories.js";
import { CDPConnectionClosedError, type CDPClient } from "../src/cdpClient.js";

class FakeCDPClient {
  readonly webSocketDebuggerUrl = "ws://127.0.0.1:9222/devtools/browser/test";
  readonly serviceWorker = {
    targetId: "worker-target",
    url: "chrome-extension://stagehand/service-worker.js",
    title: "Stagehand",
    extensionId: "stagehand",
  };
  onmessage?: (message: unknown) => void | Promise<void>;
  onclose?: (reason?: Error) => void;
  onerror?: (error: Error) => void;
  close = vi.fn();
  sendCommand = vi.fn(async () => ({}));
  initError: Error | undefined;
  respondToInit = true;
  beforeInit?: () => Promise<void>;
  readonly requests: JSONRPCMessage[] = [];
  readonly responses = new Map<string, unknown>();

  async send(message: JSONRPCMessage): Promise<void> {
    this.requests.push(message);
    if (!("id" in message) || !("method" in message)) return;
    if (message.method === "stagehand.init") await this.beforeInit?.();
    if (message.method === "stagehand.init" && this.initError) {
      await this.onmessage?.({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: this.initError.message },
      });
      return;
    }
    if (message.method === "stagehand.init" && !this.respondToInit) return;

    const configured = this.responses.get(message.method);
    if (configured instanceof Error) throw configured;
    const result =
      configured ??
      (message.method === "stagehand.init"
        ? { initialized: true, pages: [] }
        : message.method === "stagehand.close"
          ? { closed: true }
          : {});
    await this.onmessage?.({ jsonrpc: "2.0", id: message.id, result });
  }

  async emit(message: unknown): Promise<void> {
    await this.onmessage?.(message);
  }

  requestsFor(method: string): JSONRPCMessage[] {
    return this.requests.filter((request) => "method" in request && request.method === method);
  }
}

describe("Stagehand.create", () => {
  it("does not expose context directly on Stagehand", () => {
    expectTypeOf<"context" extends keyof Stagehand ? true : false>().toEqualTypeOf<false>();
    expect("context" in Stagehand.prototype).toBe(false);
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    undefined,
    "ws://127.0.0.1:9300/devtools/browser/abc",
    "wss://browser.example/devtools/browser/abc",
  ])("uses extension CDP URL %s or falls back to the client's URL", async (extensionCdpUrl) => {
    const cdp = new FakeCDPClient();
    const connectCdp = vi.fn(async () => cdp as unknown as CDPClient);
    const { localBrowser } = createBrowserFactoriesForTest({ connectCdp });
    const cdpUrl = "wss://gateway/cdp?api_key=secret";
    const browser = await localBrowser.connect({
      cdpUrl,
      ...(extensionCdpUrl === undefined ? {} : { extensionCdpUrl }),
    });
    const stagehand = await Stagehand.create({ browser });

    expect(connectCdp).toHaveBeenCalledWith(expect.objectContaining({ cdpUrl }));
    expect(cdp.requestsFor("stagehand.init")[0]).toMatchObject({
      params: { browser_cdp_url: extensionCdpUrl ?? cdp.webSocketDebuggerUrl },
    });

    await stagehand.close();
    await browser.close();
  });

  it("forwards an unknown model ID during initialization", async () => {
    const cdp = new FakeCDPClient();
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });
    const stagehand = await Stagehand.create({
      browser,
      model: { modelName: "openai/future-model-v1", apiKey: "provider-secret" },
    });

    expect(cdp.requestsFor("stagehand.init")[0]).toMatchObject({
      params: { model: { model_name: "openai/future-model-v1", api_key: "provider-secret" } },
    });

    await stagehand.close();
    await browser.close();
  });

  it("attaches to a ready browser without taking transport ownership", async () => {
    const cdp = new FakeCDPClient();
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });

    expect(() => browser.context).toThrow(
      "Browser context is unavailable. Attach the browser with await Stagehand.create({ browser }).",
    );

    const stagehand = await Stagehand.create({
      browser,
      apiKey: "bb_worker_key",
      apiUrl: "https://api.stagehand.dev.browserbase.com",
    });

    expect(stagehand.initialized).toBe(true);
    expect(stagehand.browser).toBe(browser);
    expect(browser.context).toBeInstanceOf(BrowserContext);
    expect("init" in stagehand).toBe(false);
    expect(cdp.requests[0]).toMatchObject({
      method: "stagehand.init",
      params: {
        browser_cdp_url: cdp.webSocketDebuggerUrl,
        log_level: "info",
      },
    });
    expect((cdp.requestsFor("stagehand.init")[0] as { params: object }).params).not.toHaveProperty(
      "telemetry",
    );
    const params = (cdp.requestsFor("stagehand.init")[0] as { params: object }).params;
    expect(params).not.toHaveProperty("api_key");
    expect(params).not.toHaveProperty("api_url");
    expect(params).not.toHaveProperty("browserbase");

    await stagehand.close();
    expect(cdp.close).not.toHaveBeenCalled();

    await browser.close();
    expect(cdp.close).toHaveBeenCalledOnce();
  });

  it("uses the claimed Browserbase key before the Stagehand key", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const cdp = new FakeCDPClient();
    cdp.beforeInit = () =>
      cdp.emit({
        jsonrpc: "2.0",
        id: 99,
        method: "browserbase.request",
        params: { operation: "cache.get", headers: {}, body: "{}" },
      });
    const { browserbase } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
      createBrowserbaseSessionClient: () => ({
        createSession: vi.fn(),
        connectSession: async () => ({
          sessionId: "session-precedence",
          cdpUrl: cdp.webSocketDebuggerUrl,
          region: "eu-central-1",
          close: vi.fn(),
        }),
      }),
    });
    const browser = await browserbase.connect({
      apiKey: "bb-browser-key",
      sessionId: "session-precedence",
    });
    const stagehand = await Stagehand.create({
      browser,
      apiKey: "bb-stagehand-key",
      apiUrl: "https://fixture.example/services",
      model: { modelName: "openai/gpt-5", apiKey: "provider-key" },
    });

    try {
      expect(cdp.requestsFor("stagehand.init")[0]).toMatchObject({
        params: {
          browserbase: "client",
          browser: { session_id: "session-precedence", region: "eu-central-1" },
          model: { model_name: "openai/gpt-5", api_key: "provider-key" },
        },
      });
      const params = (cdp.requestsFor("stagehand.init")[0] as { params: object }).params;
      expect(params).not.toHaveProperty("api_key");
      expect(params).not.toHaveProperty("api_url");
      expect(fetch).toHaveBeenCalledOnce();
      const request = fetch.mock.calls[0]?.[0] as Request;
      expect(request.url).toBe("https://fixture.example/services/v1/cache/get");
      expect(request.headers.get("x-bb-api-key")).toBe("bb-browser-key");
      expect(cdp.requests).toContainEqual(
        expect.objectContaining({
          id: 99,
          result: expect.objectContaining({ type: "response", status: 200 }),
        }),
      );
    } finally {
      await stagehand.close();
      await browser.close();
    }
  });

  it("releases the browser claim after a fully settled initialization error", async () => {
    const cdp = new FakeCDPClient();
    cdp.initError = new Error("worker initialization failed");
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });

    const choose = vi.fn(async (): Promise<DecisionChooseResult> => ({ status: "no_match" }));
    await expect(Stagehand.create({ browser, decisionModel: { choose } })).rejects.toThrow(
      "worker initialization failed",
    );
    expect(browser.closed).toBe(false);
    expect(cdp.close).not.toHaveBeenCalled();

    cdp.initError = undefined;
    const stagehand = await Stagehand.create({ browser });
    expect(stagehand.initialized).toBe(true);
    await cdp.emit({
      jsonrpc: "2.0",
      id: 99,
      method: "decision.choose",
      params: {
        prompt: "Save",
        candidates: [{ id: "0-1", description: "Save button" }],
      },
    });
    expect(choose).not.toHaveBeenCalled();
    expect(cdp.requests).toContainEqual({
      jsonrpc: "2.0",
      id: 99,
      error: { code: -32601, message: "Method not found" },
    });

    await stagehand.close();
    await browser.close();
  });

  it("releases the browser claim after close so another Stagehand can attach", async () => {
    const cdp = new FakeCDPClient();
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });
    const firstStagehand = await Stagehand.create({ browser });

    await firstStagehand.close();

    const secondStagehand = await Stagehand.create({ browser });
    expect(secondStagehand.initialized).toBe(true);
    expect(secondStagehand.browser).toBe(browser);
    expect(cdp.requestsFor("stagehand.init")).toHaveLength(2);
    expect(cdp.close).not.toHaveBeenCalled();

    await secondStagehand.close();
    await browser.close();
  });

  it("makes context close an alias for browser close", async () => {
    const cdp = new FakeCDPClient();
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });
    const stagehand = await Stagehand.create({ browser });
    const context = browser.context;

    await Promise.all([context.close(), browser.close(), context.close()]);

    expect(browser.closed).toBe(true);
    expect(cdp.sendCommand).toHaveBeenCalledOnce();
    expect(cdp.sendCommand).toHaveBeenCalledWith(
      "Browser.close",
      {},
      undefined,
      expect.any(AbortSignal),
    );
    expect(cdp.close).toHaveBeenCalledOnce();
    expect(cdp.requestsFor("context.close")).toHaveLength(0);

    await stagehand.close();
  });

  it("retains the browser claim when the worker rejects close", async () => {
    const cdp = new FakeCDPClient();
    cdp.responses.set("stagehand.close", new Error("worker close failed"));
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });
    const stagehand = await Stagehand.create({ browser });

    await expect(stagehand.close()).rejects.toThrow("worker close failed");
    await expect(Stagehand.create({ browser })).rejects.toThrow(
      "This browser is already attached to a Stagehand instance",
    );
    expect(cdp.requestsFor("stagehand.init")).toHaveLength(1);

    await browser.close();
  });

  it("invalidates the browser after an ambiguous invalid initialization result", async () => {
    const cdp = new FakeCDPClient();
    cdp.responses.set("stagehand.init", { initialized: "not-a-boolean" });
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });
    const closeBrowser = vi.spyOn(browser, "close");

    await expect(Stagehand.create({ browser })).rejects.toThrow();
    expect(browser.closed).toBe(true);
    expect(closeBrowser).not.toHaveBeenCalled();
    expect(cdp.close).toHaveBeenCalledOnce();
    await expect(Stagehand.create({ browser })).rejects.toThrow(
      "Cannot attach Stagehand to a closed browser",
    );
  });

  it("invalidates the browser after an ambiguous stagehand.init timeout", async () => {
    let browser: StagehandBrowser | undefined;
    try {
      vi.useFakeTimers();
      const cdp = new FakeCDPClient();
      cdp.respondToInit = false;
      const { localBrowser } = createBrowserFactoriesForTest({
        connectCdp: async () => cdp as unknown as CDPClient,
      });
      browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });

      const creating = Stagehand.create({ browser });
      const rejection = expect(creating).rejects.toThrow(
        "Stagehand initialization timed out after 60000ms",
      );

      await vi.advanceTimersByTimeAsync(60_000);
      await rejection;
      expect(cdp.close).toHaveBeenCalledOnce();
      expect(browser.closed).toBe(true);
      expect(cdp.onmessage).toBeUndefined();

      cdp.respondToInit = true;
      await expect(Stagehand.create({ browser })).rejects.toThrow(
        "Cannot attach Stagehand to a closed browser",
      );

      await cdp.emit({
        jsonrpc: "2.0",
        id: 1,
        result: { initialized: true, pages: [] },
      });
      expect(cdp.requestsFor("stagehand.init")).toHaveLength(1);
    } finally {
      await browser?.close();
      vi.useRealTimers();
    }
  });

  it("rejects browser-like objects not created by a Stagehand factory", async () => {
    await expect(
      Stagehand.create({
        browser: {
          provider: "local",
          origin: "connected",
          closed: false,
          close: async () => {},
        } as never,
      }),
    ).rejects.toThrow("browser must be created by localBrowser or browserbase");
  });

  it("rejects unknown create options at the public boundary", async () => {
    const cdp = new FakeCDPClient();
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });

    expect(() => StagehandCreateOptionsSchema.parse({ browser, browserbase: "client" })).toThrow(
      /Unrecognized key/,
    );
    expect(() => StagehandCreateOptionsSchema.parse({ browser, unexpected: true })).toThrow(
      "Unrecognized key",
    );

    await browser.close();
  });

  it("passes telemetry to initialization and routes metrics through the protocol", async () => {
    const cdp = new FakeCDPClient();
    const metrics: StagehandMetrics = {
      actPromptTokens: 1,
      actCompletionTokens: 2,
      actReasoningTokens: 3,
      actCachedInputTokens: 4,
      actInferenceTimeMs: 5,
      extractPromptTokens: 6,
      extractCompletionTokens: 7,
      extractReasoningTokens: 8,
      extractCachedInputTokens: 9,
      extractInferenceTimeMs: 10,
      observePromptTokens: 11,
      observeCompletionTokens: 12,
      observeReasoningTokens: 13,
      observeCachedInputTokens: 14,
      observeInferenceTimeMs: 15,
      totalPromptTokens: 18,
      totalCompletionTokens: 21,
      totalReasoningTokens: 24,
      totalCachedInputTokens: 27,
      totalInferenceTimeMs: 30,
    };
    cdp.responses.set("stagehand.metrics", metrics);
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });

    const stagehand = await Stagehand.create({
      browser,
      telemetry: {
        traces: {
          endpoint: "https://collector.example.com/v1/traces",
          headers: { Authorization: "Bearer test" },
        },
      },
    });

    expect(cdp.requestsFor("stagehand.init")[0]).toMatchObject({
      params: {
        telemetry: {
          traces: {
            endpoint: "https://collector.example.com/v1/traces",
            headers: { Authorization: "Bearer test" },
          },
        },
      },
    });
    await expect(stagehand.metrics()).resolves.toStrictEqual(metrics);
    expect(cdp.requestsFor("stagehand.metrics")).toHaveLength(1);

    await stagehand.close();
    await browser.close();
  });

  it("registers independent generation and decision callbacks and serializes only their references", async () => {
    const cdp = new FakeCDPClient();
    const generate = vi.fn(async (_params: LLMGenerateParams): Promise<LLMGenerateResult> => ({
      role: "assistant",
      content: { type: "text", text: "Hello" },
      outputFormat: "text",
    }));
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });

    const choose = vi.fn(async (params: DecisionChooseParams): Promise<DecisionChooseResult> => ({
      status: "selected",
      id: params.candidates[0]!.id,
    }));
    const stagehand = await Stagehand.create({
      browser,
      model: { generate },
      decisionModel: { choose },
    });

    expect(cdp.requestsFor("stagehand.init")[0]).toMatchObject({
      params: { model: { source: "client" }, decision_model: { source: "client" } },
    });
    const init = cdp.requestsFor("stagehand.init")[0]!;
    if (!("params" in init)) throw new Error("Missing init params");
    expect((init.params as { decision_model: unknown }).decision_model).toEqual({
      source: "client",
    });
    const decision = { prompt: "Save", candidates: [{ id: "0-1", description: "Save button" }] };
    await cdp.emit({ jsonrpc: "2.0", id: 98, method: "decision.choose", params: decision });
    expect(choose).toHaveBeenCalledExactlyOnceWith(decision);
    expect(cdp.requests).toContainEqual({
      jsonrpc: "2.0",
      id: 98,
      result: { status: "selected", id: "0-1" },
    });
    await cdp.emit({
      jsonrpc: "2.0",
      id: 99,
      method: "llm.generate",
      params: {
        messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
        response_format: { type: "text" },
      },
    });

    expect(generate).toHaveBeenCalledOnce();
    expect(cdp.requests).toContainEqual({
      jsonrpc: "2.0",
      id: 99,
      result: {
        role: "assistant",
        content: { type: "text", text: "Hello" },
        output_format: "text",
      },
    });

    await stagehand.close();
    const next = await Stagehand.create({ browser });
    await cdp.emit({ jsonrpc: "2.0", id: 100, method: "decision.choose", params: decision });
    expect(choose).toHaveBeenCalledTimes(1);
    expect(cdp.requests).toContainEqual({
      jsonrpc: "2.0",
      id: 100,
      error: { code: -32601, message: "Method not found" },
    });
    await next.close();
    await browser.close();
  });

  it("reports unavailable Browserbase transport for a local browser without a session", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const cdp = new FakeCDPClient();
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });
    const stagehand = await Stagehand.create({ browser, apiKey: "bb-key" });
    try {
      await cdp.emit({
        jsonrpc: "2.0",
        id: 99,
        method: "browserbase.request",
        params: { operation: "cache.get", headers: {}, body: "{}" },
      });
      expect(cdp.requests).toContainEqual(
        expect.objectContaining({
          id: 99,
          result: expect.objectContaining({ type: "error", reason: "unavailable" }),
        }),
      );
      expect(fetch).not.toHaveBeenCalled();
      const rpc = stagehand.rpcClient!;
      await stagehand.close();
      expect(rpc.requestHandlers.has("browserbase.request")).toBe(false);
    } finally {
      await stagehand.close();
      await browser.close();
    }
  });

  it("filters and renders notifications, then removes its listener on close", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const cdp = new FakeCDPClient();
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });
    const stagehand = await Stagehand.create({ browser });
    const receive = cdp.onmessage;

    for (const params of [
      { level: "debug", message: "CDP call", data: { method: "Page.navigate" } },
      { level: "info", message: "Page opened", data: { pageId: "page-1" } },
      { level: "warn", message: "Selector fallback", data: {} },
      { level: "error", message: "Action failed", data: { retryable: false } },
    ]) {
      await cdp.emit({ jsonrpc: "2.0", method: "stagehand.log", params });
    }

    expect(stderr.mock.calls.map(([line]) => line)).toStrictEqual([
      '[stagehand] INFO Page opened {"pageId":"page-1"}\n',
      "[stagehand] WARN Selector fallback\n",
      '[stagehand] ERROR Action failed {"retryable":false}\n',
    ]);

    await stagehand.close();
    expect(cdp.onmessage).toBeUndefined();
    await receive?.({
      jsonrpc: "2.0",
      method: "stagehand.log",
      params: { level: "error", message: "After close", data: {} },
    });
    expect(stderr).toHaveBeenCalledTimes(3);

    await browser.close();
  });

  it("writes JSON logs and invokes onLog with the structured event", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const onLog = vi.fn();
    const cdp = new FakeCDPClient();
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });
    const stagehand = await Stagehand.create({
      browser,
      logging: { level: "debug", format: "json", onLog },
    });
    const log = {
      level: "debug" as const,
      message: "CDP call",
      data: { method: "Page.navigate" },
    };

    await cdp.emit({ jsonrpc: "2.0", method: "stagehand.log", params: log });

    expect(stderr).toHaveBeenCalledWith(`${JSON.stringify(log)}\n`);
    expect(onLog).toHaveBeenCalledWith(log);

    await stagehand.close();
    await browser.close();
  });

  it.each([
    [
      "synchronous",
      () => {
        throw new Error("sync failure");
      },
    ],
    [
      "asynchronous",
      async () => {
        throw new Error("async failure");
      },
    ],
  ])("reports %s onLog errors without breaking notification handling", async (_, onLog) => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const cdp = new FakeCDPClient();
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });
    const stagehand = await Stagehand.create({
      browser,
      logging: { level: "info", format: "pretty", onLog },
    });

    await expect(
      cdp.emit({
        jsonrpc: "2.0",
        method: "stagehand.log",
        params: { level: "info", message: "Page opened", data: {} },
      }),
    ).resolves.toBeUndefined();
    await Promise.resolve();

    expect(stderr.mock.calls.map(([line]) => line)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^\[stagehand\] ERROR onLog callback failed: (sync|async) failure\n$/,
        ),
      ]),
    );

    await stagehand.close();
    await browser.close();
  });

  it("makes close idempotent, tolerates CDP disconnect, and improves post-close errors", async () => {
    const cdp = new FakeCDPClient();
    cdp.responses.set("stagehand.close", new CDPConnectionClosedError());
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });
    const stagehand = await Stagehand.create({ browser });

    const firstClose = stagehand.close();
    const secondClose = stagehand.close();
    expect(secondClose).toBe(firstClose);
    await Promise.all([firstClose, secondClose]);

    expect(stagehand.initialized).toBe(false);
    expect(cdp.requestsFor("stagehand.close")).toHaveLength(1);
    expect(cdp.close).not.toHaveBeenCalled();
    expect(() => browser.context).toThrow(
      "Browser context is unavailable. Attach the browser with await Stagehand.create({ browser }).",
    );
    await expect(stagehand.metrics()).rejects.toThrow(
      "Stagehand is unavailable. Create a new instance with await Stagehand.create().",
    );

    const reattached = await Stagehand.create({ browser });
    await reattached.close();
    await browser.close();
    expect(cdp.close).toHaveBeenCalledOnce();
  });
});
