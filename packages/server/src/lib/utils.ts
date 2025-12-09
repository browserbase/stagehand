import { StatusCodes } from "http-status-codes";
import { z } from "zod/v3";
import type { ZodTypeAny } from "zod/v3";

import { LegacyModel, LegacyProvider } from "../types/model.js";
import { AppError } from "./errorHandler.js";

interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  description?: string;
  items?: JSONSchema;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  format?: "uri" | "url" | "email" | "uuid";
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  allOf?: JSONSchema[];
}

/**
 * Converts a JSON Schema object to a Zod schema.
 * @param schema The JSON Schema object to convert
 * @returns A Zod schema equivalent to the input JSON Schema
 */
export function jsonSchemaToZod(schema: JSONSchema): ZodTypeAny {
  if (Array.isArray(schema.type)) {
    const subSchemas = schema.type.map((singleType) => {
      const sub = { ...schema, type: singleType };
      return jsonSchemaToZod(sub);
    });

    if (subSchemas.length === 0) {
      return z.any();
    } else if (subSchemas.length === 1) {
      const [subSchema] = subSchemas;
      if (!subSchema) {
        return z.any();
      }
      return subSchema;
    }
    return z.union(subSchemas as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }

  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    const subSchemas = schema.anyOf.map((sub) => jsonSchemaToZod(sub));
    if (subSchemas.length === 0) {
      return z.any();
    } else if (subSchemas.length === 1) {
      const [subSchema] = subSchemas;
      if (!subSchema) {
        return z.any();
      }
      return subSchema;
    }
    return z.union(subSchemas as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }

  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    const subSchemas = schema.oneOf.map((sub) => jsonSchemaToZod(sub));
    if (subSchemas.length === 0) {
      return z.any();
    } else if (subSchemas.length === 1) {
      const [subSchema] = subSchemas;
      if (!subSchema) {
        return z.any();
      }
      return subSchema;
    }
    return z.union(subSchemas as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }

  switch (schema.type) {
    case "object":
      if (schema.properties) {
        const shape: Record<string, ZodTypeAny> = {};
        for (const key in schema.properties) {
          const subSchema = schema.properties[key];
          if (!subSchema) {
            throw new AppError(
              `Property ${key} is not defined in the schema`,
              StatusCodes.BAD_REQUEST,
            );
          }
          shape[key] = jsonSchemaToZod(subSchema);
        }
        let zodObject = z.object(shape);

        if (schema.required && Array.isArray(schema.required)) {
          const requiredFields = schema.required.reduce<Record<string, true>>(
            (acc, key) => {
              acc[key] = true;
              return acc;
            },
            {},
          );
          zodObject = zodObject.partial().required(requiredFields);
        }

        if (schema.description) {
          zodObject = zodObject.describe(schema.description);
        }
        return zodObject;
      }

      return z.object({});

    case "array":
      if (schema.items) {
        let zodArray = z.array(jsonSchemaToZod(schema.items));
        if (schema.description) {
          zodArray = zodArray.describe(schema.description);
        }
        return zodArray;
      }
      return z.array(z.any());

    case "string": {
      if (schema.enum) {
        return z.string().refine((val) => schema.enum?.includes(val) ?? false);
      }
      let zodString = z.string();

      switch (schema.format) {
        case "uri":
        case "url":
          zodString = zodString.url();
          break;
        case "email":
          zodString = zodString.email();
          break;
        case "uuid":
          zodString = zodString.uuid();
          break;
        default:
      }

      if (schema.description) {
        zodString = zodString.describe(schema.description);
      }
      return zodString;
    }

    case "integer": // integer is a subset of number
    case "number": {
      let zodNumber = z.number();
      if (schema.minimum !== undefined) {
        zodNumber = zodNumber.min(schema.minimum);
      }
      if (schema.maximum !== undefined) {
        zodNumber = zodNumber.max(schema.maximum);
      }
      if (schema.description) {
        zodNumber = zodNumber.describe(schema.description);
      }
      return zodNumber;
    }

    case "boolean": {
      let zodBoolean = z.boolean();
      if (schema.description) {
        zodBoolean = zodBoolean.describe(schema.description);
      }
      return zodBoolean;
    }

    case "null": {
      let zodNull = z.null();
      if (schema.description) {
        zodNull = zodNull.describe(schema.description);
      }
      return zodNull;
    }

    default:
      // fallback if no recognized schema.type is present
      return z.any();
  }
}

// This function is legacy and will not be required after complete AISDK migration
export function mapModelToProvider(model: LegacyModel): LegacyProvider {
  switch (model) {
    case "gpt-4o":
    case "gpt-4o-mini":
    case "gpt-4o-2024-08-06":
    case "gpt-4o-2024-05-13":
    case "o1-mini":
    case "o1-preview":
    case "gpt-4.5-preview":
    case "o3-mini":
      return "openai";
    case "claude-3-5-sonnet-latest":
    case "claude-3-5-sonnet-20241022":
    case "claude-3-5-sonnet-20240620":
    case "claude-3-7-sonnet-20250219":
    case "claude-3-7-sonnet-latest":
      return "anthropic";
    case "gemini-1.5-flash":
    case "gemini-1.5-pro":
    case "gemini-1.5-flash-8b":
    case "gemini-2.0-flash-lite":
    case "gemini-2.0-flash":
    case "gemini-2.5-pro-preview-03-25":
    case "gemini-2.5-flash-preview-04-17":
      return "google";
    case "cerebras-llama-3.3-70b":
    case "cerebras-llama-3.1-8b":
      throw new AppError(
        "Cerebras models are not supported yet",
        StatusCodes.BAD_REQUEST,
      );
    case "groq-llama-3.3-70b-specdec":
    case "groq-llama-3.3-70b-versatile":
      throw new AppError(
        "Groq models are not supported yet",
        StatusCodes.BAD_REQUEST,
      );
    default: {
      const errorMessage = `Unknown model: ${String(model)}`;
      throw new AppError(errorMessage, StatusCodes.BAD_REQUEST);
    }
  }
}
