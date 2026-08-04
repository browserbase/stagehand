import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const schemaUrl = new URL("../../stagehand.v4.json", import.meta.url);

type GeneratedNotification = {
  anyOf?: unknown[];
  properties: Record<string, unknown>;
  required: string[];
};
type GeneratedNotificationRegistry = {
  properties: Record<string, GeneratedNotification>;
};
type GeneratedProtocol = {
  $defs: Record<string, GeneratedNotification>;
  properties: {
    notifications?: GeneratedNotificationRegistry;
    jsonrpc: { properties: Record<string, unknown> };
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

  it("includes stagehand.log in the notifications registry", async () => {
    const protocol = JSON.parse(await readFile(schemaUrl, "utf8")) as GeneratedProtocol;
    const notifications = requireNotifications(protocol);
    expect(notifications.properties["stagehand.log"]).toBeDefined();
  });

  it("generates params but no result for stagehand.log", async () => {
    const protocol = JSON.parse(await readFile(schemaUrl, "utf8")) as GeneratedProtocol;
    const notifications = requireNotifications(protocol);
    const notification = notifications.properties["stagehand.log"];

    expect(notification).toBeDefined();
    expect(notification.properties.params).toBeDefined();
    expect(notification.properties.result).toBeUndefined();
    expect(notification.required).toStrictEqual(["params"]);
  });

  it("includes a notification envelope in the JSON-RPC schema", async () => {
    const protocol = JSON.parse(await readFile(schemaUrl, "utf8")) as GeneratedProtocol;
    expect(protocol.properties.jsonrpc.properties.notification).toBeDefined();
  });

  it("requires params in the notification envelope", async () => {
    const protocol = JSON.parse(await readFile(schemaUrl, "utf8")) as GeneratedProtocol;
    const notificationSchema = resolveDefinition(
      protocol,
      protocol.properties.jsonrpc.properties.notification,
    );
    const variants = notificationSchema.anyOf ?? [notificationSchema];
    expect(
      variants,
      "the notification envelope must include at least one variant",
    ).not.toHaveLength(0);
    for (const variant of variants) {
      const notification = resolveDefinitionOrInline(protocol, variant);
      expect(notification.required).toContain("params");
    }
  });
});

function resolveDefinition(protocol: GeneratedProtocol, schema: unknown): GeneratedNotification {
  const reference = (schema as { $ref?: unknown }).$ref;
  expect(reference).toBeTypeOf("string");
  expect(reference).toMatch(/^#\/\$defs\/[^/]+$/);

  const name = (reference as string).slice("#/$defs/".length);
  const definition = protocol.$defs[name];
  expect(definition, `${reference as string} must resolve`).toBeDefined();
  return definition;
}

function resolveDefinitionOrInline(
  protocol: GeneratedProtocol,
  schema: unknown,
): GeneratedNotification {
  return (schema as { $ref?: unknown }).$ref
    ? resolveDefinition(protocol, schema)
    : (schema as GeneratedNotification);
}
