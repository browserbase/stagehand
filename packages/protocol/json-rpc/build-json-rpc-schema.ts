import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import {
  StagehandMethods,
  StagehandNotifications,
  StagehandRpcNotificationSchema,
  StagehandRpcRequestSchema,
} from "../schema-registry.ts";
import { JSONRPCErrorResponseSchema, JSONRPCSuccessResponseSchema } from "./schemas.ts";
import { renameJsonSchemaProperties } from "./wire-casing.ts";

const STAGEHAND_PROTOCOL_VERSION = "stagehand.v4" as const;

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(packageDir, `${STAGEHAND_PROTOCOL_VERSION}.json`);
const transportRequestSchema = requireParams(
  renameJsonSchemaProperties(z.toJSONSchema(StagehandRpcRequestSchema)),
);
const transportNotificationSchema = requireParams(
  renameJsonSchemaProperties(z.toJSONSchema(StagehandRpcNotificationSchema)),
);

const methodSchemas = Object.fromEntries(
  Object.entries(StagehandMethods).map(([methodName, definition]) => [
    methodName,
    {
      type: "object",
      additionalProperties: false,
      properties: {
        params: renameJsonSchemaProperties(z.toJSONSchema(definition.paramsSchema)),
        result: renameJsonSchemaProperties(z.toJSONSchema(definition.resultSchema)),
      },
      required: ["params", "result"],
    },
  ]),
);

const notificationSchemas = Object.fromEntries(
  Object.entries(StagehandNotifications).map(([methodName, definition]) => [
    methodName,
    {
      type: "object",
      additionalProperties: false,
      properties: {
        params: renameJsonSchemaProperties(z.toJSONSchema(definition.paramsSchema)),
      },
      required: ["params"],
    },
  ]),
);

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `https://stagehand.dev/schema/${STAGEHAND_PROTOCOL_VERSION}.json`,
  title: "Stagehand V4 Protocol",
  type: "object",
  additionalProperties: false,
  properties: {
    transport: {
      type: "object",
      additionalProperties: false,
      properties: {
        request: transportRequestSchema,
        notification: transportNotificationSchema,
        successResponse: z.toJSONSchema(JSONRPCSuccessResponseSchema),
        errorResponse: z.toJSONSchema(JSONRPCErrorResponseSchema),
      },
      required: ["request", "notification", "successResponse", "errorResponse"],
    },
    methods: {
      type: "object",
      additionalProperties: false,
      properties: methodSchemas,
      required: Object.keys(methodSchemas),
    },
    notifications: {
      type: "object",
      additionalProperties: false,
      properties: notificationSchemas,
      required: Object.keys(notificationSchemas),
    },
  },
  required: ["transport", "methods", "notifications"],
};

await writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");

function requireParams(schema: unknown): unknown {
  if (!isRecord(schema)) return schema;
  if (Array.isArray(schema.oneOf)) {
    return { ...schema, oneOf: schema.oneOf.map(requireParams) };
  }
  if (!isRecord(schema.properties) || !("params" in schema.properties)) return schema;

  const required = Array.isArray(schema.required) ? schema.required : [];
  return {
    ...schema,
    required: required.includes("params") ? required : [...required, "params"],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
