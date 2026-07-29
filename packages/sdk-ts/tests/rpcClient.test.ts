import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod/v4";
import { JSONRPCErrorCodes, type RPCMethod } from "../../protocol/json-rpc/schemas.js";
import { STAGEHAND_PROTOCOL_VERSION } from "../../protocol/schemas.js";
import type { JSONRPCMessage } from "../../protocol/json-rpc/types.js";
import { StagehandMethods } from "../../protocol/schema-registry.js";
import sdkPackageJson from "../package.json" with { type: "json" };
import { CDPClient } from "../src/cdpClient.js";
import { connectRPCClient, RPCClient, type CDPTransport } from "../src/rpcClient.js";

const UppercaseMethod = {
  name: "test.uppercase",
  params: z.object({ value: z.string() }).strict(),
  result: z.object({ value: z.string() }).strict(),
} as const satisfies RPCMethod;

class FakeCDPTransport implements CDPTransport {
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
  it("reports the SDK package version when configuring the runtime", async () => {
    const cdp = new FakeCDPTransport({ configured: true });
    const connect = vi.spyOn(CDPClient, "connect").mockResolvedValue(cdp as unknown as CDPClient);

    try {
      const client = await connectRPCClient({
        cdpUrl: "ws://127.0.0.1:9222/devtools/browser/test",
        extensionId: "stagehand",
      });
      try {
        expect(cdp.sent[0]).toMatchObject({
          jsonrpc: "2.0",
          method: "runtime.configure",
          params: {
            protocol_version: STAGEHAND_PROTOCOL_VERSION,
            client_info: {
              name: "stagehand-sdk-ts",
              version: sdkPackageJson.version,
            },
          },
        });
      } finally {
        client.close();
      }
    } finally {
      connect.mockRestore();
    }
  });

