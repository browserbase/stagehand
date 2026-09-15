import { z } from "zod";
import { Stagehand } from "@browserbasehq/stagehand";
import {
  TextMessage,
  ToolCallMessage,
  ToolResultMessage,
  type AgentResult,
} from "@inngest/agent-kit";

export async function getStagehand(sessionId: string) {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey: process.env.BROWSERBASE_API_KEY,
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    browserbaseSessionID: sessionId,
    model: "openai/gpt-4o",
  });
  await stagehand.init();
  return stagehand;
}

export const StagehandAvailableModelSchema = z.enum([
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "openai/gpt-4.1",
  "openai/o3-mini",
  "anthropic/claude-sonnet-4-6",
  "google/gemini-2.5-flash",
]);

// Transform string such as "{ lastFundraiseDate: string, amount: string, round: string }" into a zod schema
export function stringToZodSchema(schema: string) {
  // Remove whitespace and curly braces
  const trimmed = schema.replace(/\s/g, "").slice(1, -1);

  // Split into individual field definitions
  const fields = trimmed.split(",");

  // Build object shape
  const shape: Record<string, z.ZodType> = {};

  for (const field of fields) {
    const [key, type] = field.split(":");

    // Check if type is an array (ends with [])
    const isArray = type.endsWith("[]");
    const baseType = isArray ? type.slice(0, -2) : type;

    let zodType: z.ZodType;
    switch (baseType) {
      case "string":
        zodType = z.string();
        break;
      case "number":
        zodType = z.number();
        break;
      case "boolean":
        zodType = z.boolean();
        break;
      case "date":
        zodType = z.date();
        break;
      default:
        zodType = z.string(); // Default to string for unknown types
    }

    // Wrap in array if needed
    shape[key] = isArray ? z.array(zodType) : zodType;
  }

  return z.object(shape);
}

export function lastResult(results: AgentResult[] | undefined) {
  if (!results) {
    return undefined;
  }
  return results[results.length - 1];
}

type MessageType = TextMessage["type"] | ToolCallMessage["type"] | ToolResultMessage["type"];

export function isLastMessageOfType(result: AgentResult, type: MessageType) {
  return result.output[result.output.length - 1]?.type === type;
}
