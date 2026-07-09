import {
  GoogleGenAI,
  HarmCategory,
  HarmBlockThreshold,
  Content,
  Part,
  Tool,
  FunctionCall,
  Schema,
  Type,
} from "@google/genai";

import { LogLine } from "../types/public/logs.js";
import { ApiKeyClientOptions, AvailableModel } from "../types/public/model.js";
import { validateZodSchema, toGeminiSchema } from "../utils.js";
import { ChatMessage, CreateChatCompletionOptions, LLMClient, LLMResponse } from "./LLMClient.js";
import { ChatCompletionOptionsSchema } from "./schemas.js";
import { CreateChatCompletionResponseError, StagehandError } from "../types/public/sdkErrors.js";

// Mapping from generic roles to Gemini roles
const roleMap: { [key in ChatMessage["role"]]: string } = {
  user: "user",
  assistant: "model",
  system: "user", // Gemini API prefers system instructions either via system_instruction or at the start of 'user' content
};

// Basic safety settings - adjust as needed
const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
];

export class GoogleClient extends LLMClient {
  public type = "google" as const;
  private client: GoogleGenAI;
  declare public clientOptions: ApiKeyClientOptions;
  declare public hasVision: boolean;
  private logger: (message: LogLine) => void;

  constructor({
    logger, // Added logger based on other clients
    modelName,
    clientOptions,
  }: {
    logger: (message: LogLine) => void; // Added logger type
    modelName: AvailableModel;
    clientOptions: ApiKeyClientOptions;
  }) {
    super(modelName);
    this.clientOptions = clientOptions;
    this.client = new GoogleGenAI({ apiKey: clientOptions.auth.apiKey });
    this.modelName = modelName;
    this.logger = logger;
    // Determine vision capability based on model name (adjust as needed)
    this.hasVision = modelName.includes("vision") || modelName.includes("gemini-1.5"); // Example logic
  }

  // Helper to convert project's ChatMessage[] to Gemini's Content[]
  private formatMessages(messages: ChatMessage[]): Content[] {
    const contents: Content[] = [];
    let systemInstruction: string | null = null;

    messages.forEach((msg) => {
      const role = roleMap[msg.role];
      if (!role) {
        this.logger({
          category: "google",
          message: `WARNING: Unsupported role: ${msg.role}`,
          level: 1,
        });
        return; // Skip unsupported roles
      }

      // Handle system messages - prepend to the first user message or use system_instruction if available
      if (msg.role === "system") {
        if (typeof msg.content === "string") {
          systemInstruction = (systemInstruction ? systemInstruction + "\n\n" : "") + msg.content;
        }
        return; // Don't add system messages directly to contents yet
      }

      const parts: Part[] = [];

      if (Array.isArray(msg.content)) {
        msg.content.forEach((partContent) => {
          if (partContent.type === "text") {
            parts.push({ text: partContent.text });
          } else if (partContent.type === "image_url") {
            // Assuming base64 data URI format: data:[<mediatype>];base64,<data>
            const base64Data = partContent.image_url.url.split(",")[1];
            const mimeTypeMatch = partContent.image_url.url.match(/^data:(image\/\w+);base64,/);
            if (base64Data && mimeTypeMatch) {
              parts.push({
                inlineData: { mimeType: mimeTypeMatch[1], data: base64Data },
              });
            } else {
              this.logger({
                category: "google",
                message: "WARNING: Could not parse image data URI format",
                level: 1,
              });
            }
          } else if (partContent.type === "image") {
            parts.push({
              inlineData: {
                mimeType: partContent.source.media_type,
                data: partContent.source.data,
              },
            });
          }
        });
      } else if (typeof msg.content === "string") {
        parts.push({ text: msg.content });
      }

      // Apply system instruction to the first non-system message if needed
      if (systemInstruction && contents.length === 0 && role === "user") {
        const firstPartText = parts.find((p) => "text" in p);
        if (firstPartText && "text" in firstPartText) {
          firstPartText.text = `${systemInstruction}\n\n${firstPartText.text}`;
        } else {
          parts.unshift({ text: systemInstruction });
        }
        systemInstruction = null; // Clear after applying
      }

      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    });

    // If system instruction wasn't applied (e.g., no user messages followed it), add it as a final user message
    if (systemInstruction) {
      contents.unshift({ role: "user", parts: [{ text: systemInstruction }] });
    }

    return contents;
  }

  // Helper to convert LLMTool[] to Gemini's Tool[]
  private formatTools(
    tools?: ReturnType<typeof ChatCompletionOptionsSchema.parse>["tools"],
  ): Tool[] | undefined {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    return [
      {
        functionDeclarations: tools.map((tool) => {
          let parameters: Schema | undefined = undefined;
          if (tool.parameters) {
            parameters = {
              type: Type.OBJECT,
              properties: tool.parameters.properties as {
                [key: string]: Schema;
              },
              required: tool.parameters.required as string[] | undefined,
            };
          }
          return {
            name: tool.name,
            description: tool.description,
            parameters: parameters,
          };
        }),
      },
    ];
  }

