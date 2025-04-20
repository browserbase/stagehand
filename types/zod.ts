import { z, ZodError } from "zod";

export interface ZodValidationResult {
  success: boolean;
  error?: ZodError;
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
      error: error instanceof ZodError ? error : new ZodError([]),
    };
  }
}
