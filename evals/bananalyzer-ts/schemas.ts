import { z } from "zod";
import fs from "fs";
import path from "path";

// Load examples
const examples = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../bananalyzer/static/examples.json"),
    "utf-8",
  ),
);

export const ExampleType = z.enum(["listing", "detail", "listing_detail"]);
export const SchemaName = z.enum([
  "job_posting",
  "manufacturing_commerce",
  "contact",
  "contract",
  "forum",
  "attorney",
  "attorney_job_listing",
  // Add any other schema names that exist in your JSON file
]);
export const PossibleTags = z.enum([
  "regression",
  "single-output",
  "accordion",
  "pagination",
  "colliding-tags",
  "contract",
  "badly-formatted",
  "urls",
  "enqueue",
  "infinite-scroll",
  "synthetic",
  "images",
]);

// Add a type definition for SchemaName
type SchemaName =
  | "job_posting"
  | "manufacturing_commerce"
  | "contact"
  | "contract"
  | "forum"
  | "attorney"
  | "attorney_job_listing";

// Define Eval schema
export const EvalSchema = z.object({
  type: z.enum(["json_match", "end_url_match"]).default("json_match"),
  expected: z.any().nullable(),
  options: z.array(z.any()).nullable(),
});

// Update the Example schema to allow schema_ to be either SchemaName or a custom schema object
export const ExampleSchema = z.object({
  id: z.string(),
  url: z.string(),
  resource_path: z.string().nullable(),
  source: z.enum(["html", "mhtml", "hosted", "har"]),
  category: z.string(),
  subcategory: z.string(),
  type: ExampleType,
  goal: z.string(),
  schema_: z.union([SchemaName, z.record(z.any())]),
  evals: z.array(EvalSchema),
  tags: z.array(PossibleTags).default([]),
});

export type Example = z.infer<typeof ExampleSchema>;
export type Eval = z.infer<typeof EvalSchema>;

// Separate function to get predefined schema by name
export function getSchemaByName(schemaName: SchemaName): z.ZodRawShape {
  const schemaPath = path.join(__dirname, "../bananalyzer/static/schemas.json");
  const schemasJson = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));

  if (!(schemaName in schemasJson)) {
    throw new Error(`Schema ${schemaName} not found in schemas.json`);
  }

  const schemaDefinition = schemasJson[schemaName];
  return Object.entries(schemaDefinition).reduce((acc, [key, value]) => {
    acc[key] = zodTypeFromJsonSchema(value as any);
    return acc;
  }, {} as z.ZodRawShape);
}

// Function to handle custom JSON schemas
export function getCustomSchema(
  customSchema: Record<string, any>,
): z.ZodRawShape {
  return Object.entries(customSchema).reduce((acc, [key, value]) => {
    acc[key] = zodTypeFromJsonSchema(value);
    return acc;
  }, {} as z.ZodRawShape);
}

// Helper function to convert JSON schema types to Zod types
function zodTypeFromJsonSchema(jsonSchema: any): z.ZodTypeAny {
  switch (jsonSchema.type) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "integer":
      return z.number().int();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(zodTypeFromJsonSchema(jsonSchema.items));
    case "currency":
      return z.string();
    case "object":
      return z.object(
        Object.entries(jsonSchema.properties).reduce((acc, [key, value]) => {
          acc[key] = zodTypeFromJsonSchema(value as any);
          return acc;
        }, {} as z.ZodRawShape),
      );
    case "email":
      return z.string();
    case "url":
      return z.string();
    default:
      return z.any();
  }
}

// Function to read and parse the goals.json file
export function getGoals(): Record<string, string> {
  const goalsPath = path.join(__dirname, "../bananalyzer/static/goals.json");
  return JSON.parse(fs.readFileSync(goalsPath, "utf-8"));
}
