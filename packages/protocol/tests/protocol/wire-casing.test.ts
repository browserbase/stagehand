import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod/v4";
import {
  encodeWireValue,
  renameJsonSchemaProperties,
  wireSchema,
} from "../../json-rpc/wire-casing.js";
import { StagehandNotifications, StagehandMethods } from "../../schema-registry.js";

const snakeCaseKey = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const snakeCaseMethodSegment = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const schemaUrl = new URL("../../stagehand.v4.json", import.meta.url);

describe("JSON-RPC wire casing", () => {
  it("uses snake_case method and notification names", () => {
    for (const name of [
      ...Object.values(StagehandMethods).map((method) => method.name),
      ...Object.values(StagehandNotifications).map((notification) => notification.name),
    ]) {
      for (const segment of name.split(".")) {
        expect(segment, `${name} must use snake_case segments`).toMatch(snakeCaseMethodSegment);
      }
    }
  });

  it("uses snake_case for every declared wire property", () => {
    for (const definition of Object.values(StagehandMethods)) {
      const method = definition.name;
      expectDeclaredPropertiesToBeSnakeCase(
        renameJsonSchemaProperties(z.toJSONSchema(definition.params)),
        `${method}.params`,
      );
      expectDeclaredPropertiesToBeSnakeCase(
        renameJsonSchemaProperties(z.toJSONSchema(definition.result)),
        `${method}.result`,
      );
    }

    for (const notification of Object.values(StagehandNotifications)) {
      expectDeclaredPropertiesToBeSnakeCase(
        renameJsonSchemaProperties(z.toJSONSchema(notification.params)),
        `${notification.name}.params`,
      );
    }
  });

  it("encodes camelCase API values and decodes snake_case wire values", () => {
    const schema = StagehandMethods.pageGoto.params;
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

  it("uses one opaque-key configuration for encoding and decoding", () => {
    const schema = z.strictObject({
      structuredContent: z.record(z.string(), z.json()),
    });
    const options = { opaqueKeys: ["structuredContent"] } as const;
    const apiValue = {
      structuredContent: { finalAnswer: "done" },
    };
    const wireValue = {
      structured_content: { finalAnswer: "done" },
    };

    expect(encodeWireValue(apiValue, options)).toStrictEqual(wireValue);
    expect(wireSchema(schema, options).parse(wireValue)).toStrictEqual(apiValue);
  });

  it("encodes locator parity params with snake_case wire fields", () => {
    const schema = StagehandMethods.locatorSendClickEvent.params;
    const apiValue = {
      pageId: "page_1",
      selector: "button",
      nth: 0,
      options: {
        cancelable: true,
        composed: true,
      },
    };
    const wireValue = {
      page_id: "page_1",
      selector: "button",
      nth: 0,
      options: {
        cancelable: true,
        composed: true,
      },
    };

    expect(encodeWireValue(apiValue)).toStrictEqual(wireValue);
    expect(wireSchema(schema).parse(wireValue)).toStrictEqual(apiValue);
  });

  it("encodes page parity params with snake_case wire fields", () => {
    const definition = StagehandMethods.pageDragAndDrop;
    const apiValue = {
      pageId: "page_1",
      fromX: 10,
      fromY: 20,
      toX: 30,
      toY: 40,
      options: { returnXpath: true },
    };
    const wireValue = {
      page_id: "page_1",
      from_x: 10,
      from_y: 20,
      to_x: 30,
      to_y: 40,
      options: { return_xpath: true },
    };

    expect(encodeWireValue(apiValue)).toStrictEqual(wireValue);
    expect(wireSchema(definition.params).parse(wireValue)).toStrictEqual(apiValue);
  });

  it("encodes context params and results with snake_case wire fields", () => {
    const domainPolicy = StagehandMethods.contextSetDomainPolicy;
    const domainPolicyParams = {
      policy: {
        allowedDomains: ["example.com"],
        blockedDomains: ["ads.example.com"],
      },
    };
    const domainPolicyWireParams = {
      policy: {
        allowed_domains: ["example.com"],
        blocked_domains: ["ads.example.com"],
      },
    };
    expect(encodeWireValue(domainPolicyParams)).toStrictEqual(domainPolicyWireParams);
    expect(wireSchema(domainPolicy.params).parse(domainPolicyWireParams)).toStrictEqual(
      domainPolicyParams,
    );

    const clearCookies = StagehandMethods.contextClearCookies;
    const clearCookiesParams = {
      options: { name: { source: "^session-", flags: "i" }, domain: "example.com" },
    };
    expect(wireSchema(clearCookies.params).parse(clearCookiesParams)).toStrictEqual(
      clearCookiesParams,
    );

    const clipboard = StagehandMethods.contextClipboardPaste;
    const clipboardParams = { pageId: "page_1", shortcut: "ControlOrMeta+V" as const };
    const clipboardWireParams = { page_id: "page_1", shortcut: "ControlOrMeta+V" as const };
    expect(encodeWireValue(clipboardParams)).toStrictEqual(clipboardWireParams);
    expect(wireSchema(clipboard.params).parse(clipboardWireParams)).toStrictEqual(clipboardParams);

    const cookies = StagehandMethods.contextCookies;
    const cookiesResult = {
      cookies: [
        {
          name: "session",
          value: "abc123",
          domain: "example.com",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax" as const,
        },
      ],
    };
    const cookiesWireResult = {
      cookies: [
        {
          name: "session",
          value: "abc123",
          domain: "example.com",
          path: "/",
          expires: -1,
          http_only: true,
          secure: true,
          same_site: "Lax" as const,
        },
      ],
    };
    expect(encodeWireValue(cookiesResult)).toStrictEqual(cookiesWireResult);
    expect(wireSchema(cookies.result).parse(cookiesWireResult)).toStrictEqual(cookiesResult);
  });

  it("preserves opaque context header keys", () => {
    const definition = StagehandMethods.contextSetExtraHTTPHeaders;
    const apiValue = {
      headers: { "X-Request-ID": "request-1", doNotRenameMe: "value" },
    };

    expect(encodeWireValue(apiValue, definition.paramsWire)).toStrictEqual(apiValue);
    expect(wireSchema(definition.params, definition.paramsWire).parse(apiValue)).toStrictEqual(
      apiValue,
    );
  });

  it("preserves opaque page payload keys", () => {
    const evaluate = StagehandMethods.pageEvaluate;
    const evaluation = { value: { camelCase: true, nestedValue: { staysCamelCase: true } } };
    expect(encodeWireValue(evaluation, evaluate.resultWire)).toStrictEqual(evaluation);
    expect(wireSchema(evaluate.result, evaluate.resultWire).parse(evaluation)).toStrictEqual(
      evaluation,
    );

    const headers = StagehandMethods.pageSetExtraHTTPHeaders;
    const headerParams = {
      pageId: "page_1",
      headers: { "X-Request-ID": "request-1", doNotRenameMe: "value" },
    };
    const headerWireParams = {
      page_id: "page_1",
      headers: { "X-Request-ID": "request-1", doNotRenameMe: "value" },
    };
    expect(encodeWireValue(headerParams, headers.paramsWire)).toStrictEqual(headerWireParams);
    expect(wireSchema(headers.params, headers.paramsWire).parse(headerWireParams)).toStrictEqual(
      headerParams,
    );

    const snapshot = StagehandMethods.pageSnapshot;
    const snapshotResult = {
      formattedTree: "root",
      xpathMap: { frameOne: "/html/body" },
      urlMap: { frameOne: "https://example.com" },
    };
    const snapshotWireResult = {
      formatted_tree: "root",
      xpath_map: { frameOne: "/html/body" },
      url_map: { frameOne: "https://example.com" },
    };
    expect(encodeWireValue(snapshotResult, snapshot.resultWire)).toStrictEqual(snapshotWireResult);
    expect(
      wireSchema(snapshot.result, snapshot.resultWire).parse(snapshotWireResult),
    ).toStrictEqual(snapshotResult);
  });

  it("preserves arbitrary map keys while encoding nested configuration", () => {
    const definition = StagehandMethods.stagehandInit;
    const apiValue = {
      apiKey: "bb_key",
      browser: {
        type: "browserbase" as const,
        browserSettings: { advancedStealth: true },
        userMetadata: { doNotRenameMe: "value" },
      },
      model: {
        modelName: "openai/gpt-5-mini",
        headers: { doNotRenameMe: "value" },
      },
      telemetry: {
        traces: {
          endpoint: "https://example.com/v1/traces",
          headers: { doNotRenameMe: "value" },
        },
      },
    };

    const wireValue = {
      api_key: "bb_key",
      browser: {
        type: "browserbase",
        browser_settings: { advanced_stealth: true },
        user_metadata: { doNotRenameMe: "value" },
      },
      model: {
        model_name: "openai/gpt-5-mini",
        headers: { doNotRenameMe: "value" },
      },
      telemetry: {
        traces: {
          endpoint: "https://example.com/v1/traces",
          headers: { doNotRenameMe: "value" },
        },
      },
    };

    expect(encodeWireValue(apiValue)).toStrictEqual(wireValue);
    expect(wireSchema(definition.params).parse(wireValue)).toStrictEqual(apiValue);
  });

  it("preserves Stagehand log data keys while encoding notifications", () => {
    const paramsSchema = StagehandNotifications.log.params;
    const encoded = encodeWireValue({
      level: "info",
      message: "Starting action",
      data: { doNotRenameMe: "value" },
    });

    expect(encoded).toMatchObject({
      level: "info",
      message: "Starting action",
      data: { doNotRenameMe: "value" },
    });
    expect(wireSchema(paramsSchema).parse(encoded)).toMatchObject({
      data: { doNotRenameMe: "value" },
    });
  });

  it("preserves arbitrary extraction result keys", () => {
    const definition = StagehandMethods.stagehandExtract;
    const apiValue = {
      result: { userName: "Sam" },
      actionId: "action_1",
    };
    const wireValue = {
      result: { userName: "Sam" },
      action_id: "action_1",
    };

    expect(encodeWireValue(apiValue, definition.resultWire)).toStrictEqual(wireValue);
    expect(wireSchema(definition.result, definition.resultWire).parse(wireValue)).toStrictEqual(
      apiValue,
    );
  });

  it("preserves JSON Schema keys in extraction requests", () => {
    const definition = StagehandMethods.stagehandExtract;
    const apiValue = {
      pageId: "page_1",
      instruction: "Extract the heading",
      schema: {
        type: "object",
        properties: { headingText: { type: "string" } },
        additionalProperties: false,
      },
    };
    const wireValue = {
      page_id: "page_1",
      instruction: "Extract the heading",
      schema: {
        type: "object",
        properties: { headingText: { type: "string" } },
        additionalProperties: false,
      },
    };

    expect(encodeWireValue(apiValue, definition.paramsWire)).toStrictEqual(wireValue);
    expect(wireSchema(definition.params, definition.paramsWire).parse(wireValue)).toStrictEqual(
      apiValue,
    );
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
    const requestSchema = asRecord(transport.request);
    const requestVariants = requestSchema.oneOf ?? requestSchema.anyOf;

    expect(Array.isArray(requestVariants)).toBe(true);
    for (const variant of requestVariants as unknown[]) {
      const request = asRecord(variant);
      expect(request.required).toContain("params");
      expectDeclaredPropertiesToBeSnakeCase(request, "transport.request");
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
    expect(isWirePropertyName(key), `${path}.${key} must use snake_case`).toBe(true);
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

function isWirePropertyName(key: string): boolean {
  return key.startsWith("$") || key.startsWith("_") || snakeCaseKey.test(key);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
