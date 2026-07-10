import { expectTypeOf } from "vite-plus/test";
import { z } from "zod/v4";
import {
  JSONRPCErrorResponseSchema,
  JSONRPCRequestSchema,
  JSONRPCSuccessResponseSchema,
} from "../schemas.js";

const JsonValueSchema = z.json();

type JsonValue = z.infer<typeof JsonValueSchema>;
type ExpectedRequest = {
  jsonrpc: "2.0";
  method: string;
  params?: JsonValue[] | Record<string, JsonValue>;
  id?: string | number;
};
type ExpectedSuccessResponse = {
  jsonrpc: "2.0";
  result: JsonValue;
  id: string | number;
};
type ExpectedErrorResponse = {
  jsonrpc: "2.0";
  error: {
    code: number;
    message: string;
    data?: JsonValue;
  };
  id: string | number | null;
};

expectTypeOf<z.input<typeof JSONRPCRequestSchema>>().toEqualTypeOf<ExpectedRequest>();
expectTypeOf<z.output<typeof JSONRPCRequestSchema>>().toEqualTypeOf<ExpectedRequest>();
expectTypeOf<
  z.input<typeof JSONRPCSuccessResponseSchema>
>().toEqualTypeOf<ExpectedSuccessResponse>();
expectTypeOf<
  z.output<typeof JSONRPCSuccessResponseSchema>
>().toEqualTypeOf<ExpectedSuccessResponse>();
expectTypeOf<z.input<typeof JSONRPCErrorResponseSchema>>().toEqualTypeOf<ExpectedErrorResponse>();
expectTypeOf<z.output<typeof JSONRPCErrorResponseSchema>>().toEqualTypeOf<ExpectedErrorResponse>();
