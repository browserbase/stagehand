import { z } from "zod";
import type {
  ZodObject as Zod4Object,
  ZodRawShape as Zod4RawShape,
  ZodTypeAny as Zod4TypeAny,
} from "zod";
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

// Manual converter for zod/v3 schemas to JSON Schema
function ZodToJsonSchema(schema: z3.ZodTypeAny): JsonSchemaDocument {
  const _def = (schema as unknown as { _def?: Record<string, unknown> })._def;
  
  if (!_def) {
    return { type: "null" };
  }
  
  const typeName = _def.typeName;
  
  switch (typeName) {
    case "ZodObject": {
      const shape = typeof _def.shape === "function" ? _def.shape() : _def.shape;
      const properties: Record<string, JsonSchemaDocument> = {};
      const required: string[] = [];
      
      for (const [key, value] of Object.entries(shape as Record<string, z3.ZodTypeAny>)) {
        properties[key] = ZodToJsonSchema(value);
        // Check if field is not optional
        const valueDef = (value as unknown as { _def?: { typeName?: string } })._def;
        if (valueDef?.typeName !== "ZodOptional") {
          required.push(key);
        }
      }
      
      return {
        type: "object",
        properties,
        required,
        additionalProperties: _def.unknownKeys === "passthrough",
      };
    }
    
    case "ZodArray": {
      const itemType = _def.type as z3.ZodTypeAny;
      return {
        type: "array",
        items: ZodToJsonSchema(itemType),
      };
    }
    
    case "ZodString": {
      const result: JsonSchemaDocument = { type: "string" };
      // Check for URL validation
      const checks = _def.checks as Array<{ kind?: string }> | undefined;
      if (checks) {
        for (const check of checks) {
          if (check.kind === "url") {
            result.format = "url";
            break;
          }
        }
      }
      return result;
    }
    
    case "ZodNumber":
      return { type: "number" };
    
    case "ZodBoolean":
      return { type: "boolean" };
    
    case "ZodOptional":
      return ZodToJsonSchema(_def.innerType as z3.ZodTypeAny);
    
    case "ZodNullable": {
      const innerSchema = ZodToJsonSchema(_def.innerType as z3.ZodTypeAny);
      return {
        ...innerSchema,
        nullable: true,
      };
    }
    
    case "ZodEnum":
      return {
        type: "string",
        enum: _def.values,
      };
    
    case "ZodLiteral":
      return {
        type: typeof _def.value,
        const: _def.value,
      };
    
    case "ZodUnion":
      return {
        anyOf: (_def.options as z3.ZodTypeAny[]).map((opt) => ZodToJsonSchema(opt)),
      };
    
    default:
      console.warn(`Unknown Zod type: ${typeName}`);
      return { type: "null" };
  }
}

export function toJsonSchema(
  schema: StagehandZodSchema,
): JsonSchemaDocument {
  // For v3 schemas, use manual converter
  // Note: We can't use zod-to-json-schema for v3 schemas when zod v4 is installed
  // because the library imports 'zod' (v4) and tries to access ZodFirstPartyTypeKind which doesn't exist in v4
  if (!isZod4Schema(schema)) {
    const result = {
      $schema: "http://json-schema.org/draft-07/schema#",
      ...ZodToJsonSchema(schema),
    };
    return result;
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
