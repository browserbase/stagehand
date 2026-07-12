import { z } from "zod/v4";
import { wireSchema } from "./wire-casing.ts";

// JSON-RPC 2.0: https://www.jsonrpc.org/specification

export const JSONRPCErrorCodes = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

const JSONRPCParamsSchema = z.union([z.array(z.json()), z.record(z.string(), z.json())]);
export const JSONRPCRequestIdSchema = z.int().nonnegative();
const JSONRPCErrorResponseIdSchema = z.union([JSONRPCRequestIdSchema, z.null()]);

export const JSONRPCErrorObjectSchema = z.strictObject({
  code: z.int(),
  message: z.string(),
  data: z.json().optional(),
});

export const JSONRPCRequestSchema = z.strictObject({
  jsonrpc: z.literal("2.0"),
  id: JSONRPCRequestIdSchema,
  method: z.string(),
  params: JSONRPCParamsSchema.optional(),
});

export const JSONRPCNotificationSchema = z.strictObject({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  params: JSONRPCParamsSchema.optional(),
});

export const JSONRPCSuccessResponseSchema = z.strictObject({
  jsonrpc: z.literal("2.0"),
  result: z.json(),
  id: JSONRPCRequestIdSchema,
});

export const JSONRPCErrorResponseSchema = z.strictObject({
  jsonrpc: z.literal("2.0"),
  error: JSONRPCErrorObjectSchema,
  id: JSONRPCErrorResponseIdSchema,
});

export const JSONRPCResponseSchema = z.union([
  JSONRPCSuccessResponseSchema,
  JSONRPCErrorResponseSchema,
]);

export const JSONRPCRequestBatchSchema = z
  .array(z.union([JSONRPCRequestSchema, JSONRPCNotificationSchema]))
  .min(1);
export const JSONRPCResponseBatchSchema = z.array(JSONRPCResponseSchema).min(1);

type MethodRegistry = Record<
  string,
  {
    paramsSchema: z.ZodType;
    resultSchema: z.ZodType;
  }
>;
type NotificationRegistry = Record<
  string,
  {
    paramsSchema: z.ZodType;
  }
>;
type RegistryKey<TRegistry> = Extract<keyof TRegistry, string>;

type RpcRequestInput<TMethods extends MethodRegistry> = {
  [TMethod in RegistryKey<TMethods>]: {
    jsonrpc: "2.0";
    id: z.input<typeof JSONRPCRequestIdSchema>;
    method: TMethod;
    params: unknown;
  };
}[RegistryKey<TMethods>];

type RpcRequestOutput<TMethods extends MethodRegistry> = {
  [TMethod in RegistryKey<TMethods>]: {
    jsonrpc: "2.0";
    id: z.output<typeof JSONRPCRequestIdSchema>;
    method: TMethod;
    params: z.output<TMethods[TMethod]["paramsSchema"]>;
  };
}[RegistryKey<TMethods>];

type RpcNotificationInput<TNotifications extends NotificationRegistry> = {
  [TMethod in RegistryKey<TNotifications>]: {
    jsonrpc: "2.0";
    method: TMethod;
    params: unknown;
  };
}[RegistryKey<TNotifications>];

type RpcNotificationOutput<TNotifications extends NotificationRegistry> = {
  [TMethod in RegistryKey<TNotifications>]: {
    jsonrpc: "2.0";
    method: TMethod;
    params: z.output<TNotifications[TMethod]["paramsSchema"]>;
  };
}[RegistryKey<TNotifications>];

export function createRpcSchemas<
  TMethods extends MethodRegistry,
  TNotifications extends NotificationRegistry,
>(methods: TMethods, notifications: TNotifications) {
  const requestSchemas = Object.entries(methods).map(([methodName, definition]) =>
    z.strictObject({
      jsonrpc: z.literal("2.0"),
      id: JSONRPCRequestIdSchema,
      method: z.literal(methodName),
      params: wireSchema(definition.paramsSchema),
    }),
  );
  const notificationSchemas = Object.entries(notifications).map(([methodName, definition]) =>
    JSONRPCNotificationSchema.extend({
      method: z.literal(methodName),
      params: wireSchema(definition.paramsSchema),
    }),
  );

  return {
    requestSchema: discriminatedUnionSchemas<RpcRequestOutput<TMethods>, RpcRequestInput<TMethods>>(
      requestSchemas,
    ),
    notificationSchema: discriminatedUnionSchemas<
      RpcNotificationOutput<TNotifications>,
      RpcNotificationInput<TNotifications>
    >(notificationSchemas),
  };
}

function discriminatedUnionSchemas<TOutput, TInput>(
  schemas: z.ZodObject[],
): z.ZodType<TOutput, TInput> {
  if (schemas.length === 0) {
    throw new Error("A protocol registry must contain at least one entry");
  }
  return z.discriminatedUnion("method", schemas as [z.ZodObject, ...z.ZodObject[]]) as z.ZodType<
    TOutput,
    TInput
  >;
}
