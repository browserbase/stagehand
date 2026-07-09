import type { z } from "zod/v4";
import { VariablePrimitiveSchema, VariablesSchema, VariableValueSchema } from "./schemas.js";

export type VariablePrimitive = z.infer<typeof VariablePrimitiveSchema>;
export type VariableValue = z.infer<typeof VariableValueSchema>;
export type Variables = z.infer<typeof VariablesSchema>;
