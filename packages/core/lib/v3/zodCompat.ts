import { z, toJSONSchema as zodV4ToJsonSchema } from "zod";
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

  // Use the named import directly, which is resolved at module load time
  // and not susceptible to tree-shaking or bundler resolution issues
  // that can strip z.toJSONSchema from the namespace object.
  return zodV4ToJsonSchema(schema as Zod4TypeAny) as JsonSchemaDocument;
}
