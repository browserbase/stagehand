/**
 * LLM Event Handler - Listens for LLM requests and executes them
 *
 * This module listens for StagehandLLMRequest events on the event bus,
 * calls the actual LLM implementation, and emits StagehandLLMResponse events.
 */

import type { StagehandEventBus } from "../eventBus";
import type { LLMClient, CreateChatCompletionOptions } from "./LLMClient";
import type { LogLine } from "../types/public";

export interface LLMEventHandlerOptions {
  eventBus: StagehandEventBus;
  llmClient: LLMClient;
  logger: (message: LogLine) => void;
}

/**
 * Initialize the LLM event handler
 *
 * This sets up a listener on the event bus that will handle LLM requests
 * by calling the provided LLMClient and emitting responses.
 *
 * @returns A cleanup function to remove the listener
 */
export function initializeLLMEventHandler({
  eventBus,
  llmClient,
  logger,
}: LLMEventHandlerOptions): () => void {
  const handleLLMRequest = async (event: any) => {
    const { requestId, messages, tools, schema, temperature, maxTokens } =
      event;

    try {
      // Build the options for createChatCompletion
      const options: CreateChatCompletionOptions = {
        options: {
          messages: messages.map((msg: any) => ({
            role: msg.role,
            content:
              typeof msg.content === "string"
                ? msg.content
                : msg.content.map((c: any) => {
                    if (c.type === "text") {
                      return { type: "text", text: c.text };
                    } else if (c.type === "image_url" || c.image) {
                      return {
                        type: "image_url",
                        image_url: { url: c.image },
                      };
                    }
                    return c;
                  }),
          })),
          temperature,
          maxOutputTokens: maxTokens,
          tools,
          requestId,
        },
        logger,
      };

      // Add response_model if schema is provided
      if (schema) {
        options.options.response_model = {
          name: "Response",
          schema,
        };
      }

      const startTime = Date.now();
      let response: any;
      let parsedResponse: any = null;

      // Call the LLM
      if (schema) {
        // Structured response
        const result = await llmClient.createChatCompletion(options as any);
        parsedResponse = result;
        response = null;
      } else {
        // Raw response
        response = await llmClient.createChatCompletion(options);
      }

      const inferenceTimeMs = Date.now() - startTime;

      // Extract usage information
      let usage: any = undefined;
      if (parsedResponse?.usage) {
        usage = {
          promptTokens: parsedResponse.usage.prompt_tokens,
          completionTokens: parsedResponse.usage.completion_tokens,
          totalTokens: parsedResponse.usage.total_tokens,
        };
      } else if (response?.usage) {
        usage = {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        };
      }

      // Emit success response
      await eventBus.emitAsync("StagehandLLMResponse", {
        type: "StagehandLLMResponse",
        timestamp: new Date(),
        requestId,
        sessionId: event.sessionId,
        content: parsedResponse
          ? JSON.stringify(parsedResponse.data || parsedResponse)
          : response?.choices?.[0]?.message?.content || "",
        toolCalls: response?.choices?.[0]?.message?.tool_calls?.map(
          (tc: any) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments),
          }),
        ),
        finishReason: response?.choices?.[0]?.finish_reason || "stop",
        usage,
        rawResponse: response,
        parsedResponse,
      });
    } catch (error) {
      // Emit error response
      await eventBus.emitAsync("StagehandLLMError", {
        type: "StagehandLLMError",
        timestamp: new Date(),
        requestId,
        sessionId: event.sessionId,
        error: {
          message: error instanceof Error ? error.message : "Unknown error",
          code: (error as any).code,
          stack: error instanceof Error ? error.stack : undefined,
        },
      });
    }
  };

  // Register the handler
  eventBus.on("StagehandLLMRequest", handleLLMRequest);

  // Return cleanup function
  return () => {
    eventBus.off("StagehandLLMRequest", handleLLMRequest);
  };
}
