import { expectTypeOf } from "vite-plus/test";
import {
  ChatCompletionOptionsSchema,
  ChatMessageContentSchema,
  ChatMessageImageContentSchema,
  ChatMessageSchema,
  ChatMessageTextContentSchema,
  LLMParsedResponseSchema,
  LLMResponseSchema,
  LLMToolSchema,
  LLMUsageSchema,
} from "./schemas.js";
import type {
  ChatCompletionOptions,
  ChatCompletionOptionsInput,
  ChatMessage,
  ChatMessageContent,
  ChatMessageImageContent,
  ChatMessageTextContent,
  LLMParsedResponse,
  LLMResponse,
  LLMUsage,
} from "./LLMClient.js";
import type { LLMTool } from "../types/public/model.js";

type SchemaOutput<TSchema> = TSchema extends { _output: infer TOutput }
  ? NonNullable<TOutput>
  : never;
type SchemaInput<TSchema> = TSchema extends { _input: infer TInput } ? NonNullable<TInput> : never;
type LLMFinishReason = LLMResponse["choices"][number]["finish_reason"];

// LLM SDK/schema parity. These assertions should fail whenever a Stagehand-owned
// LLM TypeScript type and its matching Zod schema drift apart.
expectTypeOf<SchemaOutput<typeof LLMToolSchema>>().toEqualTypeOf<LLMTool>();
expectTypeOf<SchemaInput<typeof LLMToolSchema>>().toEqualTypeOf<LLMTool>();

expectTypeOf<
  SchemaOutput<typeof ChatMessageImageContentSchema>
>().toEqualTypeOf<ChatMessageImageContent>();
expectTypeOf<
  SchemaInput<typeof ChatMessageImageContentSchema>
>().toEqualTypeOf<ChatMessageImageContent>();

expectTypeOf<
  SchemaOutput<typeof ChatMessageTextContentSchema>
>().toEqualTypeOf<ChatMessageTextContent>();
expectTypeOf<
  SchemaInput<typeof ChatMessageTextContentSchema>
>().toEqualTypeOf<ChatMessageTextContent>();

expectTypeOf<SchemaOutput<typeof ChatMessageContentSchema>>().toEqualTypeOf<ChatMessageContent>();
expectTypeOf<SchemaInput<typeof ChatMessageContentSchema>>().toEqualTypeOf<ChatMessageContent>();

expectTypeOf<SchemaOutput<typeof ChatMessageSchema>>().toEqualTypeOf<ChatMessage>();
expectTypeOf<SchemaInput<typeof ChatMessageSchema>>().toEqualTypeOf<ChatMessage>();

expectTypeOf<
  SchemaOutput<typeof ChatCompletionOptionsSchema>
>().toEqualTypeOf<ChatCompletionOptions>();
expectTypeOf<
  SchemaInput<typeof ChatCompletionOptionsSchema>
>().toEqualTypeOf<ChatCompletionOptionsInput>();
expectTypeOf<
  SchemaOutput<typeof ChatCompletionOptionsSchema>["llmRequestId"]
>().toEqualTypeOf<string>();
expectTypeOf<SchemaInput<typeof ChatCompletionOptionsSchema>["llmRequestId"]>().toEqualTypeOf<
  string | undefined
>();
expectTypeOf<
  NonNullable<SchemaOutput<typeof ChatCompletionOptionsSchema>["image"]>
>().not.toHaveProperty("buffer");

expectTypeOf<SchemaOutput<typeof LLMResponseSchema>>().toEqualTypeOf<LLMResponse>();
expectTypeOf<SchemaInput<typeof LLMResponseSchema>>().toEqualTypeOf<LLMResponse>();
expectTypeOf<LLMFinishReason>().toEqualTypeOf<string | null>();

expectTypeOf<SchemaOutput<typeof LLMUsageSchema>>().toEqualTypeOf<LLMUsage>();
expectTypeOf<SchemaInput<typeof LLMUsageSchema>>().toEqualTypeOf<LLMUsage>();

expectTypeOf<SchemaOutput<typeof LLMParsedResponseSchema>>().toEqualTypeOf<
  LLMParsedResponse<unknown>
>();
expectTypeOf<SchemaInput<typeof LLMParsedResponseSchema>>().toEqualTypeOf<
  LLMParsedResponse<unknown>
>();
expectTypeOf<SchemaOutput<typeof LLMParsedResponseSchema>["data"]>().toEqualTypeOf<unknown>();
