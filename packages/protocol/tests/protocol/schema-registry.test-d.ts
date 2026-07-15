import { expectTypeOf } from "vite-plus/test";
import type { z } from "zod/v4";
import {
  StagehandRpcNotificationSchema,
  StagehandRpcRequestSchema,
} from "../../schema-registry.js";
import {
  EmptyParamsSchema,
  LocatorSelectOptionParamsSchema,
  LocatorSelectOptionResultSchema,
  PageGotoParamsSchema,
  StagehandLogSchema,
} from "../../schemas.js";

type StagehandRequest = z.output<typeof StagehandRpcRequestSchema>;
type PageGotoRequest = Extract<StagehandRequest, { method: "page.goto" }>;
type BrowserGetVersionRequest = Extract<StagehandRequest, { method: "browser.get_version" }>;
type LocatorSelectOptionRequest = Extract<StagehandRequest, { method: "locator.select_option" }>;
type StagehandNotification = z.output<typeof StagehandRpcNotificationSchema>;
type LogNotification = Extract<StagehandNotification, { method: "stagehand.log" }>;

expectTypeOf<PageGotoRequest["method"]>().toEqualTypeOf<"page.goto">();
expectTypeOf<PageGotoRequest["params"]>().toEqualTypeOf<z.output<typeof PageGotoParamsSchema>>();
expectTypeOf<BrowserGetVersionRequest["method"]>().toEqualTypeOf<"browser.get_version">();
expectTypeOf<BrowserGetVersionRequest["params"]>().toEqualTypeOf<
  z.output<typeof EmptyParamsSchema>
>();
expectTypeOf<LocatorSelectOptionRequest["method"]>().toEqualTypeOf<"locator.select_option">();
expectTypeOf<LocatorSelectOptionRequest["params"]>().toEqualTypeOf<
  z.output<typeof LocatorSelectOptionParamsSchema>
>();
expectTypeOf<z.output<typeof LocatorSelectOptionResultSchema>>().toEqualTypeOf<{
  values: string[];
}>();
expectTypeOf<LogNotification["method"]>().toEqualTypeOf<"stagehand.log">();
expectTypeOf<LogNotification["params"]>().toEqualTypeOf<z.output<typeof StagehandLogSchema>>();
