import type { Server, ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { JSONRPCRequestSchema } from "@browserbasehq/stagehand-protocol/json-rpc/schemas";
import type { JSONRPCMessage } from "@browserbasehq/stagehand-protocol/json-rpc/types";
import {
  StagehandMethods,
  StagehandNotifications,
} from "@browserbasehq/stagehand-protocol/schema-registry";
import { encodeWireValue } from "@browserbasehq/stagehand-protocol/json-rpc/wire-casing";
import { LLMGenerateResultSchema } from "@browserbasehq/stagehand-protocol/schemas";
import type { BrowserbaseRequestParams } from "@browserbasehq/stagehand-protocol/types";
import fixtures from "../../../tests/fixtures/browserbase-transport.json" with { type: "json" };
import type { BrowserbaseConnection } from "../src/browserbaseConnection.js";
import { registerBrowserbaseTransport } from "../src/browserbaseRpc.js";
import { CDPClient } from "../src/cdpClient.js";
import { Stagehand } from "../src/stagehand.js";
import { createBrowserFactoriesForTest } from "../src/browser/factories.js";
import { RPCClient, type CDPTransport } from "../src/rpcClient.js";
import { createHttpTestServer, listen, close, type CapturedRequest } from "./helpers/httpServer.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class Transport implements CDPTransport {
  readonly serviceWorker = {
    targetId: "worker",
    url: "chrome-extension://test/service-worker.js",
    title: "Stagehand",
    extensionId: "test",
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
  close = vi.fn();
}

type Received = CapturedRequest & { response: ServerResponse };
function hold() {
  return { arrived: deferred<Received>(), closed: deferred<void>() };
}
let server: Server;
let connection: BrowserbaseConnection;
const holds = new Map<string, ReturnType<typeof hold>>();
const clients: RPCClient[] = [];
const requests: Received[] = [];

function setup(settings: BrowserbaseConnection | undefined = connection) {
  const transport = new Transport();
  const client = new RPCClient(transport);
  clients.push(client);
  const dispose = registerBrowserbaseTransport(client, settings);
  return { transport, client, dispose };
}
function request(
  id: number,
  label: string,
  overrides: Partial<BrowserbaseRequestParams> = {},
): JSONRPCMessage {
  return JSONRPCRequestSchema.parse({
    jsonrpc: "2.0",
    id,
    method: StagehandMethods.browserbaseRequest.name,
    params: encodeWireValue({
      operation: "gateway.responses",
      headers: { "x-test-request": label },
      body: JSON.stringify(fixtures.gateway.requestInput),
      ...overrides,
    }),
  });
}
function cancel(id: number, reason: "cancelled" | "timeout" = "cancelled"): JSONRPCMessage {
  return {
    jsonrpc: "2.0",
    method: StagehandNotifications.browserbaseCancel.name,
    params: { request_id: id, reason },
  };
}

beforeAll(async () => {
  server = createHttpTestServer((request, response) => {
    const received = { ...request, response };
    requests.push(received);
    const gate = holds.get(String(request.headers["x-test-request"]));
    if (gate) {
      response.once("close", () => gate.closed.resolve());
      response.writeHead(200, { "content-type": "application/json" });
      response.write(" ");
      gate.arrived.resolve(received);
    } else {
      response.end(JSON.stringify(fixtures.gateway.response));
    }
  });
  connection = { ...fixtures.connection, apiUrl: `${await listen(server)}/services/v1` };
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.close());
  holds.clear();
  requests.length = 0;
  vi.restoreAllMocks();
});
afterAll(() => close(server));

