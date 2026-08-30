import { dereference, validate, Validator } from "@cfworker/json-schema";
import type { Schema } from "@cfworker/json-schema";
import { assertDynamicValueWork, schemaValidationWeight } from "./dynamic-json-schema-budget.js";
import { validateDynamicJsonSchema } from "./dynamic-json-schema-profile.js";
import type { DynamicJsonSchemaValidator } from "./dynamic-json-schema-types.js";
import { DynamicJsonSchemaError, isJsonObject } from "./dynamic-json-schema-types.js";
import { unescapeJsonPointerSegment } from "./dynamic-json-schema-references.js";
import type { DynamicJsonSchema } from "./dynamic-json-schema-types.js";

export { assertDynamicValidationWork } from "./dynamic-json-schema-budget.js";
export {
  closeUnspecifiedObjectAdditionalProperties,
  mapDynamicJsonSubschemas,
  relocateDynamicJsonSchemaReferences,
  resolveLocalJsonPointer,
} from "./dynamic-json-schema-references.js";
export { validateDynamicJsonSchema } from "./dynamic-json-schema-profile.js";
export type {
  DynamicJsonSchema,
  DynamicJsonSchemaIssue,
  DynamicJsonSchemaValidationResult,
  DynamicJsonSchemaValidator,
  JsonValue,
} from "./dynamic-json-schema-types.js";
export { DynamicJsonSchemaError, isJsonObject } from "./dynamic-json-schema-types.js";

/** Builds one bounded, CSP-safe validator over an isolated canonical schema. */
export function createDynamicJsonSchemaValidator<Output = unknown>(
  value: unknown,
): DynamicJsonSchemaValidator<Output> {
  const jsonSchema = validateDynamicJsonSchema(value);
  return createDynamicJsonSchemaValidatorFromValidated<Output>(jsonSchema);
}

/** Builds a validator for a schema already returned by validateDynamicJsonSchema. */
export function createDynamicJsonSchemaValidatorFromValidated<Output = unknown>(
  jsonSchema: DynamicJsonSchema,
): DynamicJsonSchemaValidator<Output> {
  let validator: Validator;
  try {
    validator = new Validator(jsonSchema as Schema, "2020-12", true);
  } catch (cause) {
    throw new DynamicJsonSchemaError(
      "The Draft 2020-12 interpreter could not construct a validator for this schema.",
      { cause },
    );
  }

  const schemaWeight = schemaValidationWeight(jsonSchema);
  return {
    jsonSchema,
    validate: (candidate) => {
      assertDynamicValueWork(schemaWeight, candidate);
      let result: ReturnType<Validator["validate"]>;
      try {
        result = validator.validate(candidate);
      } catch (cause) {
        if (cause instanceof DynamicJsonSchemaError) throw cause;
        throw new DynamicJsonSchemaError("Draft 2020-12 validation failed.", { cause });
      }
      if (result.valid) return { value: candidate as Output };
      return {
        issues: result.errors.map((error) => ({
          message: error.error,
          path: jsonPointerPath(error.instanceLocation),
        })),
      };
    },
  };
}

/** Builds a matcher for subschemas that retain references to the supplied root. */
export function createDynamicJsonSubschemaMatcher(
  root: DynamicJsonSchema,
): (schema: unknown, value: unknown) => boolean {
  let lookup: ReturnType<typeof dereference>;
  try {
    lookup = dereference(root as Schema);
  } catch (cause) {
    throw new DynamicJsonSchemaError("The Draft 2020-12 interpreter could not index this schema.", {
      cause,
    });
  }

  return (schema, value) => {
    if (typeof schema !== "boolean" && !isJsonObject(schema)) return false;
    try {
      return validate(value, schema as Schema | boolean, "2020-12", lookup, true).valid;
    } catch (cause) {
      throw new DynamicJsonSchemaError("Draft 2020-12 subschema matching failed.", { cause });
    }
  };
}

function jsonPointerPath(pointer: string): PropertyKey[] | undefined {
  if (pointer === "" || pointer === "#") return undefined;
  const normalized = pointer.startsWith("#") ? pointer.slice(1) : pointer;
  if (!normalized.startsWith("/")) return undefined;
  return normalized
    .slice(1)
    .split("/")
    .map((segment) => unescapeJsonPointerSegment(safeDecodePointerSegment(segment)));
}

function safeDecodePointerSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
