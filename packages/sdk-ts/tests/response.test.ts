import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod/v4";
import type { RPCMethod } from "../../protocol/json-rpc/schemas.js";
import { StagehandMethods } from "../../protocol/schema-registry.js";
import type { NavigationResponseDescriptor } from "../../protocol/types.js";
import { Page, Response } from "../src/index.js";
import { RPCClient } from "../src/rpcClient.js";

class FakeResponseClient extends RPCClient {
  readonly calls: Array<{ method: string; params: unknown }> = [];
  readonly responses = new Map<string, unknown[]>();

  constructor() {
    super(
      {
        serviceWorker: {
          targetId: "worker-target",
          url: "chrome-extension://stagehand/service-worker.js",
          title: "Stagehand",
          extensionId: "stagehand",
        },
        send: async () => {},
        close: () => {},
      },
      1_000,
    );
  }

  queue<Method extends RPCMethod>(
    method: Method,
    response: z.input<Method["result"]> | Error,
  ): void {
    const responses = this.responses.get(method.name) ?? [];
    responses.push(response);
    this.responses.set(method.name, responses);
  }

  async send<Method extends RPCMethod>(
    method: Method,
    params: z.input<Method["params"]>,
  ): Promise<z.output<Method["result"]>> {
    this.calls.push({ method: method.name, params });
    const response = this.responses.get(method.name)?.shift();
    if (response === undefined) throw new Error(`No fake response queued for ${method.name}`);
    if (response instanceof Error) throw response;
    return method.result.parse(response) as z.output<Method["result"]>;
  }
}

const descriptor: NavigationResponseDescriptor = {
  responseId: "response-1",
  url: "https://example.test/final",
  status: 201,
  statusText: "Created",
  headers: { "content-type": "application/json" },
  fromServiceWorker: true,
};

describe("TypeScript Response", () => {
  it("exposes immediate metadata locally with defensive header copies", () => {
    const client = new FakeResponseClient();
    const response = new Response(client, descriptor);

    expect(response.url()).toBe("https://example.test/final");
    expect(response.status()).toBe(201);
    expect(response.statusText()).toBe("Created");
    expect(response.ok()).toBe(true);
    expect(response.fromServiceWorker()).toBe(true);

    const headers = response.headers();
    headers["content-type"] = "mutated";
    expect(response.headers()).toStrictEqual({ "content-type": "application/json" });
    expect(client.calls).toStrictEqual([]);
  });

  it("retrieves headers and connection metadata lazily", async () => {
    const client = new FakeResponseClient();
    const response = new Response(client, descriptor);
    const headerArray = {
      headers: [
        { name: "Set-Cookie", value: "first=1" },
        { name: "set-cookie", value: "second=2" },
      ],
    };
    client.queue(StagehandMethods.responseAllHeaders, {
      headers: { "Content-Type": "application/json", "Set-Cookie": "first=1\nsecond=2" },
    });
    client.queue(StagehandMethods.responseHeadersArray, headerArray);
    client.queue(StagehandMethods.responseHeadersArray, headerArray);
    client.queue(StagehandMethods.responseHeadersArray, headerArray);
    client.queue(StagehandMethods.responseSecurityDetails, {
      value: {
        issuer: "Example CA",
        protocol: "TLS 1.3",
        subjectName: "example.test",
        validFrom: 1,
        validTo: 2,
      },
    });
    client.queue(StagehandMethods.responseServerAddr, {
      value: { ipAddress: "203.0.113.10", port: 443 },
    });

    await expect(response.allHeaders()).resolves.toStrictEqual({
      "Content-Type": "application/json",
      "Set-Cookie": "first=1\nsecond=2",
    });
    const headers = await response.headersArray();
    headers[0]!.value = "mutated";
    await expect(response.headerValue("SET-cookie")).resolves.toBe("first=1, second=2");
    await expect(response.headerValues("set-COOKIE")).resolves.toStrictEqual([
      "first=1",
      "second=2",
    ]);
    await expect(response.securityDetails()).resolves.toStrictEqual({
      issuer: "Example CA",
      protocol: "TLS 1.3",
      subjectName: "example.test",
      validFrom: 1,
      validTo: 2,
    });
    await expect(response.serverAddr()).resolves.toStrictEqual({
      ipAddress: "203.0.113.10",
      port: 443,
    });

    expect(client.calls.map((call) => call.method)).toStrictEqual([
      "response.all_headers",
      "response.headers_array",
      "response.headers_array",
      "response.headers_array",
      "response.security_details",
      "response.server_addr",
    ]);
    expect(
      client.calls.every(
        (call) => (call.params as { responseId?: string }).responseId === "response-1",
      ),
    ).toBe(true);
  });

  it("decodes body, text, and JSON through independent RPC calls", async () => {
    const client = new FakeResponseClient();
    const response = new Response(client, descriptor);
    for (let index = 0; index < 3; index += 1) {
      client.queue(StagehandMethods.responseBody, {
        body: "eyJvayI6dHJ1ZX0=",
        base64Encoded: true,
      });
    }

    await expect(response.body()).resolves.toStrictEqual(new TextEncoder().encode('{"ok":true}'));
    await expect(response.text()).resolves.toBe('{"ok":true}');
    await expect(response.json<{ ok: boolean }>()).resolves.toStrictEqual({ ok: true });
    expect(client.calls.map((call) => call.method)).toStrictEqual([
      "response.body",
      "response.body",
      "response.body",
    ]);
  });

  it("surfaces finished failures, transport errors, and malformed bodies", async () => {
    const client = new FakeResponseClient();
    const response = new Response(client, descriptor);
    client.queue(StagehandMethods.responseFinished, {
      error: { message: "net::ERR_FAILED" },
    });
    client.queue(StagehandMethods.responseBody, {
      body: "%%%",
      base64Encoded: true,
    });
    client.queue(StagehandMethods.responseAllHeaders, new Error("handle unavailable"));

    const finishedError = await response.finished();
    expect(finishedError).toBeInstanceOf(Error);
    expect(finishedError?.message).toBe("net::ERR_FAILED");
    await expect(response.body()).rejects.toThrow("response.body returned invalid base64");
    await expect(response.allHeaders()).rejects.toThrow("handle unavailable");
  });

  it("declares navigation methods as nullable response promises", () => {
    expectTypeOf<Page["goto"]>().returns.toEqualTypeOf<Promise<Response | null>>();
    expectTypeOf<Page["reload"]>().returns.toEqualTypeOf<Promise<Response | null>>();
    expectTypeOf<Page["goBack"]>().returns.toEqualTypeOf<Promise<Response | null>>();
    expectTypeOf<Page["goForward"]>().returns.toEqualTypeOf<Promise<Response | null>>();
  });
});
