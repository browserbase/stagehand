import { describe, expect, it } from "vite-plus/test";
import { z } from "zod/v4";
import { JSONRPCErrorCodes, type RPCMethod } from "../../protocol/json-rpc/schemas.js";
import type { JSONRPCMessage } from "../../protocol/json-rpc/types.js";
import { StagehandMethods } from "../../protocol/schema-registry.js";
import { RPCClient, type CDPTransport } from "../src/rpcClient.js";

const UppercaseMethod = {
  name: "test.uppercase",
  params: z.object({ value: z.string() }).strict(),
  result: z.object({ value: z.string() }).strict(),
} as const satisfies RPCMethod;

class FakeCDPTransport implements CDPTransport {
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

  constructor(readonly result: unknown) {}

  async send(message: JSONRPCMessage): Promise<void> {
    this.sent.push(message);
    if (!("id" in message) || !("method" in message)) return;
    await this.onmessage?.({ jsonrpc: "2.0", id: message.id, result: this.result });
  }

  close(): void {}
}

class ManualCDPTransport implements CDPTransport {
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

  async receive(message: JSONRPCMessage): Promise<void> {
    await this.onmessage?.(message);
  }

  close(): void {}
}

describe("RPCClient", () => {
  it("registers the pending request before CDP can return its response", async () => {
    const cdp = new FakeCDPTransport({
      page_id: "page-1",
      url: "https://example.com",
    });
    const client = new RPCClient(cdp, 1_000);

    await expect(
      client.send(StagehandMethods.pageGoto, {
        pageId: "page-1",
        url: "https://example.com",
      }),
    ).resolves.toStrictEqual({
      pageId: "page-1",
      url: "https://example.com",
    });

    expect(cdp.sent).toContainEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "page.goto",
      params: {
        page_id: "page-1",
        url: "https://example.com",
      },
    });
  });

  it("rejects invalid method params before sending them over CDP", async () => {
    const cdp = new FakeCDPTransport({ ok: true, runtime: "service_worker" });
    const client = new RPCClient(cdp, 1_000);

    await expect(client.send(StagehandMethods.ping, { extra: true } as never)).rejects.toThrow();

    expect(cdp.sent).toStrictEqual([]);
  });

  it("lets the worker request client work while the original SDK request is still pending", async () => {
    const cdp = new ManualCDPTransport();
    const client = new RPCClient(cdp, 1_000);
    client.onRequest(UppercaseMethod, async ({ value }) => ({ value: value.toUpperCase() }));

    const originalRequest = client.send(StagehandMethods.ping, {});
    await cdp.receive({
      jsonrpc: "2.0",
      id: 42,
      method: UppercaseMethod.name,
      params: { value: "nested request" },
    });

    expect(cdp.sent[1]).toStrictEqual({
      jsonrpc: "2.0",
      id: 42,
      result: { value: "NESTED REQUEST" },
    });

    await cdp.receive({
      jsonrpc: "2.0",
      id: 1,
      result: { ok: true, runtime: "service_worker" },
    });
    await expect(originalRequest).resolves.toStrictEqual({
      ok: true,
      runtime: "service_worker",
    });
  });

  it("validates incoming request parameters before invoking the SDK handler", async () => {
    const cdp = new ManualCDPTransport();
    const client = new RPCClient(cdp, 1_000);
    let calls = 0;
    client.onRequest(UppercaseMethod, async ({ value }) => {
      calls += 1;
      return { value: value.toUpperCase() };
    });

    await cdp.receive({
      jsonrpc: "2.0",
      id: 2,
      method: UppercaseMethod.name,
      params: { value: 42 },
    } as never);

    expect(calls).toBe(0);
    expect(cdp.sent).toContainEqual({
      jsonrpc: "2.0",
      id: 2,
      error: {
        code: JSONRPCErrorCodes.invalidParams,
        message: "Invalid params",
      },
    });
  });

  it("validates an SDK handler result before returning it to the worker", async () => {
    const cdp = new ManualCDPTransport();
    const client = new RPCClient(cdp, 1_000);
    client.onRequest(UppercaseMethod, async () => ({ value: 42 }) as never);

    await cdp.receive({
      jsonrpc: "2.0",
      id: 3,
      method: UppercaseMethod.name,
      params: { value: "valid" },
    });

    expect(cdp.sent).toContainEqual({
      jsonrpc: "2.0",
      id: 3,
      error: {
        code: JSONRPCErrorCodes.internalError,
        message: "Internal error",
      },
    });
  });

  it("returns method not found when no SDK handler is registered", async () => {
    const cdp = new ManualCDPTransport();
    new RPCClient(cdp, 1_000);

    await cdp.receive({
      jsonrpc: "2.0",
      id: 4,
      method: UppercaseMethod.name,
      params: { value: "unhandled" },
    });

    expect(cdp.sent).toContainEqual({
      jsonrpc: "2.0",
      id: 4,
      error: {
        code: JSONRPCErrorCodes.methodNotFound,
        message: "Method not found",
      },
    });
  });

  it("returns a JSON-RPC error when an SDK handler throws", async () => {
    const cdp = new ManualCDPTransport();
    const client = new RPCClient(cdp, 1_000);
    client.onRequest(UppercaseMethod, async () => {
      throw new Error("Client handler failed");
    });

    await cdp.receive({
      jsonrpc: "2.0",
      id: 5,
      method: UppercaseMethod.name,
      params: { value: "failure" },
    });

    expect(cdp.sent).toContainEqual({
      jsonrpc: "2.0",
      id: 5,
      error: {
        code: JSONRPCErrorCodes.internalError,
        message: "Internal error",
      },
    });
  });

  it("removes incoming SDK request handlers when the RPC client closes", async () => {
    const cdp = new ManualCDPTransport();
    const client = new RPCClient(cdp, 1_000);
    let calls = 0;
    client.onRequest(UppercaseMethod, async ({ value }) => {
      calls += 1;
      return { value };
    });

    client.close();
    await client.receive({
      jsonrpc: "2.0",
      id: 6,
      method: UppercaseMethod.name,
      params: { value: "closed" },
    });

    expect(calls).toBe(0);
    expect(cdp.sent).toStrictEqual([]);
  });
});
