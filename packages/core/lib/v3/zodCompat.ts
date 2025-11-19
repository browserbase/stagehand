import { z } from "zod";
import type {
  ZodObject as Zod4Object,
  ZodRawShape as Zod4RawShape,
  ZodTypeAny as Zod4TypeAny,
} from "zod";
import zodToJsonSchema from "zod-to-json-schema";
import type * as z3 from "zod/v3";
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

export function toJsonSchema(schema: StagehandZodSchema): JsonSchemaDocument {
  if (!isZod4Schema(schema)) {
    return zodToJsonSchema(schema);
  }

  // For v4 schemas, use built-in z.toJSONSchema() method
  const zodWithJsonSchema = z as typeof z & {
    toJSONSchema?: (schema: Zod4TypeAny) => JsonSchemaDocument;
  };

  if (zodWithJsonSchema.toJSONSchema) {
    return zodWithJsonSchema.toJSONSchema(schema as Zod4TypeAny);
  }

  // This should never happen with Zod v4.1+
  throw new Error("Zod v4 toJSONSchema method not found");
}
