import type { z } from "zod/v4";

export const isZodSchema = (value: unknown): value is z.ZodType =>
  typeof value === "object" &&
  value !== null &&
  "parse" in value &&
  typeof value.parse === "function" &&
  "safeParse" in value &&
  typeof value.safeParse === "function";
