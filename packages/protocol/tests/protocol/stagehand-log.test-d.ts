import { expectTypeOf } from "vite-plus/test";
import { z } from "zod/v4";
import { StagehandLogSchema } from "../../schemas.js";

const JsonValueSchema = z.json();

type JsonValue = z.infer<typeof JsonValueSchema>;
type ExpectedLog = {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: Record<string, JsonValue>;
};

expectTypeOf<z.input<typeof StagehandLogSchema>>().toEqualTypeOf<ExpectedLog>();
expectTypeOf<z.output<typeof StagehandLogSchema>>().toEqualTypeOf<ExpectedLog>();
