import { afterEach, describe, expect, it, vi } from "vitest";
import type { JSONRPCMessage } from "../../protocol/json-rpc/types.js";
import { StagehandMethods } from "../../protocol/schema-registry.js";
import { MAX_CALLBACK_BATCH_TIMEOUT_MS } from "../../protocol/schemas.js";
import {
  BrowserContext,
  CALLBACK_BATCH_CLIENT_GRACE_MS,
  Stagehand,
  StagehandBatchTimeoutError,
} from "../src/index.js";
import { RPCClient, RPCResponseTimeoutError, type CDPTransport } from "../src/rpcClient.js";
import {
  attachStagehandBrowserContext,
  claimStagehandBrowserHandle,
  createStagehandBrowserHandle,
} from "../src/browser/index.js";

/** A transport that accepts requests and never answers them. */
class SilentCDPTransport implements CDPTransport {
  readonly serviceWorker = {
    targetId: "worker-target",
    url: "chrome-extension://stagehand/service-worker.js",
    title: "Stagehand",
    extensionId: "stagehand",
  };
  onmessage?: (message: unknown) => void | Promise<void>;
  onclose?: (reason?: Error) => void;
  onerror?: (error: Error) => void;
  readonly sent: JSONRPCMessage[] = [];

  async send(message: JSONRPCMessage): Promise<void> {
    this.sent.push(message);
  }

  close(): void {}
}

function createStagehand(client: RPCClient): Stagehand {
  const browser = createStagehandBrowserHandle({
    provider: "local",
    origin: "connected",
    attachment: {},
    close: () => {},
  });
  claimStagehandBrowserHandle(browser);
  attachStagehandBrowserContext(browser, new BrowserContext(client, () => browser.close()));
  const stagehand = Object.create(Stagehand.prototype) as Stagehand;
  Object.assign(stagehand, { browserHandle: browser });
  stagehand.rpcClient = client;
  stagehand.isInitialized = true;
  return stagehand;
}

describe("experimentalBatch client deadline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects with a typed error when the executor never answers", async () => {
    vi.useFakeTimers();
    const transport = new SilentCDPTransport();
    const client = new RPCClient(transport);
    const stagehand = createStagehand(client);

    try {
      const pending = stagehand.experimentalBatch(async () => "never", undefined, {
        timeout: 60_000,
      });
      const rejection = expect(pending).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(StagehandBatchTimeoutError);
        const typed = error as StagehandBatchTimeoutError;
        expect(typed.timeout).toBe(60_000);
        expect(typed.clientTimeout).toBe(60_000 + CALLBACK_BATCH_CLIENT_GRACE_MS);
        expect(typed.cause).toBeInstanceOf(RPCResponseTimeoutError);
        return true;
      });

      await vi.advanceTimersByTimeAsync(60_000 + CALLBACK_BATCH_CLIENT_GRACE_MS - 1);
      expect(client.pending.size).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await rejection;
      expect(client.pending.size).toBe(0);
      expect(transport.sent).toHaveLength(1);
      expect((transport.sent[0] as { method: string }).method).toBe(
        StagehandMethods.stagehandCallbackBatch.name,
      );
    } finally {
      client.close();
    }
  });

  it("lets callers shorten the round-trip deadline below the executor timeout", async () => {
    vi.useFakeTimers();
    const client = new RPCClient(new SilentCDPTransport());
    const stagehand = createStagehand(client);

    try {
      const pending = stagehand.experimentalBatch(async () => "never", undefined, {
        timeout: 60_000,
        clientTimeoutMs: 5_000,
      });
      const rejection = expect(pending).rejects.toMatchObject({
        name: "StagehandBatchTimeoutError",
        timeout: 60_000,
        clientTimeout: 5_000,
      });
      await vi.advanceTimersByTimeAsync(5_000);
      await rejection;
    } finally {
      client.close();
    }
  });

  it("keeps the maximum executor timeout within the timer limit", async () => {
    vi.useFakeTimers();
    const client = new RPCClient(new SilentCDPTransport());
    const stagehand = createStagehand(client);

    try {
      const pending = stagehand.experimentalBatch(async () => "never", undefined, {
        timeout: MAX_CALLBACK_BATCH_TIMEOUT_MS,
      });
      const rejection = expect(pending).rejects.toMatchObject({ clientTimeout: 2_147_483_647 });
      // A delay above the limit would have fired immediately; the request must still be pending.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(client.pending.size).toBe(1);
      await vi.advanceTimersByTimeAsync(2_147_483_647);
      await rejection;
    } finally {
      client.close();
    }
  });

  it("validates clientTimeoutMs before sending", async () => {
    const client = new RPCClient(new SilentCDPTransport());
    const stagehand = createStagehand(client);
    try {
      await expect(
        stagehand.experimentalBatch(async () => undefined, undefined, { clientTimeoutMs: 0 }),
      ).rejects.toThrow(RangeError);
      expect(client.pending.size).toBe(0);
    } finally {
      client.close();
    }
  });
});
