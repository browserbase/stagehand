import { expectTypeOf } from "vite-plus/test";
import { z } from "zod/v4";
import { StagehandLogEventSchema } from "../../schemas.js";

const JsonValueSchema = z.json();

type JsonValue = z.infer<typeof JsonValueSchema>;
type ExpectedLogEvent = {
  requestId: string | number;
  method: string;
  eventName: string;
  timestamp: string;
  severityNumber: number;
  body: JsonValue;
  severityText?: string;
  attributes?: Record<string, JsonValue>;
  traceId?: string;
  spanId?: string;
};

expectTypeOf<z.input<typeof StagehandLogEventSchema>>().toEqualTypeOf<ExpectedLogEvent>();
expectTypeOf<z.output<typeof StagehandLogEventSchema>>().toEqualTypeOf<ExpectedLogEvent>();
