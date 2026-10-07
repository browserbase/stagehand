import { generateObject, type LanguageModel, type ModelMessage } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

export interface LogLine {
  category?: string;
  message: string;
  level?: number;
  auxiliary?: Record<string, { value: unknown; type: string }>;
}
export type LLMResponse = Record<string, unknown>;
export interface LLMParsedResponse<T> {
  data: T;
}
type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export interface CompletionRequest {
  logger: (line: LogLine) => void;
  options: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string | Part[] }>;
    response_model: { name: string; schema: z.ZodType };
  };
}
export interface LLMClient {
  createChatCompletion<T>(request: CompletionRequest): Promise<T>;
}

export const DEFAULT_VERIFIER_MODEL = "google/gemini-3.8-flash";

export function resolveModelName(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.EVAL_VERIFIER_MODEL?.trim() ||
    env.STAGEHAND_EVALUATOR_MODEL?.trim() ||
    DEFAULT_VERIFIER_MODEL
  );
}

/** Providers that authenticate without an API key in the environment. */
export const KEYLESS_JUDGE_PROVIDERS = new Set(["bedrock", "ollama"]);

/** Resolve the judge API key for a provider from the environment (undefined when absent). */
export function loadApiKeyFromEnv(
  provider: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  switch (provider) {
    case "google":
      return (
        env.GOOGLE_GENERATIVE_AI_API_KEY || env.GEMINI_API_KEY || env.GOOGLE_API_KEY || undefined
      );
    case "openai":
      return env.OPENAI_API_KEY || undefined;
    case "anthropic":
      return env.ANTHROPIC_API_KEY || undefined;
    default:
      return undefined;
  }
}

export function createModel(modelName: string): LanguageModel {
  const [provider, ...rest] = modelName.split("/");
  const model = rest.join("/");
  if (!model) throw new Error("Judge model must have provider/model form");
  if (provider === "google") {
    const apiKey =
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("Missing Google judge API key");
    return createGoogleGenerativeAI({ apiKey })(model);
  }
  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) throw new Error("Missing OpenAI judge API key");
    return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(model);
  }
  throw new Error(`Unsupported judge provider: ${provider}`);
}

/**
 * Optional reasoning cap (VERIFIER_THINKING_BUDGET, tokens). Unset = provider default. Applied through
 * provider options; providers that do not support it ignore the key.
 */
function thinkingProviderOptions(): Record<string, unknown> {
  const raw = process.env.VERIFIER_THINKING_BUDGET;
  const budget = raw ? Number(raw) : NaN;
  if (!Number.isFinite(budget) || budget < 0) return {};
  return { providerOptions: { google: { thinkingConfig: { thinkingBudget: budget } } } };
}

export class AISdkJudge implements LLMClient {
  constructor(
    readonly model: LanguageModel,
    readonly onUsage?: (usage: unknown) => void,
  ) {}

  /** Stable identity for caching health checks (provider/model). */
  get modelId(): string {
    const m = this.model as unknown as { provider?: string; modelId?: string };
    return typeof this.model === "string" ? this.model : `${m.provider ?? "?"}/${m.modelId ?? "?"}`;
  }

  async createChatCompletion<T>({ options, logger }: CompletionRequest): Promise<T> {
    const messages = options.messages.map((message): ModelMessage => {
      if (typeof message.content === "string")
        return { role: message.role, content: message.content };
      if (message.role !== "user") throw new Error("Multimodal judge messages must have user role");
      return {
        role: "user",
        content: message.content.map((part) =>
          part.type === "text"
            ? part
            : { type: "image" as const, image: new URL(part.image_url.url) },
        ),
      };
    });
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    logger({
      category: "aisdk",
      message: "verifier request",
      level: 2,
      auxiliary: {
        request: {
          type: "object",
          value: {
            stage: options.response_model.name,
            messages: options.messages.map((m) => ({
              ...m,
              content:
                typeof m.content === "string"
                  ? m.content
                  : m.content.map((p) =>
                      p.type === "text"
                        ? p
                        : { type: "image", dataUrlChars: p.image_url.url.length },
                    ),
            })),
          },
        },
      },
    });
    const reasoningModel =
      typeof this.model === "object" && /gpt-[56]|^o[134]/.test(this.model.modelId);
    // Per-attempt timeout with retry: a stalled provider call is abandoned and retried instead of
    // consuming one long timeout and leaving the row ungraded. Budget: attempts × per-attempt timeout.
    const perAttemptMs = Number(process.env.VERIFIER_CALL_TIMEOUT_MS) || 60_000;
    const attempts = Math.max(1, Number(process.env.VERIFIER_CALL_ATTEMPTS) || 2);
    let response: Awaited<ReturnType<typeof generateObject>> | undefined;
    for (let attempt = 1; ; attempt++) {
      try {
        response = await generateObject({
          model: this.model,
          schema: options.response_model.schema,
          schemaName: options.response_model.name,
          system,
          messages: messages.filter((m) => m.role !== "system"),
          temperature: reasoningModel ? undefined : 0,
          ...thinkingProviderOptions(),
          maxRetries: 2,
          abortSignal: AbortSignal.timeout(perAttemptMs),
        });
        break;
      } catch (error) {
        const timedOut =
          error instanceof Error && /abort|timeout/i.test(`${error.name} ${error.message}`);
        if (!timedOut || attempt >= attempts) throw error;
        logger({
          category: "aisdk",
          level: 1,
          message: `verifier call timed out after ${perAttemptMs}ms; retrying (${attempt + 1}/${attempts})`,
        });
      }
    }
    this.onUsage?.(response.usage);
    logger({
      category: "aisdk",
      message: "verifier response",
      level: 2,
      auxiliary: {
        response: {
          type: "object",
          value: {
            stage: options.response_model.name,
            data: response.object,
            usage: response.usage,
          },
        },
      },
    });
    return { data: response.object } as T;
  }

  async validate(): Promise<void> {
    const result = await this.createChatCompletion<LLMParsedResponse<{ ready: boolean }>>({
      logger: () => {},
      options: {
        messages: [{ role: "user", content: "Return ready: true." }],
        response_model: { name: "JudgeHealth", schema: z.object({ ready: z.boolean() }) },
      },
    });
    if (result.data.ready !== true) throw new Error("Judge health check failed");
  }
}
