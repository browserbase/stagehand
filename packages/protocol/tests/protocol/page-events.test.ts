import { describe, expect, it } from "vitest";
import { encodeWireValue, wireSchema } from "../../json-rpc/wire-casing.js";
import {
  PageEventNotificationSchema,
  PageCDPEventSchema,
  PageEventNameSchema,
} from "../../schemas.js";
import { StagehandMethods, StagehandNotifications } from "../../schema-registry.js";

describe("console page events", () => {
  it("only accepts the public console event name", () => {
    expect(PageEventNameSchema.parse("console")).toBe("console");
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
    expect(StagehandNotifications.event.name).toBe("page.event");

    expect(
      PageEventNotificationSchema.parse({
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
    const wireValue = encodeWireValue(apiValue, StagehandNotifications.event.paramsWire);

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
        StagehandNotifications.event.params,
        StagehandNotifications.event.paramsWire,
      ).parse(wireValue),
    ).toStrictEqual(apiValue);
  });
});
