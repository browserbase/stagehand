import { expectTypeOf } from "vite-plus/test";
import { z } from "zod/v4";
import * as JSONRPCSchemas from "../schemas.js";

const JsonValueSchema = z.json();

type JsonValue = z.infer<typeof JsonValueSchema>;
type ExpectedNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: JsonValue[] | Record<string, JsonValue>;
};
type HasNotificationSchema = "JSONRPCNotificationSchema" extends keyof typeof JSONRPCSchemas
  ? true
  : false;
type NotificationSchema = typeof JSONRPCSchemas extends {
  readonly JSONRPCNotificationSchema: infer TSchema extends z.ZodType;
}
  ? TSchema
  : z.ZodType<ExpectedNotification, ExpectedNotification>;
type NotificationInput = z.input<NotificationSchema>;
type NotificationOutput = z.output<NotificationSchema>;

const notificationSchemaIsExported: true = null as unknown as HasNotificationSchema;

expectTypeOf<NotificationInput>().toEqualTypeOf<NotificationOutput>();
expectTypeOf<NotificationOutput>().toEqualTypeOf<ExpectedNotification>();

void notificationSchemaIsExported;
