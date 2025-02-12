import { ChatOpenAI } from "@langchain/openai";
import { ChatCompletion } from "openai/resources/chat/completions";
import {
  CreateChatCompletionOptions,
  LLMClient,
} from "../../lib/llm/LLMClient";
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
} from "@langchain/core/messages";
import type { AvailableModel } from "../../types/model";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { zodToJsonSchema } from "zod-to-json-schema";

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export class LangchainClient extends LLMClient {
  public type = "langchain" as const;
  private model: ChatOpenAI;

  constructor({ modelName, apiKey }: { modelName: string; apiKey: string }) {
    super(modelName as AvailableModel);
    this.model = new ChatOpenAI({
      modelName: modelName,
      openAIApiKey: apiKey,
      temperature: 0,
    });
  }

  async createChatCompletion<T = ChatCompletion>({
    options,
  }: CreateChatCompletionOptions): Promise<T> {
    // Convert messages to LangChain format
    const messages = options.messages.map((msg) => {
      if (Array.isArray(msg.content)) {
        // Handle multimodal content
        const content = msg.content
          .map((part) => {
            if ("text" in part) {
              return part.text;
            } else if ("image_url" in part) {
              return `[Image: ${part.image_url.url}]`;
            }
            return "";
          })
          .join("\n");

        return {
          role: msg.role,
          content: content,
        };
      }
      return msg;
    });

    // Handle tools if present
    if (options.tools?.length) {
      this.model = this.model.bind({
        tools: options.tools.map((tool) => ({
          type: "function" as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
      }) as ChatOpenAI;
    }

    let response;
    if (options.response_model) {
      const parser = StructuredOutputParser.fromZodSchema(
        options.response_model.schema,
      );
      const structuredModel = this.model.bind({
        tools: [
          {
            type: "function",
            function: {
              name: "output",
              description: "Output the structured data",
              // this is the schema of the response, zodToJsonSchema converts the zod schema to a json schema
              parameters: zodToJsonSchema(options.response_model.schema),
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "output" } },
      });
      const langchainMessages = messages.map((msg) => {
        const content = typeof msg.content === "string" ? msg.content : "";
        switch (msg.role) {
          case "user":
            return new HumanMessage(content);
          case "assistant":
            return new AIMessage(content);
          case "system":
            return new SystemMessage(content);
          default:
            return new HumanMessage(content);
        }
      });
      response = await structuredModel.invoke(langchainMessages);

      // Extract the tool calls result from the response
      const toolCalls = response.additional_kwargs?.tool_calls;
      if (
        toolCalls?.[0]?.function?.name === "output" &&
        toolCalls[0]?.function?.arguments
      ) {
        try {
          return JSON.parse(toolCalls[0].function.arguments) as T;
        } catch (e) {
          console.error(
            "Failed to parse tool call arguments:",
            toolCalls[0].function.arguments,
          );
          throw e;
        }
      }

      // If no valid tool call, try to parse the content
      if (typeof response.content === "string") {
        try {
          return JSON.parse(response.content) as T;
        } catch (e) {
          console.error("Failed to parse content:", response.content);
          throw e;
        }
      }

      return response as T;
    } else {
      const langchainMessages = messages.map((msg) => {
        const content = typeof msg.content === "string" ? msg.content : "";
        switch (msg.role) {
          case "user":
            return new HumanMessage(content);
          case "assistant":
            return new AIMessage(content);
          case "system":
            return new SystemMessage(content);
          default:
            return new HumanMessage(content);
        }
      });
      response = await this.model.invoke(langchainMessages);
      console.log("response", response);
    }

    // Normalize tool calls to match expected format
    let toolCalls: { function: { name: string; arguments: string } }[] = [];
    if ((response as { tool_calls: ToolCall[] }).tool_calls) {
      toolCalls = (response as { tool_calls: ToolCall[] }).tool_calls.map(
        (tc: ToolCall) => ({
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          },
        }),
      );
    }

    // Convert LangChain response format to match expected format
    const formattedResponse = {
      id: (response as { id: string }).id,
      choices: [
        {
          message: {
            role: "assistant",
            content: (response as { content: string }).content,
            tool_calls: toolCalls,
          },
          finish_reason:
            (
              response as unknown as {
                response_metadata: { finish_reason: string };
              }
            ).response_metadata?.finish_reason ?? "stop",
        },
      ],
      usage: {
        prompt_tokens: (
          response as {
            usage_metadata: {
              input_tokens: number;
              output_tokens: number;
              total_tokens: number;
            };
          }
        ).usage_metadata?.input_tokens,
        completion_tokens: (
          response as {
            usage_metadata: {
              input_tokens: number;
              output_tokens: number;
              total_tokens: number;
            };
          }
        ).usage_metadata?.output_tokens,
        total_tokens: (
          response as {
            usage_metadata: {
              input_tokens: number;
              output_tokens: number;
              total_tokens: number;
            };
          }
        ).usage_metadata?.total_tokens,
      },
    };
    console.log("formattedResponse", formattedResponse.choices[0].message);

    return formattedResponse as T;
  }
}
