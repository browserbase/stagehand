import { z } from "zod/v4";
import type { WireCasingOptions } from "./wire-casing.ts";

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
  traceparent: z.string().optional(),
  tracestate: z.string().optional(),
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

export const JSONRPCMessageSchema = z.union([
  JSONRPCRequestSchema,
  JSONRPCNotificationSchema,
  JSONRPCResponseSchema,
]);

export const JSONRPCWireInputSchema = z.unknown().transform((input, context) => {
  if (typeof input !== "string") return input;

  try {
    return JSON.parse(input) as unknown;
  } catch {
    context.addIssue({ code: "custom", message: "Invalid JSON" });
    return z.NEVER;
  }
});

export const JSONRPCEnvelopeSchema = z.record(z.string(), z.unknown());

export type RPCMethod = {
  name: string;
  params: z.ZodType;
  result: z.ZodType;
  paramsWire?: WireCasingOptions;
  resultWire?: WireCasingOptions;
};

export type RPCNotification = {
  name: string;
  params: z.ZodType;
};
