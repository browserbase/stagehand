import type { Protocol } from "devtools-protocol";
import { describe, expect, it, vi } from "vitest";
import { StagehandRpcRequestSchema } from "@browserbasehq/stagehand-protocol/schema-registry";
import { RPCRouter } from "../rpcRouter.js";
import { createStagehandRuntime, type UnderstudyRuntimePage } from "../runtime.js";
import type { CDPSessionLike } from "../understudy/cdp.js";
import type { Page } from "../understudy/page.js";
import { Response } from "../understudy/response.js";

class ResponseRPCSession implements CDPSessionLike {
  readonly id = "response-rpc";
  readonly calls: Array<{ method: string; params?: object }> = [];
  readonly handlers = new Map<string, Set<(params: unknown) => void>>();

  async send<Result = unknown>(method: string, params?: object): Promise<Result> {
    this.calls.push({ method, params });
    if (method === "Network.getResponseBody") {
      return { body: "AP8=", base64Encoded: true } as Result;
    }
    return {} as Result;
  }

  on<Params = unknown>(event: string, handler: (params: Params) => void): void {
    const handlers = this.handlers.get(event) ?? new Set<(params: unknown) => void>();
    handlers.add(handler as (params: unknown) => void);
    this.handlers.set(event, handlers);
  }

  off<Params = unknown>(event: string, handler: (params: Params) => void): void {
    this.handlers.get(event)?.delete(handler as (params: unknown) => void);
  }

  async close(): Promise<void> {}
}

function createResponse(session = new ResponseRPCSession()): Response {
  return new Response({
    page: {} as Page,
    session,
    requestId: "cdp-request-1",
    frameId: "frame-1",
    loaderId: "loader-1",
    response: {
      url: "https://example.test/final",
      status: 201,
      statusText: "Created",
      headers: { "Content-Type": "application/octet-stream" },
      mimeType: "application/octet-stream",
      charset: "",
      connectionReused: false,
      connectionId: 1,
      encodedDataLength: 2,
      securityState: "secure",
      remoteIPAddress: "203.0.113.10",
      remotePort: 443,
      fromServiceWorker: true,
      securityDetails: {
        issuer: "Example CA",
        protocol: "TLS 1.3",
        subjectName: "example.test",
        validFrom: 1,
        validTo: 2,
      } as Protocol.Network.SecurityDetails,
    },
    fromServiceWorker: true,
  });
}

function createPage(response: Response | null): UnderstudyRuntimePage {
  return {
    targetId: () => "page-1",
    url: () => "https://example.test/final",
    goto: vi.fn(async () => response),
    reload: vi.fn(async () => response),
    goBack: vi.fn(async () => response),
    goForward: vi.fn(async () => response),
  } as unknown as UnderstudyRuntimePage;
}

describe("navigation response runtime", () => {
  it("returns an immediate descriptor for every navigation method", async () => {
    const runtime = createStagehandRuntime();
    const response = createResponse();
    const page = createPage(response);
    runtime.pagesById.set("page-1", page);

    const results = await Promise.all([
      runtime.pageGoto({ pageId: "page-1", url: "https://example.test/final" }),
      runtime.pageReload({ pageId: "page-1" }),
      runtime.pageGoBack({ pageId: "page-1" }),
      runtime.pageGoForward({ pageId: "page-1" }),
    ]);

    expect(runtime.responseHandles.size).toBe(4);
    for (const result of results) {
      expect(result.page).toStrictEqual({
        pageId: "page-1",
        url: "https://example.test/final",
      });
      expect(result.response).toMatchObject({
        url: "https://example.test/final",
        status: 201,
        statusText: "Created",
        headers: { "content-type": "application/octet-stream" },
        fromServiceWorker: true,
      });
      expect(result.response?.responseId).toBeTruthy();
      expect(result.response).not.toHaveProperty("requestId");
      expect(result.response).not.toHaveProperty("body");
    }
  });

  it("preserves null for navigations without a network response", async () => {
    const runtime = createStagehandRuntime();
    runtime.pagesById.set("page-1", createPage(null));

    await expect(
      runtime.pageGoto({ pageId: "page-1", url: "data:text/html,inline" }),
    ).resolves.toMatchObject({ response: null });
    await expect(runtime.pageReload({ pageId: "page-1" })).resolves.toMatchObject({
      response: null,
    });
    await expect(runtime.pageGoBack({ pageId: "page-1" })).resolves.toMatchObject({
      response: null,
    });
    await expect(runtime.pageGoForward({ pageId: "page-1" })).resolves.toMatchObject({
      response: null,
    });
    expect(runtime.responseHandles.size).toBe(0);
  });
});

