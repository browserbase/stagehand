import { z } from "zod/v4";

import { SessionIdSchema } from "./page.js";

export const LogEventSchema = z
  .object({
    eventId: z.string().min(1),
    eventParentIds: z.array(z.string().min(1)),
    createdAt: z.string().min(1),
    sessionId: SessionIdSchema,
    eventType: z.string().min(1),
    data: z
      .unknown()
      .optional()
      .meta({
        override: ({ jsonSchema }: { jsonSchema: Record<string, unknown> }) => {
          jsonSchema["x-stainless-any"] = true;
        },
      }),
  })
  .strict()
  .meta({ id: "LogEvent" });

export const LogQuerySchema = z
  .object({
    sessionId: SessionIdSchema.optional(),
    eventId: z.string().min(1).optional(),
    eventType: z.string().min(1).optional(),
    limit: z.coerce.number().int().positive().max(1000).optional(),
    follow: z.coerce.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.sessionId && !value.eventId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one scope filter (sessionId or eventId).",
        path: ["sessionId"],
      });
    }
  })
  .meta({ id: "LogQuery" });

export const LogResponseSchema = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        events: z.array(LogEventSchema),
      })
      .strict(),
  })
  .strict()
  .meta({ id: "LogResponse" });

export const LogErrorResponseSchema = z
  .object({
    success: z.literal(false),
    message: z.string(),
  })
  .strict()
  .meta({ id: "LogErrorResponse" });

export const logOpenApiComponents = {
  schemas: {
    LogEvent: LogEventSchema,
    LogQuery: LogQuerySchema,
    LogResponse: LogResponseSchema,
    LogErrorResponse: LogErrorResponseSchema,
  },
} as const;

export type LogQuery = z.infer<typeof LogQuerySchema>;
