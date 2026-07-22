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

const JSONRPCParamsSchema = z
  .union([z.array(z.json()), z.record(z.string(), z.json())])
  .meta({ id: "JSONRPCParams" });
export const JSONRPCRequestIdSchema = z.int().nonnegative().meta({ id: "JSONRPCRequestId" });
const JSONRPCErrorResponseIdSchema = z
  .union([JSONRPCRequestIdSchema, z.null()])
  .meta({ id: "JSONRPCErrorResponseId" });

export const JSONRPCErrorObjectSchema = z
  .strictObject({
    code: z.int(),
    message: z.string(),
    data: z.json().optional(),
  })
  .meta({ id: "JSONRPCErrorObject" });

export const JSONRPCRequestSchema = z
  .strictObject({
    jsonrpc: z.literal("2.0"),
    id: JSONRPCRequestIdSchema,
    method: z.string(),
    params: JSONRPCParamsSchema.optional(),
    traceparent: z.string().optional(),
    tracestate: z.string().optional(),
  })
  .meta({ id: "JSONRPCRequest" });

export const JSONRPCNotificationSchema = z
  .strictObject({
    jsonrpc: z.literal("2.0"),
    method: z.string(),
    params: JSONRPCParamsSchema.optional(),
  })
  .meta({ id: "JSONRPCNotification" });

export const JSONRPCSuccessResponseSchema = z
  .strictObject({
    jsonrpc: z.literal("2.0"),
    result: z.json(),
    id: JSONRPCRequestIdSchema,
  })
  .meta({ id: "JSONRPCSuccessResponse" });

export const JSONRPCErrorResponseSchema = z
  .strictObject({
    jsonrpc: z.literal("2.0"),
    error: JSONRPCErrorObjectSchema,
    id: JSONRPCErrorResponseIdSchema,
  })
  .meta({ id: "JSONRPCErrorResponse" });

export const JSONRPCResponseSchema = z
  .union([JSONRPCSuccessResponseSchema, JSONRPCErrorResponseSchema])
  .meta({ id: "JSONRPCResponse" });

export const JSONRPCMessageSchema = z
  .union([JSONRPCRequestSchema, JSONRPCNotificationSchema, JSONRPCResponseSchema])
  .meta({ id: "JSONRPCMessage" });

export const JSONRPCWireInputSchema = z
  .unknown()
  .transform((input, context) => {
    if (typeof input !== "string") return input;

    try {
      return JSON.parse(input) as unknown;
    } catch {
      context.addIssue({ code: "custom", message: "Invalid JSON" });
      return z.NEVER;
    }
  })
  .meta({ id: "JSONRPCWireInput" });

export const JSONRPCEnvelopeSchema = z
  .record(z.string(), z.unknown())
  .meta({ id: "JSONRPCEnvelope" });

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
