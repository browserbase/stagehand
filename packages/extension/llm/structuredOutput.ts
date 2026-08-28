import { z } from "zod/v4";
import {
  createDynamicJsonSchemaValidator,
  createDynamicJsonSchemaValidatorFromValidated,
  validateDynamicJsonSchema,
} from "../../protocol/dynamic-json-schema.js";
import type {
  DynamicJsonSchema,
  DynamicJsonSchemaIssue,
  DynamicJsonSchemaValidator,
} from "../../protocol/dynamic-json-schema.js";

export interface StructuredOutputContract<
  Output = unknown,
> extends DynamicJsonSchemaValidator<Output> {
  readonly name: string;
}

/** Internal provider-facing validation error; never crosses the public SDK boundary. */
export class StructuredOutputValidationError extends TypeError {
  readonly issues: readonly DynamicJsonSchemaIssue[];

  constructor(issues: readonly DynamicJsonSchemaIssue[]) {
    super(
      issues.map((issue) => issue.message).join("; ") || "Structured output validation failed.",
    );
    this.name = "StructuredOutputValidationError";
    this.issues = issues;
  }
}

/** Converts an extension-owned Zod schema into the canonical contract once. */
export function createZodStructuredOutputContract<Output>(
  name: string,
  schema: z.ZodType<Output>,
): StructuredOutputContract<Output> {
  const jsonSchema = z
    .json()
    .parse(z.toJSONSchema(schema, { io: "input", target: "draft-2020-12" }));
  const hardened = validateDynamicJsonSchema(jsonSchema);
  return {
    name,
    jsonSchema: hardened,
    validate: (value) => {
      const result = schema.safeParse(value);
      return result.success ? { value: result.data } : { issues: result.error.issues };
    },
  };
}

/** Creates the isolated canonical clone handed to one provider invocation. */
export function providerJsonSchema(
  schema: Record<string, unknown>,
  provider: string | undefined,
): Record<string, unknown> {
  try {
    return validateDynamicJsonSchema(schema);
  } catch (cause) {
    throw new TypeError(
      `${provider ? `Provider ${provider}` : "The selected provider"} cannot use the supplied Draft 2020-12 schema: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

/** Builds one request-scoped, CSP-safe Draft 2020-12 validation contract. */
export function createStructuredOutputContract(
  name: string,
  schema: Record<string, unknown>,
  provider?: string,
): StructuredOutputContract {
  try {
    return namedContract(name, createDynamicJsonSchemaValidator(schema));
  } catch (cause) {
    throw new TypeError(
      `${provider ? `Provider ${provider}` : `Structured output ${name}`} cannot use the supplied Draft 2020-12 schema: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

/** Builds a contract from a canonical schema already hardened at its trust boundary. */
export function createStructuredOutputContractFromValidated(
  name: string,
  schema: DynamicJsonSchema,
): StructuredOutputContract {
  return namedContract(name, createDynamicJsonSchemaValidatorFromValidated(schema));
}

function namedContract<Output>(
  name: string,
  contract: DynamicJsonSchemaValidator<Output>,
): StructuredOutputContract<Output> {
  return { name, jsonSchema: contract.jsonSchema, validate: contract.validate };
}
