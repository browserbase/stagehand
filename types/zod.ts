import { z } from "zod";

export type ZodValidationError = z.ZodError;

export interface ZodValidationResult {
  success: boolean;
  error?: ZodValidationError;
}

export function validateZodSchemaWithResult(
  schema: z.ZodTypeAny,
  data: unknown
): ZodValidationResult {
  try {
    schema.parse(data);
    return {
      success: true,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof z.ZodError ? error : new z.ZodError([]),
    };
  }
}
