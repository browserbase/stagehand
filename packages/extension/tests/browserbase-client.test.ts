import { createOpenAI } from "@ai-sdk/openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeWireValue } from "@browserbasehq/stagehand-protocol/json-rpc/wire-casing";
import { JSONRPCMessageSchema } from "@browserbasehq/stagehand-protocol/json-rpc/schemas";
import { STAGEHAND_SEND_TO_HOST_BINDING } from "@browserbasehq/stagehand-protocol/schema-registry";
import { LLMGenerateParamsSchema } from "@browserbasehq/stagehand-protocol/schemas";
import type {
  BrowserbaseRequestParams,
  BrowserbaseHttpResponse,
  BrowserbaseTransportError,
} from "@browserbasehq/stagehand-protocol/types";
import { requestBrowserbase } from "../clients/browserbaseClient.js";
import { ChromeRuntimeClient } from "../clients/chromeRuntimeClient.js";
import { RPCClient } from "../clients/rpcClient.js";
import { RPCRouter } from "../rpcRouter.js";
import { createStagehandRuntime } from "../runtime.js";
import {
  startStagehandServiceWorker,
  type StagehandServiceWorkerScope,
} from "../service-worker.js";
import { generateWithAiSdk } from "../llm/aiSdkClient.js";

import fixtures from "../../../tests/fixtures/browserbase-transport.json" with { type: "json" };

const params: BrowserbaseRequestParams = {
  operation: "gateway.responses",
  headers: { "x-test": "value" },
  body: '{ "input": "héllo" }',
};
const ok: BrowserbaseHttpResponse = {
  type: "response",
  status: 200,
  statusText: "OK",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(fixtures.gateway.response),
};
const clients: RPCClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setup(reply: () => unknown = () => ok) {
  const messages: ReturnType<typeof JSONRPCMessageSchema.parse>[] = [];
  const transport = new ChromeRuntimeClient(
    {
      send(payload: string) {
        const message = JSONRPCMessageSchema.parse(JSON.parse(payload));
        messages.push(message);
        if (!("method" in message) || !("id" in message)) return;
        const result = reply();
        if (result !== undefined)
          void transport.receive(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: encodeWireValue(result),
            }),
          );
      },
    },
    "send",
  );
  const client = new RPCClient(transport, new RPCRouter(createStagehandRuntime()));
  clients.push(client);
  return { client, transport, messages };
}

function generate(client: RPCClient) {
  const provider = createOpenAI({
    apiKey: "fixture",
    fetch: async (_url, init) =>
      requestBrowserbase(
        client,
        {
          operation: "gateway.responses",
          headers: Object.fromEntries(new Headers(init?.headers)),
          body: String(init?.body ?? ""),
        },
        init?.signal ?? undefined,
      ),
  });
  return generateWithAiSdk(
    provider.responses("gpt-5"),
    LLMGenerateParamsSchema.parse(fixtures.gateway.input),
  );
}

