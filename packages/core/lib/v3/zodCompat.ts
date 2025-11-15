import { z } from "zod";
import type {
  ZodObject as Zod4Object,
  ZodRawShape as Zod4RawShape,
  ZodTypeAny as Zod4TypeAny,
} from "zod";
import type * as z3 from "zod/v3";
import { zodToJsonSchema } from "zod-to-json-schema";

export type StagehandZodSchema = Zod4TypeAny | z3.ZodTypeAny;

export type StagehandZodObject =
  | Zod4Object<Zod4RawShape>
  | z3.ZodObject<z3.ZodRawShape>;

export type InferStagehandSchema<T extends StagehandZodSchema> =
  T extends z3.ZodTypeAny
    ? z3.infer<T>
    : T extends Zod4TypeAny
      ? z.infer<T>
      : never;

export const isZod4Schema = (
  schema: StagehandZodSchema,
): schema is Zod4TypeAny & { _zod: unknown } =>
  typeof (schema as { _zod?: unknown })._zod !== "undefined";

export const isZod3Schema = (
  schema: StagehandZodSchema,
): schema is z3.ZodTypeAny => !isZod4Schema(schema);

export type JsonSchemaDocument = Record<string, unknown>;

export function toJsonSchema(
  schema: StagehandZodSchema,
  options?: Parameters<typeof zodToJsonSchema>[1],
): JsonSchemaDocument {
  if (
    isZod4Schema(schema) &&
    typeof (z as unknown as { toJSONSchema?: unknown }).toJSONSchema ===
      "function" &&
    !options
  ) {
    return (
      z as unknown as {
        toJSONSchema: (input: Zod4TypeAny) => JsonSchemaDocument;
      }
    ).toJSONSchema(schema as Zod4TypeAny);
  }

  return zodToJsonSchema(
    schema as unknown as z.ZodTypeAny,
    options ?? { $refStrategy: "none" },
  ) as JsonSchemaDocument;
}
