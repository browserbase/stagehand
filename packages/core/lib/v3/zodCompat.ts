import { z } from "zod";
import type {
  ZodObject as Zod4Object,
  ZodRawShape as Zod4RawShape,
  ZodTypeAny as Zod4TypeAny,
} from "zod";
import zodToJsonSchema from "zod-to-json-schema";
import type * as z3 from "zod/v3";
import { createRequire } from "node:module";
import { getCurrentFilePath } from "./runtimePaths.js";
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

// Lazy-init fallback: in transitional zod versions (e.g. 3.25.x), the root
// "zod" import is a v3-compat layer without toJSONSchema, but the real v4 API
// is available at "zod/v4". We resolve it once on first use.
let _zodV4ToJSONSchema: ((schema: Zod4TypeAny) => JsonSchemaDocument) | null =
  null;
let _zodV4Resolved = false;

function getZodV4ToJSONSchema(): typeof _zodV4ToJSONSchema {
  if (!_zodV4Resolved) {
    _zodV4Resolved = true;
    try {
      const req = createRequire(getCurrentFilePath());
      const zodV4 = req("zod/v4") as {
        toJSONSchema?: (schema: Zod4TypeAny) => JsonSchemaDocument;
      };
      _zodV4ToJSONSchema = zodV4.toJSONSchema ?? null;
    } catch {
      // zod/v4 subpath not available — will fall through to error below
    }
  }
  return _zodV4ToJSONSchema;
}

export function toJsonSchema(schema: StagehandZodSchema): JsonSchemaDocument {
  if (!isZod4Schema(schema)) {
    return zodToJsonSchema(schema);
  }

  // For v4 schemas, try the root z.toJSONSchema() first (works with zod >= 4.x)
  const zodWithJsonSchema = z as typeof z & {
    toJSONSchema?: (schema: Zod4TypeAny) => JsonSchemaDocument;
  };

  if (zodWithJsonSchema.toJSONSchema) {
    return zodWithJsonSchema.toJSONSchema(schema as Zod4TypeAny);
  }

  // Fallback: in transitional zod 3.25.x the root "zod" is v3, but
  // "zod/v4" exposes toJSONSchema.
  const v4Fallback = getZodV4ToJSONSchema();
  if (v4Fallback) {
    return v4Fallback(schema as Zod4TypeAny);
  }

  throw new Error(
    "Zod v4 schema detected but toJSONSchema is unavailable. " +
      'Ensure your zod version exposes toJSONSchema on the root export or via "zod/v4".',
  );
}
