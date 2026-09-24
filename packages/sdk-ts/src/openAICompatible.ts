import type {
  LLMGenerateParams,
  LLMGenerateResult,
  LLMJsonSchemaResponseFormat,
  LLMMessage,
  LLMMessageContentBlock,
} from "@browserbasehq/stagehand-protocol/types";
import type { ClientLLM } from "./clientSchemas.js";

export type OpenAICompatibleOptions = {
  model: string;
  baseURL: string;
  apiKey: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  extraBody?: Record<string, unknown>;
};

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type ChatMessage = {
  role: string;
  content: string | ChatContentPart[];
};

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
};

function contentBlocks(content: LLMMessage["content"]): LLMMessageContentBlock[] {
  return Array.isArray(content) ? content : [content];
}

function chatContent(message: LLMMessage): ChatMessage["content"] {
  const parts: ChatContentPart[] = [];
  for (const block of contentBlocks(message.content)) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text });
      continue;
    }
    if (block.type === "image") {
      parts.push({
        type: "image_url",
        image_url: { url: `data:${block.mimeType};base64,${block.data}` },
      });
      continue;
    }
    throw new TypeError(`OpenAI-compatible models do not accept ${block.type} content`);
  }

  if (parts.every((part) => part.type === "text")) {
    return parts.map((part) => part.text).join("");
  }
  return parts;
}

function chatMessages(params: LLMGenerateParams): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (params.systemPrompt) {
    messages.push({ role: "system", content: params.systemPrompt });
  }
  for (const message of params.messages) {
    messages.push({ role: message.role, content: chatContent(message) });
  }
  return messages;
}

function structuredFormat(responseFormat: LLMJsonSchemaResponseFormat) {
  return {
    type: "json_schema" as const,
    json_schema: {
      name: responseFormat.name,
      description: responseFormat.description,
      schema: responseFormat.schema,
      strict: true,
    },
  };
}

function completionText(body: ChatCompletionResponse): string {
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new Error("OpenAI-compatible response did not include message content");
  }
  return text;
}

/** A client-side model for any endpoint that implements OpenAI Chat Completions. */
export function openAICompatible(options: OpenAICompatibleOptions): ClientLLM {
  const baseURL = options.baseURL.replace(/\/+$/, "");
  const headers = new Headers(options.headers);
  headers.set("authorization", `Bearer ${options.apiKey}`);
  headers.set("content-type", "application/json");

  let endpoint = `${baseURL}/chat/completions`;
  if (options.queryParams && Object.keys(options.queryParams).length > 0) {
    const search = new URLSearchParams(options.queryParams).toString();
    endpoint += (endpoint.includes("?") ? "&" : "?") + search;
  }

  return {
    async generate(params: LLMGenerateParams): Promise<LLMGenerateResult> {
      if (params.responseFormat?.type !== "json_schema") {
        throw new TypeError("Stagehand only issues structured generations");
      }

      const body: Record<string, unknown> = {
        model: options.model,
        messages: chatMessages(params),
        response_format: structuredFormat(params.responseFormat),
        ...options.extraBody,
      };
      if (params.temperature !== undefined && !("temperature" in (options.extraBody ?? {}))) {
        body.temperature = params.temperature;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(
          `OpenAI-compatible request failed (${response.status}): ${await response.text()}`,
        );
      }

      const text = completionText((await response.json()) as ChatCompletionResponse);
      return {
        role: "assistant",
        content: { type: "text", text },
        outputFormat: "json_schema",
        structuredContent: JSON.parse(text) as unknown,
      };
    },
  };
}
