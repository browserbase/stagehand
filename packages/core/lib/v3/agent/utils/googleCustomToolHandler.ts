import { Part, FunctionCall, FunctionDeclaration, Type } from "@google/genai";
import { ToolSet } from "ai";
import { LogLine } from "../../types/public/logs.js";
import { toJsonSchema } from "../../zodCompat.js";
import type { StagehandZodSchema } from "../../zodCompat.js";

/**
 * Result of executing a custom tool for Google CUA
 */
export interface CustomToolExecutionResult {
  functionResponse: Part;
  success: boolean;
}

/**
 * Execute a custom tool and format the response for Google's API
 * This handles tool execution, result formatting, and error handling
 * specific to Google's function response format
 */
export async function executeGoogleCustomTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
  tools: ToolSet,
  functionCall: FunctionCall,
  logger: (message: LogLine) => void,
): Promise<CustomToolExecutionResult> {
  try {
    logger({
      category: "agent",
      message: `Executing custom tool: ${toolName} with args: ${JSON.stringify(toolArgs)}`,
      level: 1,
    });

    const tool = tools[toolName];
    const toolResult = await tool.execute(toolArgs, {
      toolCallId: `tool_${Date.now()}`,
      messages: [],
    });

    logger({
      category: "agent",
      message: `Tool ${toolName} completed successfully. Result: ${JSON.stringify(toolResult)}`,
      level: 1,
    });

    // Create function response with the result
    const functionResponsePart: Part = {
      functionResponse: {
        name: toolName,
        response: {
          result: JSON.stringify(toolResult),
        },
      },
    };

    return {
      functionResponse: functionResponsePart,
      success: true,
    };
  } catch (toolError) {
    const errorMessage =
      toolError instanceof Error ? toolError.message : String(toolError);

    logger({
      category: "agent",
      message: `Error executing custom tool ${toolName}: ${errorMessage}`,
      level: 0,
    });

    // Create error function response
    const functionResponsePart: Part = {
      functionResponse: {
        name: toolName,
        response: {
          error: errorMessage,
        },
      },
    };

    return {
      functionResponse: functionResponsePart,
      success: false,
    };
  }
}

/**
 * Check if a function call is a custom tool
 */
export function isCustomTool(
  functionCall: FunctionCall,
  tools?: ToolSet,
): boolean {
  return !!(tools && functionCall.name && functionCall.name in tools);
}

/**
 * Convert ToolSet to Google's FunctionDeclaration array
 * Handles the conversion of Zod schemas to Google's parameter format
 */
export function convertToolSetToFunctionDeclarations(
  tools: ToolSet,
): FunctionDeclaration[] {
  const functionDeclarations: FunctionDeclaration[] = [];

  for (const [name, tool] of Object.entries(tools)) {
    const functionDeclaration = convertToolToFunctionDeclaration(name, tool);
    if (functionDeclaration) {
      functionDeclarations.push(functionDeclaration);
    }
  }

  return functionDeclarations;
}

/**
 * Convert a single ToolSet tool to Google's FunctionDeclaration format
 */
function convertToolToFunctionDeclaration(
  name: string,
  tool: { description?: string; inputSchema: unknown },
): FunctionDeclaration | null {
  try {
    // Convert Zod schema to JSON schema
    const schema = tool.inputSchema as StagehandZodSchema;
    const jsonSchema = toJsonSchema(schema) as {
      properties?: Record<string, unknown>;
      required?: string[];
      type?: string;
    };

    const parameters = convertJsonSchemaToGoogleParameters(jsonSchema);

    return {
      name,
      description: tool.description || `Execute ${name}`,
      parameters,
    };
  } catch (error) {
    console.error(
      `Error converting tool ${name} to function declaration:`,
      error,
    );
    return null;
  }
}

/**
 * Convert JSON schema to Google's parameter format
 */
function convertJsonSchemaToGoogleParameters(schema: {
  properties?: Record<string, unknown>;
  required?: string[];
  type?: string;
}): {
  type: Type;
  properties: Record<string, { type: Type; description?: string }>;
  required?: string[];
} {
  const properties: Record<string, { type: Type; description?: string }> = {};

  if (schema.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      const propSchema = value as {
        type?: string;
        description?: string;
        items?: { type?: string };
      };
      properties[key] = {
        type: mapJsonTypeToGoogleType(propSchema.type || "string"),
        ...(propSchema.description
          ? { description: propSchema.description }
          : {}),
      };
    }
  }

  return {
    type: Type.OBJECT,
    properties,
    ...(schema.required && schema.required.length > 0
      ? { required: schema.required }
      : {}),
  };
}

/**
 * Map JSON schema types to Google's Type enum
 */
function mapJsonTypeToGoogleType(jsonType: string): Type {
  switch (jsonType.toLowerCase()) {
    case "string":
      return Type.STRING;
    case "number":
    case "integer":
      return Type.NUMBER;
    case "boolean":
      return Type.BOOLEAN;
    case "array":
      return Type.ARRAY;
    case "object":
      return Type.OBJECT;
    default:
      return Type.STRING;
  }
}
