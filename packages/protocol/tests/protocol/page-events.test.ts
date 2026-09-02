import { describe, expect, it } from "vitest";
import { encodeWireValue, wireSchema } from "../../json-rpc/wire-casing.js";
import {
  PageCDPEventNotificationSchema,
  PageCDPEventSchema,
  PageEventNotificationSchema,
  PageEventNameSchema,
} from "../../schemas.js";
import { StagehandMethods, StagehandNotifications } from "../../schema-registry.js";

describe("page events", () => {
  it("only accepts public page event names", () => {
    expect(PageEventNameSchema.parse("console")).toBe("console");
    expect(PageEventNameSchema.parse("toolsAdded")).toBe("toolsAdded");
    expect(() => PageEventNameSchema.parse("Runtime.consoleAPICalled")).toThrow();
    expect(() => PageEventNameSchema.parse("Network.responseReceived")).toThrow();
  });

  it("validates CDP-backed page event envelopes", () => {
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
    expect(
      PageCDPEventSchema.parse({
        pageId: "page-1",
        method: "WebMCP.toolsAdded",
        params: { tools: [] },
        sessionId: "session-1",
        targetId: "target-1",
      }),
    ).toMatchObject({ method: "WebMCP.toolsAdded" });
    expect(() =>
      PageCDPEventSchema.parse({
        pageId: "page-1",
        method: "Network.responseReceived",
        params: {},
        sessionId: "session-1",
        targetId: "target-1",
      }),
    ).toThrow();
  });

  it("registers subscription methods and the console event notification", () => {
    expect(StagehandMethods.pageOn.name).toBe("page.on");
    expect(StagehandMethods.pageOff.name).toBe("page.off");
    expect(StagehandNotifications.pageCDPEvent.name).toBe("page.cdp_event");
    expect(StagehandNotifications.pageEvent.name).toBe("page.event");

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

    expect(
      PageEventNotificationSchema.parse({
        subscriptionId: "subscription-1",
        event: {
          pageId: "page-1",
          method: "WebMCP.toolsAdded",
          params: { tools: [] },
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

  it("converts generic page event casing without touching CDP parameter keys", () => {
    const apiValue = {
      subscriptionId: "subscription-1",
      event: {
        pageId: "page-1",
        method: "WebMCP.toolsAdded",
        params: { tools: [{ inputSchema: { someInput: { type: "string" } } }] },
        sessionId: "session-1",
        targetId: "target-1",
      },
    };
    const wireValue = encodeWireValue(apiValue, StagehandNotifications.pageEvent.paramsWire);

    expect(wireValue).toStrictEqual({
      subscription_id: "subscription-1",
      event: {
        page_id: "page-1",
        method: "WebMCP.toolsAdded",
        params: { tools: [{ inputSchema: { someInput: { type: "string" } } }] },
        session_id: "session-1",
        target_id: "target-1",
      },
    });
    expect(
      wireSchema(
        StagehandNotifications.pageEvent.params,
        StagehandNotifications.pageEvent.paramsWire,
      ).parse(wireValue),
    ).toStrictEqual(apiValue);
  });
});
