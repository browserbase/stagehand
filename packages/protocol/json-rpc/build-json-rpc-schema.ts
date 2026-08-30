import { writeFile } from "node:fs/promises";
import { z } from "zod/v4";
import { StagehandMethods, StagehandNotifications } from "../schema-registry.ts";
import { BrowserbaseSessionCreateParamsSchema } from "../schemas.ts";
import {
  JSONRPCErrorResponseSchema,
  JSONRPCNotificationSchema,
  JSONRPCRequestSchema,
  JSONRPCSuccessResponseSchema,
} from "./schemas.ts";
import { toWireJsonSchema } from "./wire-casing.ts";

const PROTOCOL_DOCUMENT_ID = "stagehand.v4" as const;

const methodEntries = Object.values(StagehandMethods);
const notificationEntries = Object.values(StagehandNotifications);

const notificationEnvelopeSchemas = notificationEntries.map((notification) =>
  JSONRPCNotificationSchema.extend({
    method: z.literal(notification.name),
    params: notification.params,
  }),
);
const requestEnvelopeSchemas = methodEntries.map((method) =>
  JSONRPCRequestSchema.extend({
    method: z.literal(method.name),
    params: method.params,
  }),
);

const StagehandProtocolDocumentSchema = z
  .strictObject({
    methods: z.strictObject(
      Object.fromEntries(
        methodEntries.map((method) => [
          method.name,
          z.strictObject({ params: method.params, result: method.result }),
        ]),
      ),
    ),
    notifications: z.strictObject(
      Object.fromEntries(
        notificationEntries.map((notification) => [
          notification.name,
          z.strictObject({ params: notification.params }),
        ]),
      ),
    ),
    legacyClientModels: z
      .strictObject({
        browserbaseSessionCreateParams: BrowserbaseSessionCreateParamsSchema,
      })
      .optional(),
    jsonrpc: z.strictObject({
      request: z
        .union([requestEnvelopeSchemas[0]!, ...requestEnvelopeSchemas.slice(1)])
        .meta({ id: "StagehandRpcRequest" }),
      notification: (notificationEnvelopeSchemas.length === 1
        ? notificationEnvelopeSchemas[0]!
        : z.union([notificationEnvelopeSchemas[0]!, ...notificationEnvelopeSchemas.slice(1)])
      ).meta({ id: "StagehandRpcNotification" }),
      successResponse: JSONRPCSuccessResponseSchema,
      errorResponse: JSONRPCErrorResponseSchema,
    }),
  })
  .meta({ id: "StagehandProtocolDocument", title: "Stagehand V4 Protocol" });

function buildStagehandProtocolDocument(): Record<string, unknown> {
  const preservedDocumentPropertyNames = new Set([
    "methods",
    "notifications",
    "jsonrpc",
    "request",
    "notification",
    "successResponse",
    "errorResponse",
    "params",
    "result",
    ...methodEntries.map((method) => method.name),
    ...notificationEntries.map((notification) => notification.name),
  ]);
  const generated = toWireJsonSchema(
    preserveProtocolUnionEncoding(
      z.toJSONSchema(StagehandProtocolDocumentSchema, {
        io: "input",
        target: "draft-2020-12",
      }),
    ),
    preservedDocumentPropertyNames,
  ) as Record<string, unknown>;
  const { $schema, ...document } = generated;
  return {
    $schema,
    $id: `https://stagehand.dev/schema/${PROTOCOL_DOCUMENT_ID}.json`,
    ...document,
  };
}

function preserveProtocolUnionEncoding(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(preserveProtocolUnionEncoding);
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) =>
      key === "type" && Array.isArray(entry)
        ? ["anyOf", entry.map((type) => ({ type }))]
        : [key, preserveProtocolUnionEncoding(entry)],
    ),
  );
}

await writeFile(
  new URL(`../${PROTOCOL_DOCUMENT_ID}.json`, import.meta.url),
  `${JSON.stringify(buildStagehandProtocolDocument(), null, 2)}\n`,
  "utf8",
);
