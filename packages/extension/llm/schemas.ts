import { z } from "zod/v4";
import type {
  ChatMessage,
  ChatMessageContent,
  ChatMessageImageContent,
  ChatMessageTextContent,
  LLMParsedResponse,
  LLMResponse,
  LLMUsage,
} from "./LLMClient.js";
import { LLMToolSchema } from "../../protocol/pending-schemas.js";
export { LLMToolSchema } from "../../protocol/pending-schemas.js";

export const ChatMessageImageContentSchema: z.ZodType<
  ChatMessageImageContent,
  ChatMessageImageContent
> = z.union([
  z
    .object({
      type: z.literal("image_url"),
      image_url: z
        .object({
          url: z.string(),
        })
        .required(),
      text: z.string().optional(),
    })
    .required({ type: true, image_url: true }),
  z
    .object({
      type: z.literal("image"),
      text: z.string().optional(),
      source: z
        .object({
          type: z.string(),
          media_type: z.union([
            z.literal("image/gif"),
            z.literal("image/jpeg"),
            z.literal("image/png"),
            z.literal("image/webp"),
          ]),
          data: z.string(),
        })
        .required(),
    })
    .required({ type: true, source: true }),
]);

export const ChatMessageTextContentSchema: z.ZodType<
  ChatMessageTextContent,
  ChatMessageTextContent
> = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .required();

export const ChatMessageContentSchema: z.ZodType<ChatMessageContent, ChatMessageContent> = z.union([
  z.string(),
  z.array(z.union([ChatMessageImageContentSchema, ChatMessageTextContentSchema])),
]);

export const ChatMessageSchema: z.ZodType<ChatMessage, ChatMessage> = z
  .object({
    role: z.union([z.literal("system"), z.literal("user"), z.literal("assistant")]),
    content: ChatMessageContentSchema,
  })
  .required();

export const ChatCompletionOptionsSchema = z
  .object({
    messages: z.array(ChatMessageSchema),
    // Preserve the V3 screenshot flag while binary image data uses a worker-safe
    // image payload such as base64 plus media_type.
    image: z
      .object({
        description: z.string().optional(),
      })
      .optional(),
    response_model: z
      .object({
        name: z.string(),
        schema: z.custom<z.ZodType>((value) => value instanceof z.ZodType),
      })
      .required()
      .optional(),
    tools: z.array(LLMToolSchema).optional(),
    tool_choice: z.union([z.literal("auto"), z.literal("none"), z.literal("required")]).optional(),
    maxRetries: z.number().int().nonnegative().default(2),
    llmRequestId: z.string().default(() => globalThis.crypto.randomUUID()),
  })
  .strict()
  .required({ messages: true });

export const LLMResponseSchema: z.ZodType<LLMResponse, LLMResponse> = z
  .object({
    id: z.string(),
    object: z.string(),
    created: z.number(),
    model: z.string(),
    choices: z.array(
      z
        .object({
          index: z.number(),
          message: z
            .object({
              role: z.string(),
              content: z.string().nullable(),
              tool_calls: z.array(
                z
                  .object({
                    id: z.string(),
                    type: z.string(),
                    function: z
                      .object({
                        name: z.string(),
                        arguments: z.string(),
                      })
                      .required(),
                  })
                  .required(),
              ),
            })
            .required(),
          finish_reason: z.string().nullable(),
        })
        .required(),
    ),
    usage: z
      .object({
        prompt_tokens: z.number(),
        completion_tokens: z.number(),
        total_tokens: z.number(),
      })
      .required(),
  })
  .required();

export const LLMUsageSchema: z.ZodType<LLMUsage, LLMUsage> = z
  .object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
    reasoning_tokens: z.number().optional(),
    cached_input_tokens: z.number().optional(),
  })
  .required({
    prompt_tokens: true,
    completion_tokens: true,
    total_tokens: true,
  });

export const LLMParsedResponseSchema: z.ZodType<
  LLMParsedResponse<unknown>,
  LLMParsedResponse<unknown>
> = z
  .object({
    // TODO: wire response_model through JSON Schema so parsed data can be
    // validated against a concrete schema instead of remaining unknown.
    data: z.unknown(),
    usage: LLMUsageSchema.optional(),
  })
  .required({ data: true });
