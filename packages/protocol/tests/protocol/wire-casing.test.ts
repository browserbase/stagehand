import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod/v4";
import {
  encodeWireValue,
  renameJsonSchemaProperties,
  wireSchema,
} from "../../json-rpc/wire-casing.js";
import { StagehandMethods, StagehandNotifications } from "../../schema-registry.js";

const snakeCaseKey = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const snakeCaseMethodSegment = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const schemaUrl = new URL("../../stagehand.v4.json", import.meta.url);

describe("JSON-RPC wire casing", () => {
  it("uses snake_case method and notification names", () => {
    for (const name of [...Object.keys(StagehandMethods), ...Object.keys(StagehandNotifications)]) {
      for (const segment of name.split(".")) {
        expect(segment, `${name} must use snake_case segments`).toMatch(snakeCaseMethodSegment);
      }
    }
  });

  it("uses snake_case for every declared wire property", () => {
    for (const [method, definition] of Object.entries(StagehandMethods)) {
      expectDeclaredPropertiesToBeSnakeCase(
        renameJsonSchemaProperties(z.toJSONSchema(definition.paramsSchema)),
        `${method}.params`,
      );
      expectDeclaredPropertiesToBeSnakeCase(
        renameJsonSchemaProperties(z.toJSONSchema(definition.resultSchema)),
        `${method}.result`,
      );
    }

    for (const [method, definition] of Object.entries(StagehandNotifications)) {
      expectDeclaredPropertiesToBeSnakeCase(
        renameJsonSchemaProperties(z.toJSONSchema(definition.paramsSchema)),
        `${method}.params`,
      );
    }
  });

  it("encodes camelCase API values and decodes snake_case wire values", () => {
    const schema = StagehandMethods["page.goto"].paramsSchema;
    const apiValue = {
      pageId: "page_1",
      url: "https://example.com",
      options: { waitUntil: "load" as const, timeoutMs: 5_000 },
    };
    const wireValue = {
      page_id: "page_1",
      url: "https://example.com",
      options: { wait_until: "load" as const, timeout_ms: 5_000 },
    };

    expect(encodeWireValue(apiValue)).toStrictEqual(wireValue);
    expect(wireSchema(schema).parse(wireValue)).toStrictEqual(apiValue);
  });

  it("preserves arbitrary map keys while encoding nested configuration", () => {
    const definition = StagehandMethods["stagehand.init"];
    const apiValue = {
      cdpUrl: "ws://localhost/devtools/browser/1",
      cdpHeaders: { "X-Custom-Key": "value" },
      model: {
        modelName: "openai/gpt-5-mini",
        provider: "openai" as const,
        headers: { doNotRenameMe: "value" },
      },
    };

    const wireValue = {
      cdp_url: "ws://localhost/devtools/browser/1",
      cdp_headers: { "X-Custom-Key": "value" },
      model: {
        model_name: "openai/gpt-5-mini",
        provider: "openai",
        headers: { doNotRenameMe: "value" },
      },
    };

    expect(encodeWireValue(apiValue)).toStrictEqual(wireValue);
    expect(wireSchema(definition.paramsSchema).parse(wireValue)).toStrictEqual(apiValue);
  });

  it("preserves log attribute keys while encoding notifications", () => {
    const definition = StagehandNotifications["stagehand.log_event"];
    const encoded = encodeWireValue({
      requestId: "req_1",
      method: "page.goto",
      eventName: "page.goto.started",
      timestamp: "2026-07-10T17:00:00.000Z",
      severityNumber: 9,
      body: { doNotRenameMe: true },
      attributes: { doNotRenameMe: "value" },
    });

    expect(encoded).toMatchObject({
      request_id: "req_1",
      event_name: "page.goto.started",
      severity_number: 9,
      body: { doNotRenameMe: true },
      attributes: { doNotRenameMe: "value" },
    });
    expect(wireSchema(definition.paramsSchema).parse(encoded)).toMatchObject({
      body: { doNotRenameMe: true },
      attributes: { doNotRenameMe: "value" },
    });
  });

  it("preserves arbitrary extraction result keys", () => {
    const definition = StagehandMethods["stagehand.extract"];
    const apiValue = {
      result: { userName: "Sam" },
      actionId: "action_1",
    };
    const wireValue = {
      result: { userName: "Sam" },
      action_id: "action_1",
    };

    expect(encodeWireValue(apiValue, definition.resultWire.encode)).toStrictEqual(wireValue);
    expect(
      wireSchema(definition.resultSchema, definition.resultWire.decode).parse(wireValue),
    ).toStrictEqual(apiValue);
  });

  it("keeps every generated method and notification shape snake_case", async () => {
    const protocol = JSON.parse(await readFile(schemaUrl, "utf8")) as Record<string, unknown>;
    const properties = asRecord(protocol.properties);
    const methods = asRecord(asRecord(properties.methods).properties);
    const notifications = asRecord(asRecord(properties.notifications).properties);

    for (const [method, definition] of Object.entries(methods)) {
      const methodProperties = asRecord(asRecord(definition).properties);
      expectDeclaredPropertiesToBeSnakeCase(methodProperties.params, `${method}.params`);
      expectDeclaredPropertiesToBeSnakeCase(methodProperties.result, `${method}.result`);
    }

    for (const [method, definition] of Object.entries(notifications)) {
      const notificationProperties = asRecord(asRecord(definition).properties);
      expectDeclaredPropertiesToBeSnakeCase(notificationProperties.params, `${method}.params`);
    }
  });

  it("keeps transport params required and snake_case", async () => {
    const protocol = JSON.parse(await readFile(schemaUrl, "utf8")) as Record<string, unknown>;
    const transport = asRecord(asRecord(asRecord(protocol.properties).transport).properties);
    const requestVariants = asRecord(transport.request).anyOf;

    expect(Array.isArray(requestVariants)).toBe(true);
    for (const variant of requestVariants as unknown[]) {
      const required = asRecord(variant).required;
      expect(required).toContain("params");
      expectDeclaredPropertiesToBeSnakeCase(variant, "transport.request");
    }

    expectDeclaredPropertiesToBeSnakeCase(transport.notification, "transport.notification");
  });
});

function expectDeclaredPropertiesToBeSnakeCase(schema: unknown, path: string): void {
  visitSchema(schema, path, new Set());
}

function visitSchema(schema: unknown, path: string, visited: Set<object>): void {
  if (typeof schema !== "object" || schema === null || visited.has(schema)) return;
  visited.add(schema);

  const record = schema as Record<string, unknown>;
  const properties = asRecord(record.properties);
  for (const [key, value] of Object.entries(properties)) {
    expect(key, `${path}.${key} must use snake_case`).toMatch(snakeCaseKey);
    visitSchema(value, `${path}.${key}`, visited);
  }

  for (const key of ["items", "additionalProperties", "$defs", "anyOf", "oneOf", "allOf"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visitSchema(entry, `${path}.${key}[${index}]`, visited));
    } else if (key === "$defs") {
      Object.entries(asRecord(value)).forEach(([name, entry]) =>
        visitSchema(entry, `${path}.$defs.${name}`, visited),
      );
    } else {
      visitSchema(value, `${path}.${key}`, visited);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
