import { z } from "zod";

import { DriverCommandNameSchema } from "../commands/types.js";

const RequestBaseSchema = z.object({
  id: z.string().min(1),
});

export const OpenRequestSchema = RequestBaseSchema.extend({
  type: z.literal("open"),
  timeoutMs: z.number().int().positive().optional(),
  url: z.string().min(1),
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
});

export const CommandRequestSchema = RequestBaseSchema.extend({
  command: DriverCommandNameSchema,
  params: z.unknown().optional(),
  type: z.literal("command"),
});

export const StatusRequestSchema = RequestBaseSchema.extend({
  type: z.literal("status"),
});

export const StopRequestSchema = RequestBaseSchema.extend({
  type: z.literal("stop"),
});

export const RequestSchema = z.discriminatedUnion("type", [
  OpenRequestSchema,
  CommandRequestSchema,
  StatusRequestSchema,
  StopRequestSchema,
]);

export const SuccessResponseSchema = z.object({
  data: z.unknown(),
  id: z.string(),
  type: z.literal("success"),
});

export const ErrorResponseSchema = z.object({
  error: z.string(),
  id: z.string().optional(),
  type: z.literal("error"),
});

export const ResponseSchema = z.discriminatedUnion("type", [
  SuccessResponseSchema,
  ErrorResponseSchema,
]);

export type DriverRequest = z.infer<typeof RequestSchema>;
export type DriverResponse = z.infer<typeof ResponseSchema>;

export function parseRequest(line: string): DriverRequest {
  return RequestSchema.parse(JSON.parse(line));
}

export function serializeResponse(response: DriverResponse): string {
  return `${JSON.stringify(ResponseSchema.parse(response))}\n`;
}