describe("Browserbase reverse RPC lifecycle", () => {
  it("serves a reverse request while an SDK request with the same ID is pending", async () => {
    const { client, transport } = setup();
    const original = client.send(StagehandMethods.contextPages, {});
    await transport.receive(request(1, "nested"));
    expect(transport.sent).toContainEqual({
      jsonrpc: "2.0",
      id: 1,
      result: expect.objectContaining({
        type: "response",
        status: 200,
        status_text: "OK",
        body: JSON.stringify(fixtures.gateway.response),
      }),
    });
    expect(client.pending.size).toBe(1);
    expect(requests[0]).toMatchObject({
      url: "/services/v1/llm/responses",
      headers: { "x-bb-api-key": connection.apiKey, "x-bb-session-id": connection.sessionId },
    });
    await transport.receive({ jsonrpc: "2.0", id: 1, result: [] });
    await expect(original).resolves.toEqual([]);
  });

  it.each(["cancelled", "timeout"] as const)(
    "applies %s to one concurrent request only",
    async (reason) => {
      const { transport, client } = setup();
      const first = hold();
      const second = hold();
      holds.set("first", first);
      holds.set("second", second);
      const pendingFirst = transport.receive(request(7, "first"));
      const pendingSecond = transport.receive(request(8, "second", { operation: "cache.get" }));
      await Promise.all([first.arrived.promise, second.arrived.promise]);
      await transport.receive(cancel(7, reason));
      await Promise.all([pendingFirst, first.closed.promise]);
      expect(transport.sent).toContainEqual({
        jsonrpc: "2.0",
        id: 7,
        result: expect.objectContaining({ type: "error", reason }),
      });
      expect(transport.sent).not.toContainEqual(expect.objectContaining({ id: 8 }));
      const received = await second.arrived.promise;
      received.response.end('{"success":true}');
      await pendingSecond;
      expect(transport.sent).toContainEqual({
        jsonrpc: "2.0",
        id: 8,
        result: expect.objectContaining({ type: "response", body: ' {"success":true}' }),
      });
      expect(client.closed).toBe(false);
      expect(transport.close).not.toHaveBeenCalled();
    },
  );

  it("keeps matching IDs on separate connections independent", async () => {
    const first = setup();
    const second = setup({ ...connection, apiKey: "bb-second", sessionId: "session-second" });
    const a = hold();
    const b = hold();
    holds.set("a", a);
    holds.set("b", b);
    const pendingA = first.transport.receive(request(4, "a"));
    const pendingB = second.transport.receive(request(4, "b"));
    const [receivedA, receivedB] = await Promise.all([a.arrived.promise, b.arrived.promise]);
    expect(receivedA.headers["x-bb-api-key"]).toBe(connection.apiKey);
    expect(receivedB.headers).toMatchObject({
      "x-bb-api-key": "bb-second",
      "x-bb-session-id": "session-second",
    });
    await first.transport.receive(cancel(4));
    await pendingA;
    expect(second.transport.sent).toEqual([]);
    receivedB.response.end("{}");
    await pendingB;
    expect(second.transport.sent).toContainEqual({
      jsonrpc: "2.0",
      id: 4,
      result: expect.objectContaining({ type: "response" }),
    });
  });

  it("forwards the remaining budget through body buffering", async () => {
    const { transport } = setup();
    const gate = hold();
    holds.set("budget", gate);
    await transport.receive(request(9, "budget", { remainingTimeoutMs: 200 }));
    await gate.closed.promise;
    expect(transport.sent).toContainEqual({
      jsonrpc: "2.0",
      id: 9,
      result: expect.objectContaining({ type: "error", reason: "timeout" }),
    });
    expect(requests).toHaveLength(1);
  });

  it.each(["close", "disconnect", "error", "detach"])(
    "aborts HTTP on %s and sends no late reply",
    async (mode) => {
      const { client, transport } = setup();
      const gate = hold();
      holds.set("closing", gate);
      const original = client.send(StagehandMethods.contextPages, {});
      const rejected = expect(original).rejects.toThrow("connection ended");
      const incoming = transport.receive(request(55, "closing"));
      await gate.arrived.promise;
      const reason = new Error("connection ended");
      if (mode === "disconnect") transport.onclose?.(reason);
      else if (mode === "error") transport.onerror?.(reason);
      else client.close(reason, { closeTransport: mode !== "detach" });
      await Promise.all([incoming, rejected, gate.closed.promise]);
      expect(transport.sent).toHaveLength(1);
      expect(client.pending.size).toBe(0);
      expect(client.requestHandlers.size).toBe(0);
      expect(client.notificationListeners.size).toBe(0);
      expect(transport.close).toHaveBeenCalledTimes(mode === "detach" ? 0 : 1);
      await client.receive({ jsonrpc: "2.0", id: 1, result: [] });
      await client.receive(cancel(55));
      expect(transport.sent).toHaveLength(1);
    },
  );

  it.each(["browser", "context"] as const)(
    "aborts HTTP when %s closes without a socket-close event",
    async (mode) => {
      const socket = Object.assign(new EventTarget(), { close: vi.fn() });
      const cdp = new CDPClient(socket as unknown as WebSocket, "ws://localhost/test");
      cdp.attachedServiceWorker = new Transport().serviceWorker;
      const sent = vi.spyOn(cdp, "send").mockImplementation(async (message) => {
        if ("method" in message && message.method === "stagehand.init" && "id" in message) {
          await cdp.onmessage?.({
            jsonrpc: "2.0",
            id: message.id,
            result: { initialized: true, pages: [] },
          });
        }
      });
      const { browserbase } = createBrowserFactoriesForTest({
        connectCdp: async () => cdp,
        createBrowserbaseSessionClient: () => ({
          createSession: vi.fn(),
          connectSession: async () => ({
            sessionId: connection.sessionId,
            cdpUrl: cdp.webSocketDebuggerUrl,
            close: vi.fn(),
          }),
        }),
      });
      const browser = await browserbase.connect({
        apiKey: connection.apiKey,
        sessionId: connection.sessionId,
      });
      try {
        const stagehand = await Stagehand.create({
          browser,
          apiUrl: new URL(connection.apiUrl).origin,
        });
        const client = stagehand.rpcClient!;
        clients.push(client);
        const context = browser.context;
        const gate = hold();
        holds.set("browser-close", gate);
        const original = client.send(StagehandMethods.contextPages, {});
        const rejected = expect(original).rejects.toThrow("CDP client closed");
        const incoming = cdp.onmessage?.(request(55, "browser-close"));
        const received = await gate.arrived.promise;
        await (mode === "browser" ? browser.close() : context.close());
        expect(client.closed).toBe(true);
        await Promise.all([incoming, rejected, gate.closed.promise]);
        expect(client.pending.size).toBe(0);
        expect(client.requestHandlers.size).toBe(0);
        expect(client.notificationListeners.size).toBe(0);
        received.response.end("{}");
        await client.receive({ jsonrpc: "2.0", id: 2, result: [] });
        await Promise.all([browser.close(), context.close()]);
        expect(socket.close).toHaveBeenCalledOnce();
        expect(sent.mock.calls.map(([message]) => message)).toEqual([
          expect.objectContaining({ method: "stagehand.init" }),
          expect.objectContaining({ method: "context.pages" }),
        ]);
      } finally {
        await browser.close();
      }
    },
  );

  it("disposes active HTTP work and removes registrations without closing RPC", async () => {
    const { client, transport, dispose } = setup();
    const gate = hold();
    holds.set("disposing", gate);
    const incoming = transport.receive(request(5, "disposing"));
    await gate.arrived.promise;
    dispose();
    dispose();
    await Promise.all([incoming, gate.closed.promise]);
    expect(transport.sent).toContainEqual({
      jsonrpc: "2.0",
      id: 5,
      result: expect.objectContaining({ type: "error", reason: "cancelled" }),
    });
    expect(client.requestHandlers.has(StagehandMethods.browserbaseRequest.name)).toBe(false);
    expect(client.notificationListeners.size).toBe(0);
    expect(client.closed).toBe(false);
    await transport.receive(request(6, "unregistered"));
    expect(transport.sent).toContainEqual({
      jsonrpc: "2.0",
      id: 6,
      error: { code: -32601, message: "Method not found" },
    });
    expect(requests).toHaveLength(1);
  });

  it.each(["completed", "failed"])(
    "ignores late cancellations and releases %s request controllers",
    async (outcome) => {
      const originalFetch = globalThis.fetch;
      const signals: AbortSignal[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        if (init?.signal) signals.push(init.signal);
        return originalFetch(input, init);
      });
      const { transport, dispose } = setup();
      await transport.receive(cancel(12));
      const gate = hold();
      if (outcome === "failed") holds.set("cleanup", gate);
      const incoming = transport.receive(request(12, "cleanup"));
      if (outcome === "failed") (await gate.arrived.promise).response.destroy();
      await incoming;
      await transport.receive(cancel(12));
      dispose();
      expect(signals).toHaveLength(1);
      expect(signals[0].aborted).toBe(false);
      expect(transport.sent).toHaveLength(1);
    },
  );

  it("returns a transport failure for an unavailable connection", async () => {
    const transport = new Transport();
    const client = new RPCClient(transport);
    clients.push(client);
    registerBrowserbaseTransport(client, undefined);
    await transport.receive(request(2, "unavailable"));
    expect(transport.sent).toContainEqual({
      jsonrpc: "2.0",
      id: 2,
      result: expect.objectContaining({ type: "error", reason: "unavailable" }),
    });
    expect(requests).toHaveLength(0);
  });

  it("validates reverse request parameters before executing HTTP", async () => {
    const { transport } = setup();
    await transport.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "browserbase.request",
      params: { operation: "arbitrary", headers: {}, body: "{}" },
    });
    expect(transport.sent).toContainEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32602, message: "Invalid params" },
    });
    expect(requests).toHaveLength(0);
  });

  it("preserves existing one-argument custom LLM handlers", async () => {
    const { client, transport, dispose } = setup();
    const result = deferred<ReturnType<typeof LLMGenerateResultSchema.parse>>();
    const generate = vi.fn(async (_params: unknown) => result.promise);
    client.onRequest(StagehandMethods.llmGenerate, (params) => generate(params));
    const incoming = transport.receive(
      JSONRPCRequestSchema.parse({
        jsonrpc: "2.0",
        id: 18,
        method: StagehandMethods.llmGenerate.name,
        params: encodeWireValue(fixtures.gateway.input),
      }),
    );
    await transport.receive(cancel(18));
    dispose();
    result.resolve(LLMGenerateResultSchema.parse(fixtures.gateway.result));
    await incoming;
    expect(generate).toHaveBeenCalledWith(fixtures.gateway.input);
    expect(transport.sent).toContainEqual({
      jsonrpc: "2.0",
      id: 18,
      result: encodeWireValue(fixtures.gateway.result),
    });
    expect(client.requestHandlers.has(StagehandMethods.llmGenerate.name)).toBe(true);
  });
});
