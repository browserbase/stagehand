import Anthropic from "@anthropic-ai/sdk";
import { LLMClient, ChatCompletionOptions } from "./LLMClient";
import { zodToJsonSchema } from "zod-to-json-schema";

export class AnthropicClient implements LLMClient {
  private client: Anthropic;
  public logger: (message: {
    category?: string;
    message: string;
    level?: number;
  }) => void;

  constructor(
    logger: (message: {
      category?: string;
      message: string;
      level?: number;
    }) => void,
  ) {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY, // Make sure to set this environment variable
    });
    this.logger = logger;
  }

  async createChatCompletion(options: ChatCompletionOptions) {
    const systemMessage = options.messages.find((msg) => msg.role === "system");
    const userMessages = options.messages.filter(
      (msg) => msg.role !== "system",
    );

    if (options.image) {
      const screenshotMessage: any = {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: options.image.buffer.toString("base64"),
            },
          },
          ...(options.image.description
            ? [{ type: "text", text: options.image.description }]
            : []),
        ],
      };

      options.messages = [...options.messages, screenshotMessage];
    }

    // Transform tools to Anthropic's format
    let anthropicTools = options.tools?.map((tool: any) => {
      if (tool.type === "function") {
        return {
          name: tool.function.name,
          description: tool.function.description,
          input_schema: {
            type: "object",
            properties: tool.function.parameters.properties,
            required: tool.function.parameters.required,
          },
        };
      }
      return tool;
    });

    let toolDefinition;
    if (options.response_model) {
      const jsonSchema = zodToJsonSchema(options.response_model.schema);

      // Extract the actual schema properties
      const schemaProperties =
        jsonSchema.definitions?.MySchema?.properties || jsonSchema.properties;
      const schemaRequired =
        jsonSchema.definitions?.MySchema?.required || jsonSchema.required;

      toolDefinition = {
        name: "extract_data",
        description: "Extracts specific data based on the provided schema.",
        input_schema: {
          type: "object",
          properties: schemaProperties,
          required: schemaRequired,
        },
      };
    }

    if (toolDefinition) {
      console.log("toolDefinition", toolDefinition);
      anthropicTools = anthropicTools ?? [];
      anthropicTools.push(toolDefinition);
    }

    const response = await this.client.messages.create({
      model: options.model,
      max_tokens: options.max_tokens || 1500,
      messages: userMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      tools: anthropicTools,
      system: systemMessage?.content,
      temperature: options.temperature,
    });

    // Parse the response here
    const transformedResponse = {
      id: response.id,
      object: "chat.completion",
      created: Date.now(),
      model: response.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content:
              response.content.find((c) => c.type === "text")?.text || null,
            tool_calls: response.content
              .filter((c) => c.type === "tool_use")
              .map((toolUse: any) => ({
                id: toolUse.id,
                type: "function",
                function: {
                  name: toolUse.name,
                  arguments: JSON.stringify(toolUse.input),
                },
              })),
          },
          finish_reason: response.stop_reason,
        },
      ],
      usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens:
          response.usage.input_tokens + response.usage.output_tokens,
      },
    };

    this.logger({
      category: "Anthropic",
      message: "Transformed response: " + JSON.stringify(transformedResponse),
    });

    if (options.response_model) {
      const toolUse = response.content.find((c) => c.type === "tool_use");
      // console.log("[Debug][Response]", transformedResponse);
      // console.log("[Response Model]", options.response_model);
      if (toolUse && "input" in toolUse) {
        return toolUse.input;
      } else {
        throw new Error(
          "Extraction failed: No tool use with input in response",
        );
      }
    }

    return transformedResponse;
  }
}
