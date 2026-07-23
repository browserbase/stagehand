import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it } from "vitest";
import { FlowLogger } from "../../lib/v3/flowlogger/FlowLogger.js";
import { EventEmitterWithWildcardSupport } from "../../lib/v3/flowlogger/EventEmitter.js";

describe("flow logger llm logging", () => {
  it("no-ops direct llm logging calls when no flow context is active", () => {
    // These helpers are called from multiple model adapters, so they must stay
    // safe even when a test or utility invokes them outside any ALS flow scope.
    expect(() =>
      FlowLogger.logLlmRequest({
        requestId: "req-1",
        model: "mock-model",
        prompt: "hello",
      }),
    ).not.toThrow();

    expect(() =>
      FlowLogger.logLlmResponse({
        requestId: "req-1",
        model: "mock-model",
        output: "world",
        inputTokens: 1,
        outputTokens: 1,
      }),
    ).not.toThrow();
  });

  it("does not throw from llm middleware when no flow context is active", async () => {
    const middleware = FlowLogger.createLlmLoggingMiddleware("mock-model");

    // Missing flow context should degrade to a silent no-op and preserve the
    // underlying model result.
    await expect(
      middleware.wrapGenerate({
        doGenerate: async () => ({
          text: "done",
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
          },
        }),
        params: {
          prompt: [],
        },
      } as never),
    ).resolves.toMatchObject({
      text: "done",
    });
  });

  it("FlowLogger.init() does not throw when enterWith() is not implemented (e.g. Cloudflare Workers)", () => {
    // Simulate a runtime that omits enterWith() from AsyncLocalStorage.
    const originalEnterWith = AsyncLocalStorage.prototype.enterWith;
    Object.defineProperty(AsyncLocalStorage.prototype, "enterWith", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    try {
      const bus = new EventEmitterWithWildcardSupport();
      let ctx: ReturnType<typeof FlowLogger.init> | undefined;
      expect(() => {
        ctx = FlowLogger.init("session-cloudflare", bus);
      }).not.toThrow();
      // The returned context must still be valid even without ALS support.
      expect(ctx).toMatchObject({ sessionId: "session-cloudflare" });
    } finally {
      Object.defineProperty(AsyncLocalStorage.prototype, "enterWith", {
        value: originalEnterWith,
        configurable: true,
        writable: true,
      });
    }
  });
});
