import { afterEach, describe, expect, it, vi } from "vitest";
import type { JSONRPCMessage } from "../../protocol/json-rpc/types.js";
import type {
  LLMGenerateParams,
  LLMGenerateResult,
  StagehandMetrics,
} from "../../protocol/types.js";
import { Stagehand, StagehandCreateOptionsSchema } from "../src/index.js";
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
  initError: Error | undefined;
  readonly requests: JSONRPCMessage[] = [];
  readonly responses = new Map<string, unknown>();

  async send(message: JSONRPCMessage): Promise<void> {
    this.requests.push(message);
    if (!("id" in message) || !("method" in message)) return;
    if (message.method === "stagehand.init" && this.initError) {
      throw this.initError;
    }

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
  afterEach(() => vi.restoreAllMocks());

  it("attaches to a ready browser without taking transport ownership", async () => {
    const cdp = new FakeCDPClient();
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });

    const stagehand = await Stagehand.create({ browser, apiKey: "bb_worker_key" });

    expect(stagehand.initialized).toBe(true);
    expect(stagehand.browser).toBe(browser);
    expect("init" in stagehand).toBe(false);
    expect(cdp.requests[0]).toMatchObject({
      method: "stagehand.init",
      params: {
        browser_cdp_url: cdp.webSocketDebuggerUrl,
        log_level: "info",
        api_key: "bb_worker_key",
      },
    });

    await stagehand.close();
    expect(cdp.close).not.toHaveBeenCalled();

    await browser.close();
    expect(cdp.close).toHaveBeenCalledOnce();
  });

  it("releases the browser claim when initialization fails", async () => {
    const cdp = new FakeCDPClient();
    cdp.initError = new Error("worker initialization failed");
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });

    await expect(Stagehand.create({ browser })).rejects.toThrow("worker initialization failed");

    cdp.initError = undefined;
    const stagehand = await Stagehand.create({ browser });
    expect(stagehand.initialized).toBe(true);

    await stagehand.close();
    await browser.close();
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

  it("registers a client LLM handler and sends its serializable model reference", async () => {
    const cdp = new FakeCDPClient();
    const generate = vi.fn(
      async (_params: LLMGenerateParams): Promise<LLMGenerateResult> => ({
        role: "assistant",
        content: { type: "text", text: "Hello" },
        outputFormat: "text",
      }),
    );
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });

    const stagehand = await Stagehand.create({ browser, model: { generate } });

    expect(cdp.requestsFor("stagehand.init")[0]).toMatchObject({
      params: { model: { source: "client" } },
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
    await browser.close();
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
    expect(() => stagehand.context).toThrow(
      "Stagehand is unavailable. Create a new instance with await Stagehand.create().",
    );
    await expect(stagehand.metrics()).rejects.toThrow(
      "Stagehand is unavailable. Create a new instance with await Stagehand.create().",
    );

    await browser.close();
    expect(cdp.close).toHaveBeenCalledOnce();
  });
});
