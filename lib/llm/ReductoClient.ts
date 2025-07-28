import { z } from "zod";
import { LogLine } from "@/types/log";

export interface ReductoClientOptions {
  apiKey: string;
  baseUrl?: string;
}

export interface ReductoExtractOptions {
  url?: string;
  filepath?: string;
  schema?: z.AnyZodObject;
  outputType?: "markdown" | "json" | "html";
}

export class ReductoClient {
  private apiKey: string;
  private baseUrl: string;
  private logger: (message: LogLine) => void;

  constructor(
    options: ReductoClientOptions,
    logger: (message: LogLine) => void,
  ) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl || "https://api.reducto.ai";
    this.logger = logger;
  }

  async extractFromPDF<T extends z.AnyZodObject>(
    options: ReductoExtractOptions & { schema: T },
  ): Promise<z.infer<T>> {
    const { url, filepath, schema, outputType = "json" } = options;

    if (!url && !filepath) {
      throw new Error("Either URL or filepath must be provided");
    }

    this.logger({
      category: "reducto",
      message: `Extracting from PDF: ${url || filepath}`,
      level: 1,
    });

    try {
      // Prepare the request body
      const requestBody: Record<string, unknown> = {
        output_type: outputType,
      };

      if (schema) {
        // Convert Zod schema to JSON schema for Reducto
        requestBody.schema = this.zodToJsonSchema(schema);
      }

      // If filepath is provided, read the file and send as multipart
      let response: Response;
      if (filepath) {
        const fs = await import("fs");
        const formData = new FormData();
        const fileBuffer = await fs.promises.readFile(filepath);
        const file = new Blob([new Uint8Array(fileBuffer)], {
          type: "application/pdf",
        });
        formData.append(
          "file",
          file,
          filepath.split("/").pop() || "document.pdf",
        );
        formData.append("options", JSON.stringify(requestBody));

        response = await fetch(`${this.baseUrl}/parse`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: formData,
        });
      } else {
        // URL-based extraction
        requestBody.url = url;
        response = await fetch(`${this.baseUrl}/parse`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });
      }

      if (!response.ok) {
        throw new Error(
          `Reducto API error: ${response.status} ${response.statusText}`,
        );
      }

      const result = await response.json();

      // Parse the result with the schema if provided
      if (schema) {
        return schema.parse(result.data || result);
      }

      return result;
    } catch (error) {
      this.logger({
        category: "reducto",
        message: "Error extracting from PDF",
        level: 1,
        auxiliary: {
          error: {
            value: error instanceof Error ? error.message : String(error),
            type: "string",
          },
        },
      });
      throw error;
    }
  }

  private zodToJsonSchema(schema: z.AnyZodObject): Record<string, unknown> {
    // Basic Zod to JSON Schema conversion
    // This is a simplified version - you might want to use a library like zod-to-json-schema
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const zodType = value as z.ZodTypeAny;
      properties[key] = this.zodTypeToJsonSchema(zodType);

      if (!zodType.isOptional()) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  private zodTypeToJsonSchema(zodType: z.ZodTypeAny): Record<string, unknown> {
    if (zodType instanceof z.ZodString) {
      return { type: "string" };
    } else if (zodType instanceof z.ZodNumber) {
      return { type: "number" };
    } else if (zodType instanceof z.ZodBoolean) {
      return { type: "boolean" };
    } else if (zodType instanceof z.ZodArray) {
      return {
        type: "array",
        items: this.zodTypeToJsonSchema(zodType.element),
      };
    } else if (zodType instanceof z.ZodObject) {
      return this.zodToJsonSchema(zodType);
    } else if (zodType instanceof z.ZodOptional) {
      return this.zodTypeToJsonSchema(zodType.unwrap());
    } else {
      return { type: "string" }; // Default fallback
    }
  }
}
