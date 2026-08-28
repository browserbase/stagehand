import { describe, expect, it } from "vitest";
import { encodeWireValue, wireSchema } from "../../json-rpc/wire-casing.js";
import {
  PageCDPEventNotificationSchema,
  PageCDPEventSchema,
  PageEventNameSchema,
  PageNetworkEventSchema,
} from "../../schemas.js";
import { StagehandMethods, StagehandNotifications } from "../../schema-registry.js";

describe("page events", () => {
  it("accepts the public console and network event names", () => {
    expect(PageEventNameSchema.parse("console")).toBe("console");
    expect(PageEventNameSchema.parse("network")).toBe("network");
    expect(() => PageEventNameSchema.parse("Runtime.consoleAPICalled")).toThrow();
    expect(() => PageEventNameSchema.parse("Network.responseReceived")).toThrow();
  });

  it("validates the canonical console event envelope", () => {
    expect(
      PageCDPEventSchema.parse({
        pageId: "page-1",
        method: "Runtime.consoleAPICalled",
        params: { type: "log", args: [] },
        sessionId: "session-1",
        targetId: "target-1",
      }),
    ).toStrictEqual({
      pageId: "page-1",
      method: "Runtime.consoleAPICalled",
      params: { type: "log", args: [] },
      sessionId: "session-1",
      targetId: "target-1",
    });
  });

  it("validates typed network request, completion, and failure events", () => {
    const envelope = {
      pageId: "page-1",
      sessionId: "session-1",
      targetId: "target-1",
    };
    expect(
      PageNetworkEventSchema.parse({
        ...envelope,
        method: "Network.requestWillBeSent",
        params: {
          requestKey: "session-1:request-1",
          requestId: "request-1",
          url: "https://example.com/api",
          httpMethod: "POST",
          headers: { "content-type": "application/json" },
          body: '{"ready":true}',
          resourceType: "Fetch",
          timestamp: "2026-08-27T12:00:00.000Z",
        },
      }).method,
    ).toBe("Network.requestWillBeSent");
    expect(
      PageNetworkEventSchema.parse({
        ...envelope,
        method: "Network.loadingFinished",
        params: {
          requestKey: "session-1:request-1",
          requestId: "request-1",
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json" },
          mimeType: "application/json",
          body: '{"ok":true}',
          base64Encoded: false,
          durationMs: 12,
        },
      }).method,
    ).toBe("Network.loadingFinished");
    expect(
      PageNetworkEventSchema.parse({
        ...envelope,
        method: "Network.loadingFailed",
        params: {
          requestKey: "session-1:request-2",
          requestId: "request-2",
          errorText: "net::ERR_FAILED",
          durationMs: 2,
        },
      }).method,
    ).toBe("Network.loadingFailed");
    expect(() =>
      PageCDPEventSchema.parse({
        ...envelope,
        method: "Network.responseReceived",
        params: {},
      }),
    ).toThrow();
  });

  it("registers subscription methods and the console event notification", () => {
    expect(StagehandMethods.pageOn.name).toBe("page.on");
    expect(StagehandMethods.pageOff.name).toBe("page.off");
    expect(StagehandNotifications.pageCDPEvent.name).toBe("page.cdp_event");

    expect(
      PageCDPEventNotificationSchema.parse({
        subscriptionId: "subscription-1",
        event: {
          pageId: "page-1",
          method: "Runtime.consoleAPICalled",
          params: {},
          sessionId: "session-1",
          targetId: "target-1",
        },
      }),
    ).toMatchObject({ subscriptionId: "subscription-1" });
  });

  it("converts envelope casing without touching console parameter keys", () => {
    const apiValue = {
      subscriptionId: "subscription-1",
      event: {
        pageId: "page-1",
        method: "Runtime.consoleAPICalled" as const,
        params: { executionContextId: 7, stackTrace: { callFrames: [] } },
        sessionId: "session-1",
        targetId: "target-1",
      },
    };
    const wireValue = encodeWireValue(apiValue, StagehandNotifications.pageCDPEvent.paramsWire);

    expect(wireValue).toStrictEqual({
      subscription_id: "subscription-1",
      event: {
        page_id: "page-1",
        method: "Runtime.consoleAPICalled",
        params: { executionContextId: 7, stackTrace: { callFrames: [] } },
        session_id: "session-1",
        target_id: "target-1",
      },
    });
    expect(
      wireSchema(
        StagehandNotifications.pageCDPEvent.params,
        StagehandNotifications.pageCDPEvent.paramsWire,
      ).parse(wireValue),
    ).toStrictEqual(apiValue);
  });
});
