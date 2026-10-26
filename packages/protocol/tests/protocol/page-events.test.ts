import { describe, expect, it } from "vitest";
import { encodeWireValue, wireSchema } from "../../json-rpc/wire-casing.js";
import {
  PageCDPEventNotificationSchema,
  PageCDPEventSchema,
  PageEventNameSchema,
  PageEventNotificationSchema,
  PageSubscriptionEventNameSchema,
  PageOnParamsSchema,
} from "../../schemas.js";
import {
  StagehandMethods,
  StagehandNotifications,
  StagehandRpcNotificationSchema,
} from "../../schema-registry.js";

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

describe("typed page events", () => {
  const routing = {
    subscriptionId: "subscription-1",
    pageId: "page-1",
    sessionId: "child-session",
    targetId: "child-target",
  };
  const identity = { name: "search", frameId: "child-frame" };
  const inputSchema = {
    type: "object",
    properties: {
      queryText: { type: "string" },
      nested_input: { properties: { userID: { type: "string" } } },
    },
    required: ["queryText"],
  };
  const descriptor = {
    ...identity,
    description: "Search the page",
    inputSchema,
    annotations: { readOnly: true, untrustedContent: true },
    backendNodeId: 42,
  };

  it("expands internal registration without widening the legacy public event name", () => {
    for (const event of ["console", "toolsadded", "toolsremoved"]) {
      expect(PageSubscriptionEventNameSchema.parse(event)).toBe(event);
      expect(
        PageOnParamsSchema.parse({
          pageId: routing.pageId,
          subscriptionId: routing.subscriptionId,
          event,
        }).event,
      ).toBe(event);
    }
    for (const event of ["toolsadded", "toolsremoved"]) {
      expect(PageEventNameSchema.safeParse(event).success).toBe(false);
    }
    expect(PageSubscriptionEventNameSchema.safeParse("WebMCP.toolsAdded").success).toBe(false);
  });

  it("validates each discriminator against its concrete payload", () => {
    const added = { ...routing, event: "toolsadded", tools: [descriptor] };
    const removed = { ...routing, event: "toolsremoved", tools: [identity] };
    expect(PageEventNotificationSchema.parse(added)).toStrictEqual(added);
    expect(PageEventNotificationSchema.parse(removed)).toStrictEqual(removed);
    for (const invalid of [
      { ...added, event: "toolsremoved" },
      { ...removed, event: "toolsadded" },
      { ...added, event: "console" },
      { ...added, tools: null },
      { ...added, pageId: "" },
    ]) {
      expect(PageEventNotificationSchema.safeParse(invalid).success).toBe(false);
    }
    for (const event of ["toolsadded", "toolsremoved"]) {
      expect(PageEventNotificationSchema.parse({ ...routing, event, tools: [] }).tools).toEqual([]);
    }
  });

  it("round-trips normalized fields while preserving arbitrary schema keys", () => {
    const definition = StagehandNotifications.pageEvent;
    expect(definition.name).toBe("page.event");
    const value = { ...routing, event: "toolsadded", tools: [descriptor] };
    const encoded = encodeWireValue(value, definition.paramsWire);
    expect(encoded).toStrictEqual({
      subscription_id: routing.subscriptionId,
      page_id: routing.pageId,
      session_id: routing.sessionId,
      target_id: routing.targetId,
      event: "toolsadded",
      tools: [
        {
          name: identity.name,
          frame_id: identity.frameId,
          description: descriptor.description,
          input_schema: inputSchema,
          annotations: { read_only: true, untrusted_content: true },
          backend_node_id: 42,
        },
      ],
    });
    expect(wireSchema(definition.params, definition.paramsWire).parse(encoded)).toStrictEqual(
      value,
    );
    expect(
      StagehandRpcNotificationSchema.parse({
        jsonrpc: "2.0",
        method: definition.name,
        params: encoded,
      }),
    ).toStrictEqual({
      jsonrpc: "2.0",
      method: definition.name,
      params: value,
    });
    const removed = { ...routing, event: "toolsremoved", tools: [identity] };
    expect(
      wireSchema(definition.params, definition.paramsWire).parse(
        encodeWireValue(removed, definition.paramsWire),
      ),
    ).toStrictEqual(removed);
  });
});
