import { expectTypeOf } from "vite-plus/test";
import type { z } from "zod/v4";
import {
  StagehandMethodSchema,
  StagehandNotifications,
  StagehandRPC,
  StagehandRpcNotificationSchema,
  StagehandRpcRequestSchema,
} from "../../schema-registry.js";
import { StagehandLogSchema } from "../../schemas.js";

type StagehandRequest = z.output<typeof StagehandRpcRequestSchema>;
type StagehandNotification = z.output<typeof StagehandRpcNotificationSchema>;
type LogNotification = Extract<StagehandNotification, { method: "stagehand.log" }>;
type RegisteredStagehandMethod = (typeof StagehandRPC)[keyof typeof StagehandRPC]["name"];

expectTypeOf(StagehandRPC.pageGoto.name).toEqualTypeOf<"page.goto">();
expectTypeOf<z.input<typeof StagehandRPC.pageGoto.params>>().toEqualTypeOf<{
  pageId: string;
  url: string;
  options?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  };
}>();
expectTypeOf(StagehandRPC.browserGetVersion.name).toEqualTypeOf<"browser.get_version">();
expectTypeOf<z.input<typeof StagehandRPC.browserGetVersion.params>>().toEqualTypeOf<
  Record<string, never>
>();
expectTypeOf(StagehandRPC.locatorSelectOption.name).toEqualTypeOf<"locator.select_option">();
expectTypeOf<z.input<typeof StagehandRPC.locatorSelectOption.params>>().toEqualTypeOf<{
  pageId: string;
  selector: string;
  nth?: number;
  values: string | string[];
}>();
expectTypeOf<z.output<typeof StagehandRPC.locatorSelectOption.result>>().toEqualTypeOf<{
  values: string[];
}>();
expectTypeOf<StagehandRequest["method"]>().toEqualTypeOf<z.output<typeof StagehandMethodSchema>>();
expectTypeOf<z.output<typeof StagehandMethodSchema>>().toEqualTypeOf<RegisteredStagehandMethod>();
expectTypeOf(StagehandNotifications.log.name).toEqualTypeOf<"stagehand.log">();
expectTypeOf<LogNotification["method"]>().toEqualTypeOf<"stagehand.log">();
expectTypeOf<LogNotification["params"]>().toEqualTypeOf<z.output<typeof StagehandLogSchema>>();