describe("response RPC methods", () => {
  it("removes lifecycle listeners and settles pending work when disposed", async () => {
    const session = new ResponseRPCSession();
    const response = createResponse(session);
    const finished = response.finished();
    const body = expect(response.body()).rejects.toThrow("Response was disposed");

    expect([...session.handlers.values()].map((handlers) => handlers.size)).toStrictEqual([
      1, 1, 1,
    ]);

    response.dispose();

    await expect(finished).resolves.toMatchObject({ message: "Response was disposed" });
    await body;
    expect(session.calls).not.toContainEqual({
      method: "Network.getResponseBody",
      params: { requestId: "cdp-request-1" },
    });
    expect([...session.handlers.values()].map((handlers) => handlers.size)).toStrictEqual([
      0, 0, 0,
    ]);

    response.dispose();
    expect([...session.handlers.values()].map((handlers) => handlers.size)).toStrictEqual([
      0, 0, 0,
    ]);
  });

  it("routes lazy response operations through the opaque handle", async () => {
    const runtime = createStagehandRuntime();
    const response = createResponse();
    const responseId = runtime.responseHandles.register("page-1", response);
    const router = new RPCRouter(runtime);

    response.applyExtraInfo({
      requestId: "cdp-request-1",
      blockedCookies: [],
      headers: {
        "Content-Type": "application/octet-stream",
        "Set-Cookie": "session=abc",
      },
      resourceIPAddressSpace: "Public",
      statusCode: 201,
      headersText:
        "HTTP/1.1 201 Created\r\nContent-Type: application/octet-stream\r\nSet-Cookie: session=abc\r\n",
    });
    response.markFinished(null);

    await expect(call(router, "response.body", responseId)).resolves.toStrictEqual({
      body: "AP8=",
      base64Encoded: true,
    });
    await expect(call(router, "response.all_headers", responseId)).resolves.toStrictEqual({
      headers: {
        "Content-Type": "application/octet-stream",
        "Set-Cookie": "session=abc",
      },
    });
    await expect(call(router, "response.headers_array", responseId)).resolves.toStrictEqual({
      headers: [
        { name: "Content-Type", value: "application/octet-stream" },
        { name: "Set-Cookie", value: "session=abc" },
      ],
    });
    await expect(call(router, "response.security_details", responseId)).resolves.toStrictEqual({
      value: {
        issuer: "Example CA",
        protocol: "TLS 1.3",
        subjectName: "example.test",
        validFrom: 1,
        validTo: 2,
      },
    });
    await expect(call(router, "response.server_addr", responseId)).resolves.toStrictEqual({
      value: { ipAddress: "203.0.113.10", port: 443 },
    });
    await expect(call(router, "response.finished", responseId)).resolves.toStrictEqual({
      error: null,
    });
  });

  it("surfaces response failures and unknown handles", async () => {
    const runtime = createStagehandRuntime();
    const response = createResponse();
    const responseId = runtime.responseHandles.register("page-1", response);
    const router = new RPCRouter(runtime);
    response.markFinished(new Error("net::ERR_FAILED"));

    await expect(call(router, "response.finished", responseId)).resolves.toStrictEqual({
      error: { message: "net::ERR_FAILED" },
    });
    await expect(call(router, "response.body", responseId)).rejects.toThrow("net::ERR_FAILED");
    await expect(call(router, "response.body", "missing-response")).rejects.toThrow(
      'Response handle "missing-response" is unavailable',
    );
  });
});

async function call(
  router: RPCRouter,
  method:
    | "response.body"
    | "response.all_headers"
    | "response.headers_array"
    | "response.security_details"
    | "response.server_addr"
    | "response.finished",
  responseId: string,
): Promise<unknown> {
  const request = StagehandRpcRequestSchema.parse({
    jsonrpc: "2.0",
    id: 1,
    method,
    params: { response_id: responseId },
  });
  return await router.handle(request);
}
