import { z } from "zod/v4";
import type { WireCasingOptions } from "./wire-casing.ts";
export declare const JSONRPCErrorCodes: {
    readonly parseError: -32700;
    readonly invalidRequest: -32600;
    readonly methodNotFound: -32601;
    readonly invalidParams: -32602;
    readonly internalError: -32603;
};
export declare const JSONRPCRequestIdSchema: z.ZodInt;
export declare const JSONRPCErrorObjectSchema: z.ZodObject<{
    code: z.ZodInt;
    message: z.ZodString;
    data: z.ZodOptional<z.ZodJSONSchema>;
}, z.core.$strict>;
export declare const JSONRPCRequestSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodInt;
    method: z.ZodString;
    params: z.ZodOptional<z.ZodUnion<readonly [z.ZodArray<z.ZodJSONSchema>, z.ZodRecord<z.ZodString, z.ZodJSONSchema>]>>;
    traceparent: z.ZodOptional<z.ZodString>;
    tracestate: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const JSONRPCNotificationSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    method: z.ZodString;
    params: z.ZodOptional<z.ZodUnion<readonly [z.ZodArray<z.ZodJSONSchema>, z.ZodRecord<z.ZodString, z.ZodJSONSchema>]>>;
}, z.core.$strict>;
export declare const JSONRPCSuccessResponseSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    result: z.ZodJSONSchema;
    id: z.ZodInt;
}, z.core.$strict>;
export declare const JSONRPCErrorResponseSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    error: z.ZodObject<{
        code: z.ZodInt;
        message: z.ZodString;
        data: z.ZodOptional<z.ZodJSONSchema>;
    }, z.core.$strict>;
    id: z.ZodUnion<readonly [z.ZodInt, z.ZodNull]>;
}, z.core.$strict>;
export declare const JSONRPCResponseSchema: z.ZodUnion<readonly [z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    result: z.ZodJSONSchema;
    id: z.ZodInt;
}, z.core.$strict>, z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    error: z.ZodObject<{
        code: z.ZodInt;
        message: z.ZodString;
        data: z.ZodOptional<z.ZodJSONSchema>;
    }, z.core.$strict>;
    id: z.ZodUnion<readonly [z.ZodInt, z.ZodNull]>;
}, z.core.$strict>]>;
export declare const JSONRPCMessageSchema: z.ZodUnion<readonly [z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodInt;
    method: z.ZodString;
    params: z.ZodOptional<z.ZodUnion<readonly [z.ZodArray<z.ZodJSONSchema>, z.ZodRecord<z.ZodString, z.ZodJSONSchema>]>>;
    traceparent: z.ZodOptional<z.ZodString>;
    tracestate: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    method: z.ZodString;
    params: z.ZodOptional<z.ZodUnion<readonly [z.ZodArray<z.ZodJSONSchema>, z.ZodRecord<z.ZodString, z.ZodJSONSchema>]>>;
}, z.core.$strict>, z.ZodUnion<readonly [z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    result: z.ZodJSONSchema;
    id: z.ZodInt;
}, z.core.$strict>, z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    error: z.ZodObject<{
        code: z.ZodInt;
        message: z.ZodString;
        data: z.ZodOptional<z.ZodJSONSchema>;
    }, z.core.$strict>;
    id: z.ZodUnion<readonly [z.ZodInt, z.ZodNull]>;
}, z.core.$strict>]>]>;
export declare const JSONRPCWireInputSchema: z.ZodPipe<z.ZodUnknown, z.ZodTransform<unknown, unknown>>;
export declare const JSONRPCEnvelopeSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
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
