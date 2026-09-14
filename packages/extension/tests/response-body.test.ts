import type { Protocol } from "devtools-protocol";
import { describe, expect, it } from "vitest";
import type { CDPSessionLike } from "../understudy/cdp.js";
import type { Page } from "../understudy/page.js";
import { Response } from "../understudy/response.js";

class ResponseCDPSession implements CDPSessionLike {
  readonly id = "response-test";
  readonly calls: Array<{ method: string; params?: object }> = [];
  readonly handlers = new Map<string, Set<(params: unknown) => void>>();

  bodyResult: Protocol.Network.GetResponseBodyResponse = {
    body: "hello",
    base64Encoded: false,
  };
  bodyError: Error | null = null;

  async send<Result = unknown>(method: string, params?: object): Promise<Result> {
    this.calls.push({ method, params });
    if (method !== "Network.getResponseBody") return {} as Result;
    if (this.bodyError) throw this.bodyError;
    return this.bodyResult as Result;
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

  emit<Params>(event: string, params: Params): void {
    for (const handler of this.handlers.get(event) ?? []) handler(params);
  }

  callsFor(method: string): Array<{ method: string; params?: object }> {
    return this.calls.filter((call) => call.method === method);
  }
}

function createResponse(session: ResponseCDPSession): Response {
  return new Response({
    page: {} as Page,
    session,
    requestId: "request-1",
    frameId: "frame-1",
    loaderId: "loader-1",
    response: {
      url: "https://example.test/",
      status: 200,
      statusText: "OK",
      headers: { "content-type": "text/plain" },
      mimeType: "text/plain",
      charset: "utf-8",
      connectionReused: false,
      connectionId: 1,
      encodedDataLength: 0,
      securityState: "secure",
    },
    fromServiceWorker: false,
  });
}

function finish(session: ResponseCDPSession): void {
  session.emit<Protocol.Network.LoadingFinishedEvent>("Network.loadingFinished", {
    requestId: "request-1",
    timestamp: 1,
    encodedDataLength: 5,
  });
}

describe("Response body", () => {
  it("waits for loadingFinished before requesting the body", async () => {
    const session = new ResponseCDPSession();
    const response = createResponse(session);

    const bodyPromise = response.body();
    await Promise.resolve();

    expect(session.callsFor("Network.getResponseBody")).toHaveLength(0);

    finish(session);

    await expect(bodyPromise).resolves.toStrictEqual(new TextEncoder().encode("hello"));
    expect(session.callsFor("Network.getResponseBody")).toStrictEqual([
      {
        method: "Network.getResponseBody",
        params: { requestId: "request-1" },
      },
    ]);
  });

  it("shares one body promise across concurrent and repeated callers", async () => {
    const session = new ResponseCDPSession();
    const response = createResponse(session);

    const first = response.body();
    const second = response.body();
    expect(second).toBe(first);

    finish(session);

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    await expect(response.body()).resolves.toStrictEqual(new TextEncoder().encode("hello"));
    expect(session.callsFor("Network.getResponseBody")).toHaveLength(1);
  });

  it("decodes base64 bodies once for body, text, and json helpers", async () => {
    const session = new ResponseCDPSession();
    session.bodyResult = {
      body: "eyJvayI6dHJ1ZX0=",
      base64Encoded: true,
    };
    const response = createResponse(session);
    finish(session);

    await expect(response.body()).resolves.toStrictEqual(new TextEncoder().encode('{"ok":true}'));
    await expect(response.text()).resolves.toBe('{"ok":true}');
    await expect(response.json()).resolves.toStrictEqual({ ok: true });
    expect(session.callsFor("Network.getResponseBody")).toHaveLength(1);
  });

  it("caches loading and CDP failures", async () => {
    const loadingSession = new ResponseCDPSession();
    const loadingResponse = createResponse(loadingSession);
    const loadingBody = loadingResponse.body();

    loadingSession.emit<Protocol.Network.LoadingFailedEvent>("Network.loadingFailed", {
      requestId: "request-1",
      timestamp: 1,
      type: "Document",
      errorText: "net::ERR_FAILED",
      canceled: false,
    });

    await expect(loadingBody).rejects.toThrow("net::ERR_FAILED");
    expect(loadingResponse.body()).toBe(loadingBody);
    await expect(loadingResponse.body()).rejects.toThrow("net::ERR_FAILED");
    expect(loadingSession.callsFor("Network.getResponseBody")).toHaveLength(0);

    const cdpSession = new ResponseCDPSession();
    cdpSession.bodyError = new Error("body unavailable");
    const cdpResponse = createResponse(cdpSession);
    finish(cdpSession);

    const cdpBody = cdpResponse.body();
    await expect(cdpBody).rejects.toThrow("body unavailable");
    expect(cdpResponse.body()).toBe(cdpBody);
    await expect(cdpResponse.body()).rejects.toThrow("body unavailable");
    expect(cdpSession.callsFor("Network.getResponseBody")).toHaveLength(1);
  });

  it("stops listening after the response settles", async () => {
    const session = new ResponseCDPSession();
    const response = createResponse(session);

    expect(session.handlers.get("Network.loadingFinished")?.size).toBe(1);
    finish(session);

    await expect(response.finished()).resolves.toBeNull();
    expect(session.handlers.get("Network.responseReceivedExtraInfo")?.size).toBe(0);
    expect(session.handlers.get("Network.loadingFinished")?.size).toBe(0);
    expect(session.handlers.get("Network.loadingFailed")?.size).toBe(0);
  });
});
