import { z, type ZodRawShape, type ZodTypeAny } from "zod";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  return value;
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, jsonReplacer, 2);
  } catch (error) {
    return JSON.stringify(
      {
        error: "Failed to serialize tool result",
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    );
  }
}

export function extractToolShape(schema: ZodTypeAny | undefined): ZodRawShape | undefined {
  if (!schema) {
    return undefined;
  }

  if (schema instanceof z.ZodObject) {
    return schema.shape;
  }

  return undefined;
}

export function inferIsError(result: unknown): boolean {
  if (!isRecord(result)) {
    return false;
  }

  if (result.success === false) {
    return true;
  }

  return typeof result.error === "string" && result.error.length > 0;
}
