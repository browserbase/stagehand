import { z } from "zod";
import { LogLine } from "@/types/log";

export interface ReductoClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  retries?: number;
  debug?: boolean;
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
  private timeout: number;
  private retries: number;
  private debug: boolean;
  private logger: (message: LogLine) => void;

  constructor(
    options: ReductoClientOptions,
    logger: (message: LogLine) => void,
  ) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl || "https://platform.reducto.ai";
    this.timeout = options.timeout || 30000; // 30 seconds default
    this.retries = options.retries || 2;
    this.debug = options.debug || false;
    this.logger = logger;

    // Validate API key format
    if (
      !this.apiKey ||
      typeof this.apiKey !== "string" ||
      this.apiKey.trim().length === 0
    ) {
      throw new Error("Invalid Reducto API key provided");
    }
  }

  async extractFromPDF<T extends z.AnyZodObject>(
    options: ReductoExtractOptions & { schema: T },
  ): Promise<z.infer<T>> {
    const { url, filepath, schema } = options;

    if (!url && !filepath) {
      throw new Error("Either URL or filepath must be provided");
    }

    this.logger({
      category: "reducto",
      message: `Extracting from PDF: ${url || filepath}`,
      level: 1,
    });

    if (this.debug) {
      this.logger({
        category: "reducto",
        message: `Debug info - API key length: ${this.apiKey.length}, Base URL: ${this.baseUrl}, Timeout: ${this.timeout}ms`,
        level: 2,
      });
    }

    try {
      // Prepare the request body according to Reducto API format
      const requestBody: Record<string, unknown> = {};

      // Perform the request with retries
      let response: Response;
      if (filepath) {
        response = await this.makeFileRequest(filepath, requestBody);
      } else {
        requestBody.document_url = url;
        response = await this.makeUrlRequest(requestBody);
      }

      const result = await response.json();

      if (this.debug) {
        this.logger({
          category: "reducto",
          message: `Received response: ${JSON.stringify(result).slice(0, 200)}...`,
          level: 2,
        });
      }

      // Parse the result with the schema if provided
      if (schema) {
        // Reducto API returns content in various formats, try to extract text content
        const textContent =
          result.content ||
          result.text ||
          result.data ||
          JSON.stringify(result);

        // For simple schema with a single property, map the content directly
        const schemaShape = schema.shape;
        const schemaKeys = Object.keys(schemaShape);

        if (schemaKeys.length === 1) {
          const key = schemaKeys[0];
          return schema.parse({ [key]: textContent });
        }

        // For complex schemas, try to parse the entire result
        return schema.parse(result);
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger({
        category: "reducto",
        message: "Error extracting from PDF",
        level: 0,
        auxiliary: {
          error: {
            value: errorMessage,
            type: "string",
          },
          ...(errorStack && {
            trace: {
              value: errorStack,
              type: "string",
            },
          }),
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

  private async makeFileRequest(
    filepath: string,
    requestBody: Record<string, unknown>,
  ): Promise<Response> {
    const fs = await import("fs");

    // Check if file exists first
    try {
      await fs.promises.access(filepath);
    } catch {
      throw new Error(`PDF file not found: ${filepath}`);
    }

    const formData = new FormData();
    const fileBuffer = await fs.promises.readFile(filepath);
    const file = new Blob([new Uint8Array(fileBuffer)], {
      type: "application/pdf",
    });

    formData.append("file", file, filepath.split("/").pop() || "document.pdf");
    // Only append options if there are any configuration options
    if (Object.keys(requestBody).length > 0) {
      formData.append("options", JSON.stringify(requestBody));
    }

    return this.makeRequestWithRetry(`${this.baseUrl}/parse`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: formData,
    });
  }

  private async makeUrlRequest(
    requestBody: Record<string, unknown>,
  ): Promise<Response> {
    return this.makeRequestWithRetry(`${this.baseUrl}/parse`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
  }

  private async makeRequestWithRetry(
    url: string,
    options: RequestInit,
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        if (this.debug && attempt > 0) {
          this.logger({
            category: "reducto",
            message: `Retry attempt ${attempt} of ${this.retries}`,
            level: 2,
          });
        }

        // Create AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const responseText = await response
            .text()
            .catch(() => "Unable to read response");
          const errorDetails = `HTTP ${response.status} ${response.statusText}: ${responseText}`;

          this.logger({
            category: "reducto",
            message: `API request failed: ${errorDetails}`,
            level: 0,
          });

          throw new Error(`Reducto API error: ${errorDetails}`);
        }

        if (this.debug) {
          this.logger({
            category: "reducto",
            message: `Request successful on attempt ${attempt + 1}`,
            level: 2,
          });
        }

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === this.retries) {
          break; // Don't wait after the last attempt
        }

        // Only retry on network errors, not on HTTP errors
        if (
          error instanceof Error &&
          ((error.name === "TypeError" && error.message.includes("fetch")) ||
            error.name === "AbortError" ||
            error.message.includes("timeout"))
        ) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000); // Exponential backoff, max 5s

          this.logger({
            category: "reducto",
            message: `Network error on attempt ${attempt + 1}, retrying in ${delay}ms: ${error.message}`,
            level: 1,
          });

          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          // Don't retry on non-network errors (like HTTP 4xx/5xx)
          break;
        }
      }
    }

    throw lastError || new Error("Request failed after all retries");
  }
}
