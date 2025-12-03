/**
 * LLM Event Bridge - Routes LLM requests through the event bus
 *
 * This module provides a bridge between code that needs LLM responses
 * and the actual LLM implementations. It uses the event bus to allow
 * remote execution of LLM calls.
 */

import { randomUUID } from "crypto";
import type { StagehandEventBus } from "../eventBus";
import type {
  ChatCompletionOptions,
  CreateChatCompletionOptions,
  LLMParsedResponse,
  LLMResponse,
} from "./LLMClient";
import type { LogLine } from "../types/public";

/**
 * Make an LLM request via the event bus and wait for a response
 *
 * This function emits a StagehandLLMRequest event and waits for a
 * StagehandLLMResponse event with the same requestId.
 *
 * Returns the same structure as llmClient.createChatCompletion: { data: T, usage?: LLMUsage }
 */
export async function createChatCompletionViaEventBus<T>(
  eventBus: StagehandEventBus,
  options: CreateChatCompletionOptions,
  sessionId?: string,
): Promise<LLMParsedResponse<T>> {
  const requestId = randomUUID();
  const startTime = Date.now();

  // Create a promise that will resolve when we get the response
  const responsePromise = new Promise<LLMParsedResponse<T>>((resolve, reject) => {
    // Set up a one-time listener for the response
    const responseHandler = (data: any) => {
      // Only handle responses for this specific request
      if (data.requestId === requestId) {
        // Remove the listener
        eventBus.off("StagehandLLMResponse", responseHandler);
        eventBus.off("StagehandLLMError", errorHandler);

        // Check if there was an error
        if (data.error) {
          reject(new Error(data.error.message));
        } else {
          // Return the same structure as llmClient.createChatCompletion
          if (data.parsedResponse) {
            resolve(data.parsedResponse as LLMParsedResponse<T>);
          } else {
            resolve({ data: data.rawResponse as T, usage: data.usage });
          }
        }
      }
    };

    const errorHandler = (data: any) => {
      if (data.requestId === requestId) {
        eventBus.off("StagehandLLMResponse", responseHandler);
        eventBus.off("StagehandLLMError", errorHandler);
        reject(new Error(data.error.message));
      }
    };

    // Listen for both response and error events
    eventBus.on("StagehandLLMResponse", responseHandler);
    eventBus.on("StagehandLLMError", errorHandler);

    // Set a timeout to prevent hanging forever
    setTimeout(() => {
      eventBus.off("StagehandLLMResponse", responseHandler);
      eventBus.off("StagehandLLMError", errorHandler);
      reject(new Error("LLM request timeout after 5 minutes"));
    }, 5 * 60 * 1000); // 5 minute timeout
  });

  // Emit the request event
  await eventBus.emitAsync("StagehandLLMRequest", {
    type: "StagehandLLMRequest",
    timestamp: new Date(),
    requestId,
    sessionId,
    modelName: options.options.messages[0]?.role ? "unknown" : "unknown", // Will be set by handler
    temperature: options.options.temperature,
    maxTokens: options.options.maxOutputTokens,
    messages: options.options.messages.map((msg) => ({
      role: msg.role,
      content:
        typeof msg.content === "string"
          ? msg.content
          : msg.content.map((c) => ({
              type: c.type,
              text: c.text,
              image: (c as any).image_url?.url || (c as any).source?.data,
            })),
    })),
    tools: options.options.tools?.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>,
    })),
    schema: options.options.response_model?.schema
      ? (options.options.response_model.schema as any)
      : undefined,
    requestType: undefined, // Will be determined by context
  });

  // Wait for and return the response
  return responsePromise;
}

/**
 * Type guard to check if options include a response_model
 */
export function hasResponseModel(
  options: CreateChatCompletionOptions,
): options is CreateChatCompletionOptions & {
  options: { response_model: { name: string; schema: any } };
} {
  return !!options.options.response_model;
}
