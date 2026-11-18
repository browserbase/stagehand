import type { Protocol } from "devtools-protocol";
import { describe, expect, it } from "vitest";
import type { CDPSessionLike } from "../understudy/cdp.js";
import { NavigationResponseTracker } from "../understudy/navigationResponseTracker.js";
import type { Page } from "../understudy/page.js";

class Session implements CDPSessionLike {
  readonly id = "main";
  readonly handlers = new Map<string, Set<(value: unknown) => void>>();
  async send<R = unknown>(): Promise<R> {
    return {} as R;
  }
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
  const session = new Session();
  const page = {
    isCurrentNavigationCommand: () => true,
    mainFrameId: () => "frame",
  } as unknown as Page;
  const tracker = new NavigationResponseTracker({ page, session, navigationCommandId: 1 });
  tracker.setExpectedLoaderId("loader");
  return { session, tracker };
}

function extraInfo(statusCode: number, headers: Protocol.Network.Headers) {
  return { requestId: "request", statusCode, headers, blockedCookies: [], associatedCookies: [] };
}

function documentResponse(session: Session, fromDiskCache = false) {
  session.emit("Network.responseReceived", {
    requestId: "request",
    loaderId: "loader",
    frameId: "frame",
    type: "Document",
    response: {
      url: "https://example.test/final",
      status: 200,
      statusText: "OK",
      headers: { "Content-Type": "text/html" },
      fromDiskCache,
    },
  });
}

describe("navigation response tracker", () => {
  it("applies extra info that arrived before the document response", async () => {
    const { session, tracker } = setup();
    session.emit(
      "Network.responseReceivedExtraInfo",
      extraInfo(200, { "content-type": "text/html", "set-cookie": "session=abc" }),
    );
    documentResponse(session);
    const response = await tracker.navigationCompleted();
    await expect(response?.headerValue("set-cookie")).resolves.toBe("session=abc");
    tracker.dispose();
  });

  it("does not apply a redirect hop's extra info to the final response", async () => {
    const { session, tracker } = setup();
    // The redirect shares the request id; the final hop comes from the disk cache, so
    // Chrome sends no extra info for it.
    session.emit(
      "Network.responseReceivedExtraInfo",
      extraInfo(302, { location: "/final", "set-cookie": "hop=1" }),
    );
    documentResponse(session, true);
    const response = await tracker.navigationCompleted();
    expect(response?.status()).toBe(200);
    await expect(response?.headerValue("set-cookie")).resolves.toBeNull();
    await expect(response?.headerValue("location")).resolves.toBeNull();
    await expect(response?.headerValue("content-type")).resolves.toBe("text/html");
    tracker.dispose();
  });
});
