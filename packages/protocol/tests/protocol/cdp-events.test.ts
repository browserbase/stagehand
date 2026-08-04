import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CDP_EVENT_NAMES } from "../../generated/cdp-events.js";
import {
  loadOfficialCDPEventNames,
  renderCDPEventNames,
} from "../../json-rpc/build-json-rpc-schema.js";
import { encodeWireValue, wireSchema } from "../../json-rpc/wire-casing.js";
import {
  CDPEventNameSchema,
  PageCDPEventNotificationSchema,
  PageCDPEventSchema,
  PageEventNameSchema,
} from "../../schemas.js";
import { StagehandMethods, StagehandNotifications } from "../../schema-registry.js";

describe("generated CDP page events", () => {
  it("keeps the checked-in event names synchronized with devtools-protocol", async () => {
    const generated = await readFile(
      new URL("../../generated/cdp-events.ts", import.meta.url),
      "utf8",
    );
    expect(generated).toBe(renderCDPEventNames(await loadOfficialCDPEventNames()));
  });

  it("includes events from both official CDP protocol files", () => {
    expect(CDP_EVENT_NAMES).toContain("Browser.downloadProgress");
    expect(CDP_EVENT_NAMES).toContain("Runtime.consoleAPICalled");
  });

  it("keeps the generated official event names sorted and unique", () => {
    expect(CDP_EVENT_NAMES).toStrictEqual([...new Set(CDP_EVENT_NAMES)].sort());
  });

  it("keeps the Stagehand console alias separate from official CDP event names", () => {
    expect(CDP_EVENT_NAMES).not.toContain("console");
    expect(PageEventNameSchema.parse("console")).toBe("console");
    expect(PageEventNameSchema.parse("Runtime.consoleAPICalled")).toBe("Runtime.consoleAPICalled");
    expect(() => CDPEventNameSchema.parse("console")).toThrow();
  });

  it("validates a canonical page CDP event envelope", () => {
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

  it("registers subscription methods and the page event notification", () => {
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

  it("converts the envelope casing without touching raw CDP parameter keys", () => {
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
