import { z } from "zod/v4";
export type WireCasingOptions = {
    /** API-side container keys whose nested, user-controlled keys must retain their casing. */
    readonly opaqueKeys?: readonly string[];
};
export declare function wireSchema<TSchema extends z.ZodType>(schema: TSchema, options?: WireCasingOptions): z.ZodType<z.output<TSchema>, unknown>;
export declare function encodeWireValue(value: unknown, options?: WireCasingOptions): z.core.util.JSONType;
export declare function toWireJsonSchema(value: unknown, preservedPropertyNames?: ReadonlySet<string>): unknown;
