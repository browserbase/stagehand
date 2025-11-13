import { Part, FunctionCall, FunctionDeclaration, Type } from "@google/genai";
import { ToolSet } from "ai";
import { LogLine } from "../../types/public/logs";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod/v3";

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
  const startTime = Date.now();
  const toolCallId = `tool_${Date.now()}`;

  try {
    logger({
      category: "agent",
      message: `Executing custom tool: ${toolName}`,
      level: 1,
      auxiliary: {
        toolName,
        toolCallId,
        arguments: toolArgs,
        functionCallName: functionCall.name,
      },
    });

    const tool = tools[toolName];
    if (!tool) {
      const errorMessage = `Tool ${toolName} not found in toolset`;
      logger({
        category: "agent",
        message: errorMessage,
        level: 0,
        auxiliary: {
          toolName,
          availableTools: Object.keys(tools),
        },
      });
      throw new Error(errorMessage);
    }

    logger({
      category: "agent",
      message: `Tool ${toolName} found, executing with ${Object.keys(toolArgs).length} argument(s)`,
      level: 2,
      auxiliary: {
        toolName,
        toolCallId,
        argumentCount: Object.keys(toolArgs).length,
      },
    });

    const toolResult = await tool.execute(toolArgs, {
      toolCallId,
      messages: [],
    });

    const executionTime = Date.now() - startTime;
    const resultString = JSON.stringify(toolResult);
    const resultSize = resultString.length;

    logger({
      category: "agent",
      message: `Tool ${toolName} completed successfully in ${executionTime}ms`,
      level: 1,
      auxiliary: {
        toolName,
        toolCallId,
        executionTime: { value: String(executionTime), unit: "ms" },
        resultSize: { value: String(resultSize), unit: "bytes" },
        result: toolResult,
      },
    });

    // Create function response with the result
    const functionResponsePart: Part = {
      functionResponse: {
        name: toolName,
        response: {
          result: resultString,
        },
      },
    };

    return {
      functionResponse: functionResponsePart,
      success: true,
    };
  } catch (toolError) {
    const executionTime = Date.now() - startTime;
    const errorMessage =
      toolError instanceof Error ? toolError.message : String(toolError);
    const errorStack = toolError instanceof Error ? toolError.stack : undefined;
    const errorType =
      toolError instanceof Error
        ? toolError.constructor.name
        : typeof toolError;

    logger({
      category: "agent",
      message: `Error executing custom tool ${toolName}: ${errorMessage}`,
      level: 0,
      auxiliary: {
        toolName,
        toolCallId,
        executionTime: { value: String(executionTime), unit: "ms" },
        errorType,
        errorMessage,
        ...(errorStack ? { errorStack } : {}),
        arguments: toolArgs,
      },
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
  logger?: (message: LogLine) => void,
): boolean {
  const isCustom = !!(tools && functionCall.name && functionCall.name in tools);

  if (logger) {
    logger({
      category: "agent",
      message: `Checking if function call "${functionCall.name}" is a custom tool: ${isCustom}`,
      level: 2,
      auxiliary: {
        functionCallName: functionCall.name,
        isCustomTool: isCustom,
        availableCustomTools: tools ? Object.keys(tools) : [],
      },
    });
  }

  return isCustom;
}

/**
 * Convert ToolSet to Google's FunctionDeclaration array
 * Handles the conversion of Zod schemas to Google's parameter format
 */
export function convertToolSetToFunctionDeclarations(
  tools: ToolSet,
  logger?: (message: LogLine) => void,
): FunctionDeclaration[] {
  const toolCount = Object.keys(tools).length;

  if (logger) {
    logger({
      category: "agent",
      message: `Converting ${toolCount} tool(s) to Google FunctionDeclarations`,
      level: 2,
      auxiliary: {
        toolCount,
        toolNames: Object.keys(tools),
      },
    });
  }

  const functionDeclarations: FunctionDeclaration[] = [];
  const failedConversions: string[] = [];

  for (const [name, tool] of Object.entries(tools)) {
    const functionDeclaration = convertToolToFunctionDeclaration(
      name,
      tool,
      logger,
    );
    if (functionDeclaration) {
      functionDeclarations.push(functionDeclaration);
    } else {
      failedConversions.push(name);
    }
  }

  if (logger) {
    logger({
      category: "agent",
      message: `Converted ${functionDeclarations.length} of ${toolCount} tool(s) to FunctionDeclarations`,
      level: functionDeclarations.length === toolCount ? 2 : 1,
      auxiliary: {
        successfulConversions: functionDeclarations.length,
        totalTools: toolCount,
        ...(failedConversions.length > 0
          ? {
              failedConversions,
              warning: "Some tools failed to convert and were excluded",
            }
          : {}),
      },
    });
  }

  return functionDeclarations;
}

/**
 * Convert a single ToolSet tool to Google's FunctionDeclaration format
 */
function convertToolToFunctionDeclaration(
  name: string,
  tool: { description?: string; inputSchema: unknown },
  logger?: (message: LogLine) => void,
): FunctionDeclaration | null {
  try {
    if (logger) {
      logger({
        category: "agent",
        message: `Converting tool "${name}" to FunctionDeclaration`,
        level: 2,
        auxiliary: {
          toolName: name,
          hasDescription: !!tool.description,
        },
      });
    }

    // Convert Zod schema to JSON schema
    const jsonSchema = zodToJsonSchema(tool.inputSchema as z.ZodType) as {
      properties?: Record<string, unknown>;
      required?: string[];
      type?: string;
    };

    const propertyCount = jsonSchema.properties
      ? Object.keys(jsonSchema.properties).length
      : 0;
    const requiredCount = jsonSchema.required?.length || 0;

    if (logger) {
      logger({
        category: "agent",
        message: `Tool "${name}" schema converted: ${propertyCount} property(ies), ${requiredCount} required`,
        level: 2,
        auxiliary: {
          toolName: name,
          propertyCount,
          requiredCount,
          properties: jsonSchema.properties
            ? Object.keys(jsonSchema.properties)
            : [],
        },
      });
    }

    const parameters = convertJsonSchemaToGoogleParameters(
      jsonSchema,
      name,
      logger,
    );

    const functionDeclaration = {
      name,
      description: tool.description || `Execute ${name}`,
      parameters,
    };

    if (logger) {
      logger({
        category: "agent",
        message: `Successfully converted tool "${name}" to FunctionDeclaration`,
        level: 2,
        auxiliary: {
          toolName: name,
          parameterType: parameters.type,
          parameterCount: Object.keys(parameters.properties || {}).length,
        },
      });
    }

    return functionDeclaration;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorType =
      error instanceof Error ? error.constructor.name : typeof error;

    // Tool conversion failed - return null to filter this tool out
    // This typically indicates an invalid tool schema definition
    if (logger) {
      logger({
        category: "agent",
        message: `Failed to convert tool "${name}" to FunctionDeclaration: ${errorMessage}`,
        level: 0,
        auxiliary: {
          toolName: name,
          errorType,
          errorMessage,
          ...(error instanceof Error && error.stack
            ? { errorStack: error.stack }
            : {}),
        },
      });
    }

    return null;
  }
}

/**
 * Convert JSON schema to Google's parameter format
 */
function convertJsonSchemaToGoogleParameters(
  schema: {
    properties?: Record<string, unknown>;
    required?: string[];
    type?: string;
  },
  toolName?: string,
  logger?: (message: LogLine) => void,
): {
  type: Type;
  properties: Record<string, { type: Type; description?: string }>;
  required?: string[];
} {
  const properties: Record<string, { type: Type; description?: string }> = {};
  const typeMappings: Record<string, string> = {};

  if (schema.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      const propSchema = value as {
        type?: string;
        description?: string;
        items?: { type?: string };
      };
      const jsonType = propSchema.type || "string";
      const googleType = mapJsonTypeToGoogleType(
        jsonType,
        key,
        toolName,
        logger,
      );

      typeMappings[key] = `${jsonType} -> ${Type[googleType]}`;

      properties[key] = {
        type: googleType,
        ...(propSchema.description
          ? { description: propSchema.description }
          : {}),
      };
    }
  }

  if (logger && Object.keys(typeMappings).length > 0) {
    logger({
      category: "agent",
      message: `Converted ${Object.keys(properties).length} property type(s) for ${toolName || "tool"}`,
      level: 2,
      auxiliary: {
        ...(toolName ? { toolName } : {}),
        typeMappings,
        propertyCount: Object.keys(properties).length,
      },
    });
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
function mapJsonTypeToGoogleType(
  jsonType: string,
  propertyName?: string,
  toolName?: string,
  logger?: (message: LogLine) => void,
): Type {
  const normalizedType = jsonType.toLowerCase();
  let mappedType: Type;

  switch (normalizedType) {
    case "string":
      mappedType = Type.STRING;
      break;
    case "number":
    case "integer":
      mappedType = Type.NUMBER;
      break;
    case "boolean":
      mappedType = Type.BOOLEAN;
      break;
    case "array":
      mappedType = Type.ARRAY;
      break;
    case "object":
      mappedType = Type.OBJECT;
      break;
    default:
      mappedType = Type.STRING;
      if (logger) {
        logger({
          category: "agent",
          message: `Unknown JSON schema type "${jsonType}", defaulting to STRING`,
          level: 1,
          auxiliary: {
            ...(toolName ? { toolName } : {}),
            ...(propertyName ? { propertyName } : {}),
            originalType: jsonType,
            mappedType: "STRING",
            warning: "Type mapping fallback used",
          },
        });
      }
      break;
  }

  if (
    logger &&
    normalizedType !== "string" &&
    normalizedType !== "number" &&
    normalizedType !== "integer"
  ) {
    logger({
      category: "agent",
      message: `Mapped JSON type "${jsonType}" to Google type "${Type[mappedType]}"`,
      level: 2,
      auxiliary: {
        ...(toolName ? { toolName } : {}),
        ...(propertyName ? { propertyName } : {}),
        originalType: jsonType,
        mappedType: Type[mappedType],
      },
    });
  }

  return mappedType;
}
