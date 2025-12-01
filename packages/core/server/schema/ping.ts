import { z } from "zod";

const timestampSchema = z.coerce
  .bigint({ error: "timestamp value required"})
  .refine((value) => value > BigInt(0), {
    message: "timestamp must be greater than zero milliseconds",
  });

export const pingRequestSchema = z.object({
  clientSendTime: timestampSchema,
});

export const pingResponseSchema = z.object({
  clientSendTime: timestampSchema,
  serverSendTime: timestampSchema,
});
