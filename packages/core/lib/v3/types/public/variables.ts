import { z } from "zod/v4";
import type { VariableValue, Variables } from "./agent.js";

type VariablePrimitive = string | number | boolean;

export const VariablePrimitiveSchema: z.ZodType<VariablePrimitive> = z
  .union([z.string(), z.number(), z.boolean()])
  .meta({ id: "VariablePrimitive" });

export const VariableValueSchema: z.ZodType<VariableValue> = z
  .union([
    VariablePrimitiveSchema,
    z
      .object({
        value: VariablePrimitiveSchema,
        description: z.string().optional(),
      })
      .strict(),
  ])
  .meta({ id: "VariableValue" });

export const VariablesSchema: z.ZodType<Variables> = z
  .record(z.string(), VariableValueSchema)
  .meta({ id: "Variables" });
