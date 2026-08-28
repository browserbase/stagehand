import { expectTypeOf } from "vitest";
import type { z } from "zod/v4";
import {
  StagehandMethodSchema,
  StagehandNotifications,
  StagehandMethods,
  StagehandRpcNotificationSchema,
  StagehandRpcRequestSchema,
} from "../../schema-registry.js";
import { StagehandLogSchema } from "../../schemas.js";

type StagehandRequest = z.output<typeof StagehandRpcRequestSchema>;
type StagehandNotification = z.output<typeof StagehandRpcNotificationSchema>;
type LogNotification = Extract<StagehandNotification, { method: "stagehand.log" }>;
type RegisteredStagehandMethod = (typeof StagehandMethods)[keyof typeof StagehandMethods]["name"];

expectTypeOf(StagehandMethods.contextActivePage.name).toEqualTypeOf<"context.active_page">();
expectTypeOf<z.output<typeof StagehandMethods.contextActivePage.result>>().toEqualTypeOf<{
  pageId: string;
  url?: string;
  title?: string;
} | null>();
expectTypeOf(
  StagehandMethods.contextSetDomainPolicy.name,
).toEqualTypeOf<"context.set_domain_policy">();
expectTypeOf<z.input<typeof StagehandMethods.contextSetDomainPolicy.params>>().toEqualTypeOf<{
  policy: {
    allowedDomains?: string[];
    blockedDomains?: string[];
  } | null;
}>();
expectTypeOf(StagehandMethods.contextClearCookies.name).toEqualTypeOf<"context.clear_cookies">();
expectTypeOf<z.input<typeof StagehandMethods.contextClearCookies.params>>().toEqualTypeOf<{
  options?: {
    name?: string | { source: string; flags?: string };
    domain?: string | { source: string; flags?: string };
    path?: string | { source: string; flags?: string };
  };
}>();
expectTypeOf(
  StagehandMethods.contextClipboardWriteText.name,
).toEqualTypeOf<"context.clipboard_write_text">();
expectTypeOf<z.input<typeof StagehandMethods.contextClipboardWriteText.params>>().toEqualTypeOf<{
  pageId?: string;
  text: string;
}>();
expectTypeOf(StagehandMethods.pageGoto.name).toEqualTypeOf<"page.goto">();
expectTypeOf<z.input<typeof StagehandMethods.pageGoto.params>>().toEqualTypeOf<{
  pageId: string;
  url: string;
  options?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeout?: number;
  };
}>();
expectTypeOf<z.output<typeof StagehandMethods.pageGoto.result>>().toEqualTypeOf<{
  page: {
    pageId: string;
    url?: string;
    title?: string;
  };
  response: {
    responseId: string;
    url: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    fromServiceWorker: boolean;
  } | null;
}>();
expectTypeOf(StagehandMethods.pageReload.name).toEqualTypeOf<"page.reload">();
expectTypeOf<z.input<typeof StagehandMethods.pageReload.params>>().toEqualTypeOf<{
  pageId: string;
  options?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeout?: number;
    ignoreCache?: boolean;
  };
}>();
expectTypeOf(StagehandMethods.responseBody.name).toEqualTypeOf<"response.body">();
expectTypeOf<z.input<typeof StagehandMethods.responseBody.params>>().toEqualTypeOf<{
  responseId: string;
}>();
expectTypeOf<z.output<typeof StagehandMethods.responseBody.result>>().toEqualTypeOf<{
  body: string;
  base64Encoded: true;
}>();
expectTypeOf(StagehandMethods.pageDragAndDrop.name).toEqualTypeOf<"page.drag_and_drop">();
expectTypeOf<z.output<typeof StagehandMethods.pageDragAndDrop.result>>().toEqualTypeOf<{
  ok: true;
}>();
expectTypeOf(StagehandMethods.pageScreenshot.name).toEqualTypeOf<"page.screenshot">();
expectTypeOf<z.output<typeof StagehandMethods.pageScreenshot.result>>().toEqualTypeOf<{
  data: string;
}>();
expectTypeOf(StagehandMethods.pageWaitForSelector.name).toEqualTypeOf<"page.wait_for_selector">();
expectTypeOf<z.output<typeof StagehandMethods.pageWaitForSelector.result>>().toEqualTypeOf<{
  matched: boolean;
}>();
expectTypeOf(StagehandMethods.locatorSelectOption.name).toEqualTypeOf<"locator.select_option">();
expectTypeOf<z.input<typeof StagehandMethods.locatorSelectOption.params>>().toEqualTypeOf<{
  pageId: string;
  selector: string;
  nth?: number;
  values: string | string[];
}>();
expectTypeOf<z.output<typeof StagehandMethods.locatorSelectOption.result>>().toEqualTypeOf<
  string[]
>();
expectTypeOf(StagehandMethods.locatorSetInputFiles.name).toEqualTypeOf<"locator.set_input_files">();
expectTypeOf<z.input<typeof StagehandMethods.locatorSetInputFiles.params>>().toEqualTypeOf<{
  pageId: string;
  selector: string;
  nth?: number;
  files: Array<{
    name: string;
    mimeType?: string;
    data: string;
    lastModified?: number;
  }>;
}>();
expectTypeOf<z.output<typeof StagehandMethods.locatorSetInputFiles.result>>().toEqualTypeOf<{
  set: true;
}>();
expectTypeOf<StagehandRequest["method"]>().toEqualTypeOf<z.output<typeof StagehandMethodSchema>>();
expectTypeOf<z.output<typeof StagehandMethodSchema>>().toEqualTypeOf<RegisteredStagehandMethod>();
expectTypeOf(StagehandNotifications.log.name).toEqualTypeOf<"stagehand.log">();
expectTypeOf<LogNotification["method"]>().toEqualTypeOf<"stagehand.log">();
expectTypeOf<LogNotification["params"]>().toEqualTypeOf<z.output<typeof StagehandLogSchema>>();