describe("worker Browserbase response adapter", () => {
  it.each(["gateway.responses", "cache.get", "cache.set"] as const)(
    "sends only the fixed %s operation and preserves body/header casing",
    async (operation) => {
      const { client, messages } = setup();
      const response = await requestBrowserbase(client, {
        ...params,
        operation,
        remainingTimeoutMs: 123.5,
      });
      expect(messages).toMatchObject([
        {
          method: "browserbase.request",
          params: {
            operation,
            body: params.body,
            headers: params.headers,
            remaining_timeout_ms: 123.5,
          },
        },
      ]);
      expect(await response.text()).toBe(ok.body);
    },
  );

  it.each(fixtures.httpFailures)(
    "reconstructs $name without parsing or retrying it",
    async (reply) => {
      const { client, messages } = setup(() => ({
        type: "response",
        status: reply.status,
        statusText: "Fixture status",
        headers: reply.headers,
        body: reply.body,
      }));
      const response = await requestBrowserbase(client, params);
      expect(response.status).toBe(reply.status);
      expect(response.statusText).toBe("Fixture status");
      expect(Object.fromEntries(response.headers)).toEqual(reply.headers);
      expect(await response.text()).toBe(reply.body);
      expect(messages).toHaveLength(1);
    },
  );

  it.each([200, 204, 205, 304])("handles empty status %i responses", async (status) => {
    const { client } = setup(() => ({
      type: "response",
      status,
      statusText: "",
      headers: {},
      body: "",
    }));
    const response = await requestBrowserbase(client, params);
    expect(response.status).toBe(status);
    expect(response.body === null).toBe(status !== 200);
    expect(await response.text()).toBe("");
    expect([...response.headers]).toEqual([]);
  });

  it("reconstructs byte-preserving response headers after the RPC round trip", async () => {
    const { normalized: headers, body } = fixtures.responseHeaders;
    const { client } = setup(() => ({ ...ok, headers, body }));
    const response = await requestBrowserbase(client, params);
    expect(Object.fromEntries(response.headers)).toEqual(headers);
    expect(await response.text()).toBe(body);
  });

  it("preserves a large Unicode response as text", async () => {
    const body = "héllo 🌎".repeat(100_000);
    const { client } = setup(() => ({
      ...ok,
      body,
      headers: { "content-type": "text/plain; charset=latin-1" },
    }));
    expect(await (await requestBrowserbase(client, params)).text()).toBe(body);
  });

  it.each(["cancelled", "timeout"] as const)(
    "notifies %s using the original request ID",
    async (reason) => {
      const { client, messages } = setup(() => undefined);
      const controller = new AbortController();
      const pending = requestBrowserbase(client, params, controller.signal);
      const name = reason === "timeout" ? "TimeoutError" : "AbortError";
      controller.abort(new DOMException("stop", name));
      await expect(pending).rejects.toMatchObject({ name });
      expect(messages).toMatchObject([
        { id: 1, method: "browserbase.request" },
        { method: "browserbase.cancel", params: { request_id: 1, reason } },
      ]);
      expect(client.pending.size).toBe(0);
    },
  );

  it("does not send an already aborted request, including arbitrary abort reasons", async () => {
    const { client, messages } = setup();
    const signal = AbortSignal.abort(new TypeError("fetch failed", { cause: new Error("stop") }));
    await expect(requestBrowserbase(client, params, signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(messages).toEqual([]);
  });

  it("rejects malformed RPC results rather than producing an HTTP response", async () => {
    const { client } = setup(() => ({ ...ok, status: 99 }));
    await expect(requestBrowserbase(client, params)).rejects.toThrow(
      "Browserbase RPC request failed",
    );
    expect(client.pending.size).toBe(0);
  });

  it("settles a disconnected request without waiting for a response", async () => {
    const { client } = setup(() => undefined);
    const pending = requestBrowserbase(client, params);
    client.close(new Error("connection lost"));
    await expect(pending).rejects.toThrow("Browserbase connection is disconnected");
    expect(client.pending.size).toBe(0);
  });

  it("wires the adapter through the existing worker connection", async () => {
    const scope: StagehandServiceWorkerScope & {
      [STAGEHAND_SEND_TO_HOST_BINDING](payload: string): void;
    } = {
      [STAGEHAND_SEND_TO_HOST_BINDING](payload: string) {
        const request = JSON.parse(payload) as { id: number };
        client.receiveResponse({
          jsonrpc: "2.0",
          id: request.id,
          result: encodeWireValue(ok),
        });
      },
    };
    const client = startStagehandServiceWorker(scope);
    clients.push(client);
    const response = await client.router.runtime.adapters.clientBrowserbaseRequest(params);
    expect(await response.text()).toBe(ok.body);
  });

  it("reports an unavailable adapter when one has not been installed", async () => {
    await expect(
      createStagehandRuntime().adapters.clientBrowserbaseRequest(params),
    ).rejects.toThrow("did not register a Browserbase transport");
  });
});

describe("Browserbase adapter AI SDK error handling", () => {
  it.each(["network", "cancelled", "timeout", "unavailable", "disconnected"] as const)(
    "keeps retry ownership with AI SDK for %s",
    async (reason) => {
      vi.useFakeTimers();
      const failure: BrowserbaseTransportError = {
        type: "error",
        reason,
        message: "fixture failure",
      };
      const { client, messages } = setup(() => failure);
      const result = generate(client).catch((error: unknown) => error);
      await vi.runAllTimersAsync();
      const error = await result;
      expect(messages).toHaveLength(reason === "network" ? 3 : 1);
      if (reason === "network")
        expect(error).toMatchObject({
          reason: "maxRetriesExceeded",
          lastError: { isRetryable: true },
        });
      else expect(error).toBeInstanceOf(Error);
    },
  );

  it.each(["send", "disconnect", "invalid result"])(
    "does not treat RPC %s failure as an upstream network failure",
    async (mode) => {
      vi.useFakeTimers();
      const error = Object.assign(
        new TypeError("fetch failed", { cause: new Error("connection reset") }),
        { code: "ECONNRESET" },
      );
      const { client, messages } = setup(() => {
        if (mode === "send") throw error;
        if (mode === "disconnect") {
          client.close(error);
          return undefined;
        }
        return { type: "invalid" };
      });
      const result = generate(client).catch((error: unknown) => error);
      await vi.runAllTimersAsync();
      expect(await result).toBeInstanceOf(Error);
      expect(messages).toHaveLength(1);
    },
  );
});