  async createChatCompletion<T = LLMResponse>({
    // Ensure LLMResponse is compatible
    options: optionsInitial,
    logger,
    retries = 3,
  }: CreateChatCompletionOptions): Promise<T> {
    const options = ChatCompletionOptionsSchema.parse(optionsInitial);
    const { llmRequestId, response_model, tools, temperature, top_p, maxOutputTokens } = options;

    const formattedMessages = this.formatMessages(options.messages);
    const formattedTools = this.formatTools(tools);

    const generationConfig = {
      maxOutputTokens: maxOutputTokens,
      temperature: temperature,
      topP: top_p,
      responseMimeType: response_model ? "application/json" : undefined,
      responseSchema: response_model ? toGeminiSchema(response_model.schema) : undefined,
    };

    logger({
      category: "google",
      message: "creating chat completion",
      level: 2,
      auxiliary: {
        modelName: { value: this.modelName, type: "string" },
        llmRequestId: { value: llmRequestId, type: "string" },
        requestPayloadSummary: {
          value: `Model: ${this.modelName}, Messages: ${formattedMessages.length}, Config Keys: ${Object.keys(generationConfig).join(", ")}, Tools: ${formattedTools ? formattedTools.length : 0}, Safety Categories: ${safetySettings.map((s) => s.category).join(", ")}`,
          type: "string",
        },
      },
    });

    // Construct the full request object
    const requestPayload = {
      model: this.modelName,
      contents: formattedMessages,
      config: {
        ...generationConfig,
        safetySettings: safetySettings,
        tools: formattedTools,
      },
    };

    // Log the full payload safely
    try {
      logger({
        category: "google",
        message: "Full request payload",
        level: 2,
        auxiliary: {
          llmRequestId: { value: llmRequestId, type: "string" },
          fullPayload: {
            value: JSON.stringify(requestPayload),
            type: "object",
          },
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown";
      logger({
        category: "google",
        message: "Failed to stringify full request payload for logging",
        level: 0,
        auxiliary: {
          llmRequestId: { value: llmRequestId, type: "string" },
          error: { value: message, type: "string" },
        },
      });
    }

    try {
      const result = await this.client.models.generateContent(requestPayload); // Pass the constructed payload

      logger({
        category: "google",
        message: "received response",
        level: 2,
        auxiliary: {
          llmRequestId: { value: llmRequestId, type: "string" },
          response: {
            value: JSON.stringify(result),
            type: "object",
          },
        },
      });

      const finishReason = result.candidates?.[0]?.finishReason || "unknown";
      const toolCalls =
        result.functionCalls?.map((fc: FunctionCall, index: number) => ({
          id: `tool_call_${llmRequestId}_${index}`,
          type: "function" as const,
          function: {
            name: fc.name ?? "unknown",
            arguments: JSON.stringify(fc.args),
          },
        })) ?? [];

      let content: string | null = null;
      try {
        content = result.text ?? null;
      } catch (e) {
        const message = e instanceof Error ? e.message : "unknown";
        logger({
          category: "google",
          message: `Could not extract text content: ${message}`,
          level: 1,
          auxiliary: { llmRequestId: { value: llmRequestId, type: "string" } },
        });
        content = null;
      }

      // Construct LLMResponse shape
      const llmResponse: LLMResponse = {
        id: result.candidates?.[0]?.index?.toString() || llmRequestId,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: this.modelName,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: content,
              tool_calls: toolCalls,
            },
            finish_reason: finishReason,
          },
        ],
        usage: {
          prompt_tokens: result.usageMetadata?.promptTokenCount || 0,
          completion_tokens: result.usageMetadata?.candidatesTokenCount || 0,
          total_tokens: result.usageMetadata?.totalTokenCount || 0,
        },
      };

      // Validate schema if response_model was provided
      if (response_model) {
        let parsedData;
        try {
          // Need to handle potential markdown fences if the model didn't follow instructions perfectly
          const potentialJson = content?.trim().replace(/^```json\n?|\n?```$/g, "") || "{}";
          parsedData = JSON.parse(potentialJson);
        } catch (e) {
          const message = e instanceof Error ? e.message : "unknown";
          logger({
            category: "google",
            message: `Failed to parse JSON response: ${message}`,
            level: 0,
            auxiliary: {
              content: { value: content || "null", type: "string" },
            },
          });
          if (retries > 0) {
            return this.createChatCompletion({
              options,
              logger,
              retries: retries - 1,
            });
          }
          throw new CreateChatCompletionResponseError(`Failed to parse JSON response: ${message}`);
        }

        try {
          validateZodSchema(response_model.schema, parsedData);
        } catch (err) {
          logger({
            category: "google",
            message: "Response failed Zod schema validation",
            level: 0,
          });
          if (retries > 0) {
            return this.createChatCompletion({
              options,
              logger,
              retries: retries - 1,
            });
          }
          throw err;
        }

        // If schema validation passes, structure the response for extraction use case
        const extractionResult = {
          data: parsedData,
          usage: llmResponse.usage,
        };

        return extractionResult as T;
      }

      return llmResponse as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      const stack = error instanceof Error ? error.stack : undefined;
      logger({
        category: "google",
        message: `Error during Google AI chat completion: ${message}`,
        level: 0,
        auxiliary: {
          errorDetails: {
            value: `Message: ${message}${stack ? "\nStack: " + stack : ""}`,
            type: "string",
          },
          llmRequestId: { value: llmRequestId, type: "string" },
        },
      });

      // Basic retry logic
      if (retries > 0) {
        logger({
          category: "google",
          message: `Retrying... (${retries} attempts left)`,
          level: 1,
        });
        await new Promise((resolve) => setTimeout(resolve, 1000 * (4 - retries))); // Simple backoff
        return this.createChatCompletion({
          options,
          logger,
          retries: retries - 1,
        });
      }

      // Re-throw specific Stagehand errors or a generic one
      if (error instanceof StagehandError) {
        throw error;
      }
      throw new StagehandError(`Google AI API request failed: ${message}`);
    }
  }
}
