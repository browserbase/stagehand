import { expectTypeOf } from "vite-plus/test";
import type { z } from "zod/v4";
import {
  StagehandRpcNotificationSchema,
  StagehandRpcRequestSchema,
} from "../../schema-registry.js";
import { PageGotoParamsSchema, StagehandLogEventSchema } from "../../schemas.js";

type StagehandRequest = z.output<typeof StagehandRpcRequestSchema>;
type PageGotoRequest = Extract<StagehandRequest, { method: "page.goto" }>;
type StagehandNotification = z.output<typeof StagehandRpcNotificationSchema>;
type LogEventNotification = Extract<StagehandNotification, { method: "stagehand.log_event" }>;

expectTypeOf<PageGotoRequest["method"]>().toEqualTypeOf<"page.goto">();
expectTypeOf<PageGotoRequest["params"]>().toEqualTypeOf<z.output<typeof PageGotoParamsSchema>>();
expectTypeOf<LogEventNotification["method"]>().toEqualTypeOf<"stagehand.log_event">();
expectTypeOf<LogEventNotification["params"]>().toEqualTypeOf<
  z.output<typeof StagehandLogEventSchema>
>();
