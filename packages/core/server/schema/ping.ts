import { z } from "zod";

export const pingRequestSchema = z.object({
  message: z.string().min(1, "message is required"),
});

export const pingResponseSchema = z.object({
  message: z.string(),
});
