import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { JSONRPCMessage } from "@browserbasehq/stagehand-protocol/json-rpc/types";
import type {
  LLMGenerateParams,
  LLMGenerateResult,
  StagehandMetrics,
} from "@browserbasehq/stagehand-protocol/types";
import {
  BrowserContext,
  Stagehand,
  StagehandCreateOptionsSchema,
  type StagehandBrowser,
  type StagehandCreateOptions,
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
  readonly requests: JSONRPCMessage[] = [];
  readonly responses = new Map<string, unknown>();

  async send(message: JSONRPCMessage): Promise<void> {
    this.requests.push(message);
    if (!("id" in message) || !("method" in message)) return;
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
        api_key: "bb_worker_key",
        api_url: "https://api.stagehand.dev.browserbase.com",
      },
    });

    await stagehand.close();
    expect(cdp.close).not.toHaveBeenCalled();

    await browser.close();
    expect(cdp.close).toHaveBeenCalledOnce();
  });

  it("releases the browser claim after a fully settled initialization error", async () => {
    const cdp = new FakeCDPClient();
    cdp.initError = new Error("worker initialization failed");
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });

    await expect(Stagehand.create({ browser })).rejects.toThrow("worker initialization failed");
    expect(browser.closed).toBe(false);
    expect(cdp.close).not.toHaveBeenCalled();

    cdp.initError = undefined;
    const stagehand = await Stagehand.create({ browser });
    expect(stagehand.initialized).toBe(true);

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
    expect(cdp.sendCommand).toHaveBeenCalledWith("Browser.close");
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

  it.each([undefined, {}, { console: true }, { console: false }])(
    "normalizes public logging options %j",
    async (logging) => {
      expectTypeOf<NonNullable<StagehandCreateOptions["logging"]>["console"]>().toEqualTypeOf<
        boolean | undefined
      >();
      const cdp = new FakeCDPClient();
      const { localBrowser } = createBrowserFactoriesForTest({
        connectCdp: async () => cdp as unknown as CDPClient,
      });
      const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });
      try {
        expect(StagehandCreateOptionsSchema.parse({ browser, logging }).logging).toEqual({
          level: "info",
          format: "pretty",
          console: logging?.console ?? true,
        });
      } finally {
        await browser.close();
      }
    },
  );

  it.each([null, "false", 0, 1, {}, []])("rejects logging.console=%j", async (value) => {
    const cdp = new FakeCDPClient();
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: async () => cdp as unknown as CDPClient,
    });
    const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });
    try {
      const result = StagehandCreateOptionsSchema.safeParse({
        browser,
        logging: { console: value },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toContainEqual(
          expect.objectContaining({ path: ["logging", "console"], code: "invalid_type" }),
        );
      }
    } finally {
      await browser.close();
    }
  });

  describe.each([undefined, true, false])("logging.console=%s", (consoleOutput) => {
    describe.each(["pretty", "json"] as const)("format=%s", (format) => {
      it.each([
        ["info", true],
        ["info", false],
        ["off", true],
        ["off", false],
      ] as const)(
        "filters both destinations at level=%s with callback=%s",
        async (level, callback) => {
          const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
          const onLog = vi.fn();
          const cdp = new FakeCDPClient();
          const { localBrowser } = createBrowserFactoriesForTest({
            connectCdp: async () => cdp as unknown as CDPClient,
          });
          const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });
          const stagehand = await Stagehand.create({
            browser,
            logging: {
              level,
              format,
              ...(consoleOutput === undefined ? {} : { console: consoleOutput }),
              ...(callback ? { onLog } : {}),
            },
          });
          try {
            const logs = ["debug", "info", "warn", "error"].map((eventLevel) => ({
              level: eventLevel,
              message: "Page opened",
              data: { nested: { count: 1 }, tags: ["test"] },
            }));
            const originalLogs = structuredClone(logs);
            for (const params of logs) {
              await cdp.emit({ jsonrpc: "2.0", method: "stagehand.log", params });
            }
            const eligible = level === "off" ? [] : originalLogs.slice(1);
            expect(onLog.mock.calls).toStrictEqual(callback ? eligible.map((log) => [log]) : []);
            expect(logs).toStrictEqual(originalLogs);
            expect(stderr.mock.calls.map(([line]) => line)).toStrictEqual(
              consoleOutput === false
                ? []
                : eligible.map((log) =>
                    format === "json"
                      ? `${JSON.stringify(log)}\n`
                      : `[stagehand] ${log.level.toUpperCase()} Page opened {"nested":{"count":1},"tags":["test"]}\n`,
                  ),
            );
            const init = JSON.parse(JSON.stringify(cdp.requestsFor("stagehand.init")[0]));
            expect(init.params.log_level).toBe(level);
            for (const sdkOnlyKey of ["logging", "console", "format", "on_log", "onLog"]) {
              expect(init.params).not.toHaveProperty(sdkOnlyKey);
            }
          } finally {
            await stagehand.close();
            await browser.close();
          }
        },
      );
    });
  });

  describe.each([true, false])("callback failures with console=%s", (consoleOutput) => {
    it.each(["synchronous", "asynchronous"] as const)(
      "reports %s onLog errors without breaking notification handling",
      async (failure) => {
        const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        const unhandledRejection = vi.fn();
        process.on("unhandledRejection", unhandledRejection);
        const onLog = vi.fn().mockImplementationOnce(() => {
          const error = new Error(`${failure} failure`);
          if (failure === "synchronous") throw error;
          return Promise.reject(error);
        });
        const cdp = new FakeCDPClient();
        const { localBrowser } = createBrowserFactoriesForTest({
          connectCdp: async () => cdp as unknown as CDPClient,
        });
        const browser = await localBrowser.connect({ cdpUrl: cdp.webSocketDebuggerUrl });
        let stagehand: Stagehand | undefined;
        try {
          stagehand = await Stagehand.create({
            browser,
            logging: { console: consoleOutput, onLog },
          });
          for (const message of ["Page opened", "Next event"]) {
            await expect(
              cdp.emit({
                jsonrpc: "2.0",
                method: "stagehand.log",
                params: { level: "info", message, data: {} },
              }),
            ).resolves.toBeUndefined();
          }
          // Cross an event-loop turn so an unhandled rejection would be observable.
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(unhandledRejection).not.toHaveBeenCalled();
          expect(onLog.mock.calls).toStrictEqual([
            [{ level: "info", message: "Page opened", data: {} }],
            [{ level: "info", message: "Next event", data: {} }],
          ]);
          expect(stderr.mock.calls.map(([line]) => line)).toStrictEqual([
            ...(consoleOutput ? ["[stagehand] INFO Page opened\n"] : []),
            `[stagehand] ERROR onLog callback failed: ${failure} failure\n`,
            ...(consoleOutput ? ["[stagehand] INFO Next event\n"] : []),
          ]);
        } finally {
          process.off("unhandledRejection", unhandledRejection);
          await stagehand?.close();
          await browser.close();
        }
      },
    );
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
