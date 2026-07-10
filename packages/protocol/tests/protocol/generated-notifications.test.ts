import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";

const schemaUrl = new URL("../../stagehand.v4.json", import.meta.url);

type GeneratedNotification = {
  properties: Record<string, unknown>;
  required: string[];
};
type GeneratedNotificationRegistry = {
  properties: Record<string, GeneratedNotification>;
};
type GeneratedProtocol = {
  properties: {
    notifications?: GeneratedNotificationRegistry;
    transport: { properties: Record<string, unknown> };
  };
};

function requireNotifications(protocol: GeneratedProtocol): GeneratedNotificationRegistry {
  const notifications = protocol.properties.notifications;
  expect(notifications, "the generated protocol must include notifications").toBeDefined();
  return notifications as GeneratedNotificationRegistry;
}

describe("generated Stagehand notifications", () => {
  it("includes a top-level notifications registry", async () => {
    const protocol = JSON.parse(await readFile(schemaUrl, "utf8")) as GeneratedProtocol;
    requireNotifications(protocol);
  });

  it("includes stagehand.log_event in the notifications registry", async () => {
    const protocol = JSON.parse(await readFile(schemaUrl, "utf8")) as GeneratedProtocol;
    const notifications = requireNotifications(protocol);
    expect(notifications.properties["stagehand.log_event"]).toBeDefined();
  });

  it("generates params but no result for stagehand.log_event", async () => {
    const protocol = JSON.parse(await readFile(schemaUrl, "utf8")) as GeneratedProtocol;
    const notifications = requireNotifications(protocol);
    const notification = notifications.properties["stagehand.log_event"];

    expect(notification).toBeDefined();
    expect(notification.properties.params).toBeDefined();
    expect(notification.properties.result).toBeUndefined();
    expect(notification.required).toStrictEqual(["params"]);
  });

  it("includes a notification envelope in the transport schema", async () => {
    const protocol = JSON.parse(await readFile(schemaUrl, "utf8")) as GeneratedProtocol;
    expect(protocol.properties.transport.properties.notification).toBeDefined();
  });

  it("requires params in the notification envelope", async () => {
    const protocol = JSON.parse(await readFile(schemaUrl, "utf8")) as GeneratedProtocol;
    const notification = protocol.properties.transport.properties.notification as {
      required: string[];
    };
    expect(notification.required).toContain("params");
  });
});
