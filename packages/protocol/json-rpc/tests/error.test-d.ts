import { expectTypeOf } from "vite-plus/test";
import { z } from "zod/v4";
import { JSONRPCErrorObjectSchema } from "../schemas.js";

const JsonValueSchema = z.json();

type JsonValue = z.infer<typeof JsonValueSchema>;
type ExpectedErrorObject = {
  code: number;
  message: string;
  data?: JsonValue;
};

expectTypeOf<z.input<typeof JSONRPCErrorObjectSchema>>().toEqualTypeOf<ExpectedErrorObject>();
expectTypeOf<z.output<typeof JSONRPCErrorObjectSchema>>().toEqualTypeOf<ExpectedErrorObject>();
