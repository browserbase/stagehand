import { describe, expect, it, vi } from "vitest";
import { StagehandRpcRequestSchema } from "@browserbasehq/stagehand-protocol/schema-registry";
import type { PageEventNotification } from "@browserbasehq/stagehand-protocol/types";
import { RPCRouter } from "../rpcRouter.js";
import type { StagehandLogger } from "../logger.js";
import { createStagehandRuntime } from "../runtime.js";
import type { CDPSessionLike, CdpConnection } from "../understudy/cdp.js";
import { Page } from "../understudy/page.js";
import type { Response } from "../understudy/response.js";

class Session implements CDPSessionLike {
  readonly handlers = new Map<string, Set<(value: unknown) => void>>();
  readonly sendCall = vi.fn(async (method: string) =>
    method === "Network.getResponseBody" ? { body: '{"ok":true}', base64Encoded: false } : {},
  );
  async send<R = unknown>(method: string): Promise<R> {
    return (await this.sendCall(method)) as R;
  }
  constructor(readonly id: string) {}
  on<T>(event: string, handler: (value: T) => void) {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler as (value: unknown) => void);
    this.handlers.set(event, handlers);
  }
  off<T>(event: string, handler: (value: T) => void) {
    this.handlers.get(event)?.delete(handler as (value: unknown) => void);
  }
  emit(event: string, value: unknown) {
    for (const listener of this.handlers.get(event) ?? []) listener(value);
  }
  async close() {}
}

function setup() {
  const session = new Session("main");
  const page = new Page(
    { targetIdForSession: () => "page" } as unknown as CdpConnection,
    session as unknown as CDPSessionLike,
    "page",
    "main-frame",
    { error: vi.fn() } as unknown as StagehandLogger,
  );
  return { page, session };
}
function headers(session: Session, requestId = "request") {
  session.emit("Network.responseReceived", {
    requestId,
    loaderId: "loader",
    frameId: "frame",
    type: "Fetch",
    response: {
      url: "https://example.test/api",
      status: 200,
      statusText: "OK",
      headers: { "Content-Type": "application/json" },
      fromServiceWorker: false,
    },
  });
}

describe("page response events", () => {
  it("shares live responses and reads bodies lazily after completion, even after unsubscribe", async () => {
    const { page, session } = setup();
    const first: Response[] = [],
      second: Response[] = [];
    headers(session); // No replay.
    const unsubscribe = await page.subscribeResponse((response) => first.push(response));
    await page.subscribeResponse((response) => second.push(response));
    expect(first).toHaveLength(0);
    headers(session);
    expect(first).toHaveLength(1);
    expect(second[0]).toBe(first[0]);
    const body = first[0]!.json();
    expect(session.sendCall).not.toHaveBeenCalledWith("Network.getResponseBody");
    unsubscribe();
    session.emit("Network.loadingFinished", { requestId: "request" });
    await expect(body).resolves.toEqual({ ok: true });
    headers(session, "next");
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);
    page.dispose();
  });

  it("ignores intermediate redirect responses and delivers the final response", async () => {
    const { page, session } = setup();
    const responses: Response[] = [];
    await page.subscribeResponse((response) => responses.push(response));
    session.emit("Network.requestWillBeSent", {
      requestId: "request",
      loaderId: "loader",
      frameId: "frame",
      type: "Document",
      request: { url: "https://example.test/final" },
      redirectResponse: {
        url: "https://example.test/start",
        status: 302,
        statusText: "Found",
        headers: {},
      },
    });
    expect(responses).toHaveLength(0);
    headers(session);
    expect(responses).toHaveLength(1);
    expect(responses[0]!.status()).toBe(200);
    const body = responses[0]!.json();
    session.emit("Network.loadingFinished", { requestId: "request" });
    await expect(body).resolves.toEqual({ ok: true });
    page.dispose();
  });

  it("supports future OOPIFs and session-scoped request IDs, and settles detach/failure", async () => {
    const { page, session } = setup();
    const received: Response[] = [];
    await page.subscribeResponse((response) => received.push(response));
    const child = new Session("child");
    page.adoptOopifSession(child as unknown as CDPSessionLike, "child-frame");
    headers(session);
    headers(child);
    const mainBody = received[0]!.text();
    const childBody = received[1]!.text();
    const failed = expect(childBody).rejects.toThrow("child failed");
    child.emit("Network.loadingFailed", { requestId: "request", errorText: "child failed" });
    session.emit("Network.loadingFinished", { requestId: "request" });
    await failed;
    await expect(mainBody).resolves.toBe('{"ok":true}');
    headers(child, "detached");
    const detached = expect(received[2]!.body()).rejects.toThrow("detached");
    page.networkManager.untrackSession("child");
    await detached;
    page.dispose();
  });

  it("registers one handle across subscriptions and routes body RPCs", async () => {
    const { page, session } = setup();
    const notifications: PageEventNotification[] = [];
    const runtime = createStagehandRuntime({ emitPageEvent: (event) => notifications.push(event) });
    runtime.registerPage(page);
    const router = new RPCRouter(runtime);
    const call = (method: string, params: object) =>
      router.handle(
        StagehandRpcRequestSchema.parse({
          jsonrpc: "2.0",
          id: 1,
          method,
          params,
        }),
      );
    await call("page.on", { page_id: "page", event: "response", subscription_id: "one" });
    await call("page.on", { page_id: "page", event: "response", subscription_id: "two" });
    headers(session);
    expect(notifications).toHaveLength(2);
    expect(runtime.responseHandles.size).toBe(1);
    const [first, second] = notifications;
    if (first?.event !== "response" || second?.event !== "response")
      throw new Error("Expected response notifications");
    expect(first.response.responseId).toBe(second.response.responseId);
    expect(first.response).not.toHaveProperty("requestId");
    const result = call("response.body", { response_id: first.response.responseId });
    session.emit("Network.loadingFinished", { requestId: "request" });
    await expect(result).resolves.toEqual({ body: "eyJvayI6dHJ1ZX0=", base64Encoded: true });
    await call("page.off", { subscription_id: "one" });
    headers(session, "next");
    expect(notifications).toHaveLength(3);
    page.dispose();
    runtime.responseHandles.clear();
  });

  it("rejects canceled setup and settles body reads when the page is disposed", async () => {
    const { page, session } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(page.subscribeResponse(() => {}, controller.signal)).rejects.toThrow();
    const responses: Response[] = [];
    await page.subscribeResponse((response) => responses.push(response));
    headers(session);
    const body = expect(responses[0]!.body()).rejects.toThrow();
    page.dispose();
    await body;
    await expect(page.subscribeResponse(() => {})).rejects.toThrow("disposed");
  });
});