  it("accepts page methods without SDK wrapper methods", async () => {
    const cdp = new FakeCDPTransport({ matched: true });
    const client = new RPCClient(cdp);

    const request = client.send(StagehandMethods.pageWaitForSelector, {
      pageId: "page-1",
      selector: "button.submit",
      options: { state: "visible", timeout: 1_000, pierceShadow: true },
    });

    expectTypeOf(request).toEqualTypeOf<Promise<{ matched: boolean }>>();
    await expect(request).resolves.toStrictEqual({ matched: true });
    expect(cdp.sent).toContainEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "page.wait_for_selector",
      params: {
        page_id: "page-1",
        selector: "button.submit",
        options: { state: "visible", timeout: 1_000, pierce_shadow: true },
      },
    });
  });

  it("accepts context methods without SDK wrapper methods", async () => {
    const cdp = new FakeCDPTransport([
      {
        name: "session",
        value: "abc123",
        domain: "example.com",
        path: "/",
        expires: -1,
        http_only: true,
        secure: true,
        same_site: "Lax",
      },
    ]);
    const client = new RPCClient(cdp);

    const request = client.send(StagehandMethods.contextCookies, {
      urls: ["https://example.com/account"],
    });

    expectTypeOf(request).toEqualTypeOf<
      Promise<
        Array<{
          name: string;
          value: string;
          domain: string;
          path: string;
          expires: number;
          httpOnly: boolean;
          secure: boolean;
          sameSite: "Strict" | "Lax" | "None";
        }>
      >
    >();
    await expect(request).resolves.toStrictEqual([
      {
        name: "session",
        value: "abc123",
        domain: "example.com",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    expect(cdp.sent).toContainEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "context.cookies",
      params: { urls: ["https://example.com/account"] },
    });
  });

  it("registers the pending request before CDP can return its response", async () => {
    const cdp = new FakeCDPTransport({
      page_id: "page-1",
      url: "https://example.com",
    });
    const client = new RPCClient(cdp);

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
    const client = new RPCClient(cdp);

    await expect(
      client.send(StagehandMethods.contextPages, { extra: true } as never),
    ).rejects.toThrow();

    expect(cdp.sent).toStrictEqual([]);
  });

  it("lets the worker request client work while the original SDK request is still pending", async () => {
    const cdp = new ManualCDPTransport();
    const client = new RPCClient(cdp);
    client.onRequest(UppercaseMethod, async ({ value }) => ({ value: value.toUpperCase() }));

    const originalRequest = client.send(StagehandMethods.contextPages, {});
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
      result: [],
    });
    await expect(originalRequest).resolves.toStrictEqual([]);
  });

  it("validates incoming request parameters before invoking the SDK handler", async () => {
    const cdp = new ManualCDPTransport();
    const client = new RPCClient(cdp);
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
    const client = new RPCClient(cdp);
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
    new RPCClient(cdp);

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
    const client = new RPCClient(cdp);
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
        message: "Client handler failed",
        data: { name: "Error" },
      },
    });
  });

  it("rejects a failed request with a plain Error that preserves the JSON-RPC failure", async () => {
    const cdp = new ManualCDPTransport();
    const client = new RPCClient(cdp);
    const request = client.send(StagehandMethods.contextPages, {});
    const rpcError = {
      code: JSONRPCErrorCodes.internalError,
      message: "Worker failed",
      data: { name: "Error" },
    };

    await cdp.receive({ jsonrpc: "2.0", id: 1, error: rpcError });

    await expect(request).rejects.toMatchObject({
      constructor: Error,
      message: "Worker failed",
      cause: rpcError,
    });
  });

  it("times out an ordinary JSON-RPC response after the internal grace period", async () => {
    vi.useFakeTimers();
    const cdp = new ManualCDPTransport();
    const client = new RPCClient(cdp);

    try {
      const request = client.send(StagehandMethods.contextPages, {});
      const rejection = expect(request).rejects.toThrow("RPC response timed out: context.pages");
      await vi.advanceTimersByTimeAsync(9_999);

      expect(client.pending.size).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await rejection;
      expect(client.pending.size).toBe(0);
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it.each([
    {
      name: "an Act operation timeout",
      method: StagehandMethods.stagehandAct,
      params: {
        pageId: "page-1",
        input: "click the button",
        options: { timeout: 30_000 },
      },
    },
    {
      name: "page.waitForTimeout",
      method: StagehandMethods.pageWaitForTimeout,
      params: { pageId: "page-1", ms: 30_000 },
    },
    {
      name: "a WebMCP result timeout",
      method: StagehandMethods.pageWebMCPInvocationResult,
      params: {
        pageId: "page-1",
        invocationId: "invocation-1",
        options: { timeout: 30_000 },
      },
    },
  ])("derives the JSON-RPC deadline from $name", async ({ method, params }) => {
    vi.useFakeTimers();
    const cdp = new ManualCDPTransport();
    const client = new RPCClient(cdp);

    try {
      const request = client.send(method, params);
      const rejection = expect(request).rejects.toThrow(`RPC response timed out: ${method.name}`);
      await vi.advanceTimersByTimeAsync(39_999);

      expect(client.pending.size).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await rejection;
      expect(client.pending.size).toBe(0);
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it("lets initialization RPCs inherit the outer lifecycle deadline", async () => {
    vi.useFakeTimers();
    const cdp = new ManualCDPTransport();
    const client = new RPCClient(cdp);
    const controller = new AbortController();

    try {
      const request = client.send(
        StagehandMethods.runtimeConfigure,
        {
          protocolVersion: STAGEHAND_PROTOCOL_VERSION,
          clientInfo: { name: "test-client", version: "1.0.0" },
          cdpUrl: "ws://cdp.test",
        },
        { signal: controller.signal },
      );
      const rejection = expect(request).rejects.toThrow("initialization deadline expired");
      await vi.advanceTimersByTimeAsync(60_000);

      expect(client.pending.size).toBe(1);
      controller.abort(new Error("initialization deadline expired"));
      await rejection;
      expect(client.pending.size).toBe(0);
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it("rejects pending requests when the client closes", async () => {
    const cdp = new ManualCDPTransport();
    const client = new RPCClient(cdp);
    const request = client.send(StagehandMethods.contextPages, {});
    const reason = new Error("transport closed");

    client.close(reason);

    await expect(request).rejects.toBe(reason);
    expect(client.pending.size).toBe(0);
  });

  it("removes incoming SDK request handlers when the RPC client closes", async () => {
    const cdp = new ManualCDPTransport();
    const client = new RPCClient(cdp);
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
