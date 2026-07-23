import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod/v4";
import { StagehandMethods, StagehandNotifications } from "../../schema-registry.js";
import { DEFAULT_TELEMETRY_CONFIG } from "../../schemas.js";

const schemaUrl = new URL("../../stagehand.v4.json", import.meta.url);

describe("generated Stagehand schema integrity", () => {
  it("references every registered method's named params and result definitions", async () => {
    const protocol = await readProtocol();
    const methodsSchema = asRecord(asRecord(protocol.properties).methods);
    const generatedMethods = asRecord(methodsSchema.properties);
    const registeredMethods = Object.values(StagehandMethods);
    const methodNames = registeredMethods.map(({ name }) => name);

    expect(Object.keys(generatedMethods)).toStrictEqual(methodNames);
    expect(methodsSchema.required).toStrictEqual(methodNames);

    for (const method of registeredMethods) {
      const generatedMethod = asRecord(generatedMethods[method.name]);
      const properties = asRecord(generatedMethod.properties);

      expect(
        Object.keys(properties),
        `${method.name} must only declare params and result`,
      ).toStrictEqual(["params", "result"]);
      expect(generatedMethod.required).toStrictEqual(["params", "result"]);
      expectDefinitionReference(protocol, properties.params, schemaId(method.params));
      expectDefinitionReference(protocol, properties.result, schemaId(method.result));
    }
  });

  it("references every registered notification's named params definition", async () => {
    const protocol = await readProtocol();
    const notificationsSchema = asRecord(asRecord(protocol.properties).notifications);
    const generatedNotifications = asRecord(notificationsSchema.properties);
    const registeredNotifications = Object.values(StagehandNotifications);
    const notificationNames = registeredNotifications.map(({ name }) => name);

    expect(Object.keys(generatedNotifications)).toStrictEqual(notificationNames);
    expect(notificationsSchema.required).toStrictEqual(notificationNames);

    for (const notification of registeredNotifications) {
      const generatedNotification = asRecord(generatedNotifications[notification.name]);
      const properties = asRecord(generatedNotification.properties);

      expect(
        Object.keys(properties),
        `${notification.name} must only declare params`,
      ).toStrictEqual(["params"]);
      expect(generatedNotification.required).toStrictEqual(["params"]);
      expectDefinitionReference(protocol, properties.params, schemaId(notification.params));
    }
  });

  it("resolves every JSON Schema reference inside the generated protocol", async () => {
    const protocol = await readProtocol();
    const references: string[] = [];

    visit(protocol, (reference) => {
      references.push(reference);
      expect(resolveLocalReference(protocol, reference), `${reference} must resolve`).toBeDefined();
    });

    expect(references.length).toBeGreaterThan(0);
  });

  it("keeps every JSON-RPC envelope tied to its registered method shape", async () => {
    const protocol = await readProtocol();
    const jsonrpc = asRecord(asRecord(asRecord(protocol.properties).jsonrpc).properties);
    const request = resolveSchema(protocol, jsonrpc.request);
    const requestVariants = request.oneOf ?? request.anyOf;

    expect(Array.isArray(requestVariants)).toBe(true);
    const requestMethods = (requestVariants as unknown[]).map((variant) => {
      const envelope = resolveSchema(protocol, variant);
      expect(envelope.required).toContain("params");
      return asRecord(asRecord(envelope.properties).method).const;
    });
    expect(requestMethods).toStrictEqual(Object.values(StagehandMethods).map(({ name }) => name));

    const notification = resolveSchema(protocol, jsonrpc.notification);
    expect(notification.required).toContain("params");
    expect(asRecord(asRecord(notification.properties).method).const).toBe(
      StagehandNotifications.log.name,
    );
  });

  it("keeps referenced Zod defaults on every generated field that uses them", async () => {
    const protocol = await readProtocol();
    const methods = asRecord(asRecord(asRecord(protocol.properties).methods).properties);
    const telemetryDefault = DEFAULT_TELEMETRY_CONFIG;

    for (const methodName of ["runtime.configure", "stagehand.init"]) {
      const method = asRecord(methods[methodName]);
      const params = resolveLocalReference(
        protocol,
        asRecord(asRecord(method.properties).params).$ref as string,
      );
      const telemetry = asRecord(asRecord(asRecord(params).properties).telemetry);

      expect(
        telemetry.default,
        `${methodName}.telemetry must preserve its Zod default`,
      ).toStrictEqual(telemetryDefault);
    }
  });
});

async function readProtocol(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(schemaUrl, "utf8")) as Record<string, unknown>;
}

function expectDefinitionReference(
  protocol: Record<string, unknown>,
  schema: unknown,
  definitionName: string,
): string {
  const reference = asRecord(schema).$ref;
  const expectedReference = `#/$defs/${definitionName}`;

  expect(reference).toBe(expectedReference);
  expect(resolveLocalReference(protocol, expectedReference)).toBeDefined();
  return expectedReference;
}

function schemaId(schema: z.ZodType): string {
  const id = z.globalRegistry.get(schema)?.id;
  expect(id).toBeTypeOf("string");
  return id!;
}

function visit(value: unknown, onReference: (reference: string) => void): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => visit(entry, onReference));
    return;
  }
  if (typeof value !== "object" || value === null) return;

  for (const [key, entry] of Object.entries(value)) {
    if (key === "$ref") {
      expect(entry, "JSON Schema references must be strings").toBeTypeOf("string");
      onReference(entry as string);
    } else {
      visit(entry, onReference);
    }
  }
}

function resolveLocalReference(document: unknown, reference: string): unknown {
  expect(reference, "generated schema references must be local").toMatch(/^#\//);

  let value = document;
  for (const encodedPart of reference.slice(2).split("/")) {
    const part = encodedPart.replaceAll("~1", "/").replaceAll("~0", "~");
    const record = asRecord(value);
    expect(Object.hasOwn(record, part), `${reference} must resolve`).toBe(true);
    value = record[part];
  }
  return value;
}

function resolveSchema(
  document: Record<string, unknown>,
  schema: unknown,
): Record<string, unknown> {
  const record = asRecord(schema);
  return typeof record.$ref === "string"
    ? asRecord(resolveLocalReference(document, record.$ref))
    : record;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
