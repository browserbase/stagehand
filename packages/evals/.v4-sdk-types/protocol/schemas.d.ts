import { z } from "zod/v4";
export declare const OpenAIModelIdSchema: z.ZodEnum<{
    "gpt-4.1": "gpt-4.1";
    "gpt-4.1-2025-04-14": "gpt-4.1-2025-04-14";
    "gpt-4.1-mini": "gpt-4.1-mini";
    "gpt-4.1-mini-2025-04-14": "gpt-4.1-mini-2025-04-14";
    "gpt-4.1-nano": "gpt-4.1-nano";
    "gpt-4.1-nano-2025-04-14": "gpt-4.1-nano-2025-04-14";
    "gpt-4o": "gpt-4o";
    "gpt-4o-2024-05-13": "gpt-4o-2024-05-13";
    "gpt-4o-2024-08-06": "gpt-4o-2024-08-06";
    "gpt-4o-2024-11-20": "gpt-4o-2024-11-20";
    "gpt-4o-audio-preview": "gpt-4o-audio-preview";
    "gpt-4o-audio-preview-2024-12-17": "gpt-4o-audio-preview-2024-12-17";
    "gpt-4o-search-preview": "gpt-4o-search-preview";
    "gpt-4o-search-preview-2025-03-11": "gpt-4o-search-preview-2025-03-11";
    "gpt-4o-mini-search-preview": "gpt-4o-mini-search-preview";
    "gpt-4o-mini-search-preview-2025-03-11": "gpt-4o-mini-search-preview-2025-03-11";
    "gpt-4o-mini": "gpt-4o-mini";
    "gpt-4o-mini-2024-07-18": "gpt-4o-mini-2024-07-18";
    "gpt-3.5-turbo-0125": "gpt-3.5-turbo-0125";
    "gpt-3.5-turbo": "gpt-3.5-turbo";
    "gpt-3.5-turbo-1106": "gpt-3.5-turbo-1106";
    "gpt-5-chat-latest": "gpt-5-chat-latest";
    o1: "o1";
    "o1-2024-12-17": "o1-2024-12-17";
    o3: "o3";
    "o3-2025-04-16": "o3-2025-04-16";
    "o3-mini": "o3-mini";
    "o3-mini-2025-01-31": "o3-mini-2025-01-31";
    "o4-mini": "o4-mini";
    "o4-mini-2025-04-16": "o4-mini-2025-04-16";
    "gpt-5": "gpt-5";
    "gpt-5-2025-08-07": "gpt-5-2025-08-07";
    "gpt-5-codex": "gpt-5-codex";
    "gpt-5-mini": "gpt-5-mini";
    "gpt-5-mini-2025-08-07": "gpt-5-mini-2025-08-07";
    "gpt-5-nano": "gpt-5-nano";
    "gpt-5-nano-2025-08-07": "gpt-5-nano-2025-08-07";
    "gpt-5-pro": "gpt-5-pro";
    "gpt-5-pro-2025-10-06": "gpt-5-pro-2025-10-06";
    "gpt-5.1": "gpt-5.1";
    "gpt-5.1-chat-latest": "gpt-5.1-chat-latest";
    "gpt-5.1-codex-mini": "gpt-5.1-codex-mini";
    "gpt-5.1-codex": "gpt-5.1-codex";
    "gpt-5.1-codex-max": "gpt-5.1-codex-max";
    "gpt-5.2": "gpt-5.2";
    "gpt-5.2-chat-latest": "gpt-5.2-chat-latest";
    "gpt-5.2-pro": "gpt-5.2-pro";
    "gpt-5.2-codex": "gpt-5.2-codex";
    "gpt-5.3-chat-latest": "gpt-5.3-chat-latest";
    "gpt-5.3-codex": "gpt-5.3-codex";
    "gpt-5.4": "gpt-5.4";
    "gpt-5.4-2026-03-05": "gpt-5.4-2026-03-05";
    "gpt-5.4-mini": "gpt-5.4-mini";
    "gpt-5.4-mini-2026-03-17": "gpt-5.4-mini-2026-03-17";
    "gpt-5.4-nano": "gpt-5.4-nano";
    "gpt-5.4-nano-2026-03-17": "gpt-5.4-nano-2026-03-17";
    "gpt-5.4-pro": "gpt-5.4-pro";
    "gpt-5.4-pro-2026-03-05": "gpt-5.4-pro-2026-03-05";
    "gpt-5.5": "gpt-5.5";
    "gpt-5.5-2026-04-23": "gpt-5.5-2026-04-23";
    "gpt-5.6": "gpt-5.6";
    "gpt-5.6-luna": "gpt-5.6-luna";
    "gpt-5.6-sol": "gpt-5.6-sol";
    "gpt-5.6-terra": "gpt-5.6-terra";
}>;
export declare const AnthropicModelIdSchema: z.ZodEnum<{
    "claude-3-haiku-20240307": "claude-3-haiku-20240307";
    "claude-haiku-4-5-20251001": "claude-haiku-4-5-20251001";
    "claude-haiku-4-5": "claude-haiku-4-5";
    "claude-opus-4-0": "claude-opus-4-0";
    "claude-opus-4-20250514": "claude-opus-4-20250514";
    "claude-opus-4-1-20250805": "claude-opus-4-1-20250805";
    "claude-opus-4-1": "claude-opus-4-1";
    "claude-opus-4-5": "claude-opus-4-5";
    "claude-opus-4-5-20251101": "claude-opus-4-5-20251101";
    "claude-sonnet-4-0": "claude-sonnet-4-0";
    "claude-sonnet-4-20250514": "claude-sonnet-4-20250514";
    "claude-sonnet-4-5-20250929": "claude-sonnet-4-5-20250929";
    "claude-sonnet-4-5": "claude-sonnet-4-5";
    "claude-sonnet-4-6": "claude-sonnet-4-6";
    "claude-opus-4-6": "claude-opus-4-6";
    "claude-opus-4-7": "claude-opus-4-7";
    "claude-opus-4-8": "claude-opus-4-8";
    "claude-fable-5": "claude-fable-5";
    "claude-sonnet-5": "claude-sonnet-5";
}>;
export declare const GoogleModelIdSchema: z.ZodEnum<{
    "gemini-2.0-flash": "gemini-2.0-flash";
    "gemini-2.0-flash-001": "gemini-2.0-flash-001";
    "gemini-2.0-flash-lite": "gemini-2.0-flash-lite";
    "gemini-2.0-flash-lite-001": "gemini-2.0-flash-lite-001";
    "gemini-2.5-pro": "gemini-2.5-pro";
    "gemini-2.5-flash": "gemini-2.5-flash";
    "gemini-2.5-flash-image": "gemini-2.5-flash-image";
    "gemini-2.5-flash-lite": "gemini-2.5-flash-lite";
    "gemini-2.5-flash-preview-tts": "gemini-2.5-flash-preview-tts";
    "gemini-2.5-pro-preview-tts": "gemini-2.5-pro-preview-tts";
    "gemini-2.5-flash-native-audio-latest": "gemini-2.5-flash-native-audio-latest";
    "gemini-2.5-flash-native-audio-preview-09-2025": "gemini-2.5-flash-native-audio-preview-09-2025";
    "gemini-2.5-flash-native-audio-preview-12-2025": "gemini-2.5-flash-native-audio-preview-12-2025";
    "gemini-2.5-computer-use-preview-10-2025": "gemini-2.5-computer-use-preview-10-2025";
    "gemini-3-pro-preview": "gemini-3-pro-preview";
    "gemini-3-pro-image-preview": "gemini-3-pro-image-preview";
    "gemini-3-flash-preview": "gemini-3-flash-preview";
    "gemini-3.1-pro-preview": "gemini-3.1-pro-preview";
    "gemini-3.1-pro-preview-customtools": "gemini-3.1-pro-preview-customtools";
    "gemini-3.1-flash-image-preview": "gemini-3.1-flash-image-preview";
    "gemini-3.1-flash-lite-preview": "gemini-3.1-flash-lite-preview";
    "gemini-3.1-flash-tts-preview": "gemini-3.1-flash-tts-preview";
    "gemini-3.5-flash": "gemini-3.5-flash";
    "gemini-pro-latest": "gemini-pro-latest";
    "gemini-flash-latest": "gemini-flash-latest";
    "gemini-flash-lite-latest": "gemini-flash-lite-latest";
    "deep-research-pro-preview-12-2025": "deep-research-pro-preview-12-2025";
    "deep-research-max-preview-04-2026": "deep-research-max-preview-04-2026";
    "deep-research-preview-04-2026": "deep-research-preview-04-2026";
    "nano-banana-pro-preview": "nano-banana-pro-preview";
    aqa: "aqa";
    "gemini-robotics-er-1.5-preview": "gemini-robotics-er-1.5-preview";
    "gemma-3-1b-it": "gemma-3-1b-it";
    "gemma-3-4b-it": "gemma-3-4b-it";
    "gemma-3n-e4b-it": "gemma-3n-e4b-it";
    "gemma-3n-e2b-it": "gemma-3n-e2b-it";
    "gemma-3-12b-it": "gemma-3-12b-it";
    "gemma-3-27b-it": "gemma-3-27b-it";
}>;
export declare const GroqModelIdSchema: z.ZodEnum<{
    "gemma2-9b-it": "gemma2-9b-it";
    "llama-3.1-8b-instant": "llama-3.1-8b-instant";
    "llama-3.3-70b-versatile": "llama-3.3-70b-versatile";
    "meta-llama/llama-guard-4-12b": "meta-llama/llama-guard-4-12b";
    "openai/gpt-oss-120b": "openai/gpt-oss-120b";
    "openai/gpt-oss-20b": "openai/gpt-oss-20b";
    "deepseek-r1-distill-llama-70b": "deepseek-r1-distill-llama-70b";
    "meta-llama/llama-4-maverick-17b-128e-instruct": "meta-llama/llama-4-maverick-17b-128e-instruct";
    "meta-llama/llama-4-scout-17b-16e-instruct": "meta-llama/llama-4-scout-17b-16e-instruct";
    "meta-llama/llama-prompt-guard-2-22m": "meta-llama/llama-prompt-guard-2-22m";
    "meta-llama/llama-prompt-guard-2-86m": "meta-llama/llama-prompt-guard-2-86m";
    "moonshotai/kimi-k2-instruct-0905": "moonshotai/kimi-k2-instruct-0905";
    "qwen/qwen3-32b": "qwen/qwen3-32b";
    "llama-guard-3-8b": "llama-guard-3-8b";
    "llama3-70b-8192": "llama3-70b-8192";
    "llama3-8b-8192": "llama3-8b-8192";
    "mixtral-8x7b-32768": "mixtral-8x7b-32768";
    "qwen-qwq-32b": "qwen-qwq-32b";
    "qwen-2.5-32b": "qwen-2.5-32b";
    "deepseek-r1-distill-qwen-32b": "deepseek-r1-distill-qwen-32b";
}>;
export declare const CerebrasModelIdSchema: z.ZodEnum<{
    "llama3.1-8b": "llama3.1-8b";
    "gpt-oss-120b": "gpt-oss-120b";
    "qwen-3-235b-a22b-instruct-2507": "qwen-3-235b-a22b-instruct-2507";
    "qwen-3-235b-a22b-thinking-2507": "qwen-3-235b-a22b-thinking-2507";
    "zai-glm-4.6": "zai-glm-4.6";
    "zai-glm-4.7": "zai-glm-4.7";
}>;
export declare const ModelProviderSchema: z.ZodEnum<{
    openai: "openai";
    anthropic: "anthropic";
    google: "google";
    groq: "groq";
    cerebras: "cerebras";
}>;
export declare const OpenAIModelNameSchema: z.ZodTemplateLiteral<"openai/gpt-4.1" | "openai/gpt-4.1-2025-04-14" | "openai/gpt-4.1-mini" | "openai/gpt-4.1-mini-2025-04-14" | "openai/gpt-4.1-nano" | "openai/gpt-4.1-nano-2025-04-14" | "openai/gpt-4o" | "openai/gpt-4o-2024-05-13" | "openai/gpt-4o-2024-08-06" | "openai/gpt-4o-2024-11-20" | "openai/gpt-4o-audio-preview" | "openai/gpt-4o-audio-preview-2024-12-17" | "openai/gpt-4o-search-preview" | "openai/gpt-4o-search-preview-2025-03-11" | "openai/gpt-4o-mini-search-preview" | "openai/gpt-4o-mini-search-preview-2025-03-11" | "openai/gpt-4o-mini" | "openai/gpt-4o-mini-2024-07-18" | "openai/gpt-3.5-turbo-0125" | "openai/gpt-3.5-turbo" | "openai/gpt-3.5-turbo-1106" | "openai/gpt-5-chat-latest" | "openai/o1" | "openai/o1-2024-12-17" | "openai/o3" | "openai/o3-2025-04-16" | "openai/o3-mini" | "openai/o3-mini-2025-01-31" | "openai/o4-mini" | "openai/o4-mini-2025-04-16" | "openai/gpt-5" | "openai/gpt-5-2025-08-07" | "openai/gpt-5-codex" | "openai/gpt-5-mini" | "openai/gpt-5-mini-2025-08-07" | "openai/gpt-5-nano" | "openai/gpt-5-nano-2025-08-07" | "openai/gpt-5-pro" | "openai/gpt-5-pro-2025-10-06" | "openai/gpt-5.1" | "openai/gpt-5.1-chat-latest" | "openai/gpt-5.1-codex-mini" | "openai/gpt-5.1-codex" | "openai/gpt-5.1-codex-max" | "openai/gpt-5.2" | "openai/gpt-5.2-chat-latest" | "openai/gpt-5.2-pro" | "openai/gpt-5.2-codex" | "openai/gpt-5.3-chat-latest" | "openai/gpt-5.3-codex" | "openai/gpt-5.4" | "openai/gpt-5.4-2026-03-05" | "openai/gpt-5.4-mini" | "openai/gpt-5.4-mini-2026-03-17" | "openai/gpt-5.4-nano" | "openai/gpt-5.4-nano-2026-03-17" | "openai/gpt-5.4-pro" | "openai/gpt-5.4-pro-2026-03-05" | "openai/gpt-5.5" | "openai/gpt-5.5-2026-04-23" | "openai/gpt-5.6" | "openai/gpt-5.6-luna" | "openai/gpt-5.6-sol" | "openai/gpt-5.6-terra">;
export declare const AnthropicModelNameSchema: z.ZodTemplateLiteral<"anthropic/claude-3-haiku-20240307" | "anthropic/claude-haiku-4-5-20251001" | "anthropic/claude-haiku-4-5" | "anthropic/claude-opus-4-0" | "anthropic/claude-opus-4-20250514" | "anthropic/claude-opus-4-1-20250805" | "anthropic/claude-opus-4-1" | "anthropic/claude-opus-4-5" | "anthropic/claude-opus-4-5-20251101" | "anthropic/claude-sonnet-4-0" | "anthropic/claude-sonnet-4-20250514" | "anthropic/claude-sonnet-4-5-20250929" | "anthropic/claude-sonnet-4-5" | "anthropic/claude-sonnet-4-6" | "anthropic/claude-opus-4-6" | "anthropic/claude-opus-4-7" | "anthropic/claude-opus-4-8" | "anthropic/claude-fable-5" | "anthropic/claude-sonnet-5">;
export declare const GoogleModelNameSchema: z.ZodTemplateLiteral<"google/gemini-2.0-flash" | "google/gemini-2.0-flash-001" | "google/gemini-2.0-flash-lite" | "google/gemini-2.0-flash-lite-001" | "google/gemini-2.5-pro" | "google/gemini-2.5-flash" | "google/gemini-2.5-flash-image" | "google/gemini-2.5-flash-lite" | "google/gemini-2.5-flash-preview-tts" | "google/gemini-2.5-pro-preview-tts" | "google/gemini-2.5-flash-native-audio-latest" | "google/gemini-2.5-flash-native-audio-preview-09-2025" | "google/gemini-2.5-flash-native-audio-preview-12-2025" | "google/gemini-2.5-computer-use-preview-10-2025" | "google/gemini-3-pro-preview" | "google/gemini-3-pro-image-preview" | "google/gemini-3-flash-preview" | "google/gemini-3.1-pro-preview" | "google/gemini-3.1-pro-preview-customtools" | "google/gemini-3.1-flash-image-preview" | "google/gemini-3.1-flash-lite-preview" | "google/gemini-3.1-flash-tts-preview" | "google/gemini-3.5-flash" | "google/gemini-pro-latest" | "google/gemini-flash-latest" | "google/gemini-flash-lite-latest" | "google/deep-research-pro-preview-12-2025" | "google/deep-research-max-preview-04-2026" | "google/deep-research-preview-04-2026" | "google/nano-banana-pro-preview" | "google/aqa" | "google/gemini-robotics-er-1.5-preview" | "google/gemma-3-1b-it" | "google/gemma-3-4b-it" | "google/gemma-3n-e4b-it" | "google/gemma-3n-e2b-it" | "google/gemma-3-12b-it" | "google/gemma-3-27b-it">;
export declare const GroqModelNameSchema: z.ZodTemplateLiteral<"groq/gemma2-9b-it" | "groq/llama-3.1-8b-instant" | "groq/llama-3.3-70b-versatile" | "groq/meta-llama/llama-guard-4-12b" | "groq/openai/gpt-oss-120b" | "groq/openai/gpt-oss-20b" | "groq/deepseek-r1-distill-llama-70b" | "groq/meta-llama/llama-4-maverick-17b-128e-instruct" | "groq/meta-llama/llama-4-scout-17b-16e-instruct" | "groq/meta-llama/llama-prompt-guard-2-22m" | "groq/meta-llama/llama-prompt-guard-2-86m" | "groq/moonshotai/kimi-k2-instruct-0905" | "groq/qwen/qwen3-32b" | "groq/llama-guard-3-8b" | "groq/llama3-70b-8192" | "groq/llama3-8b-8192" | "groq/mixtral-8x7b-32768" | "groq/qwen-qwq-32b" | "groq/qwen-2.5-32b" | "groq/deepseek-r1-distill-qwen-32b">;
export declare const CerebrasModelNameSchema: z.ZodTemplateLiteral<"cerebras/llama3.1-8b" | "cerebras/gpt-oss-120b" | "cerebras/qwen-3-235b-a22b-instruct-2507" | "cerebras/qwen-3-235b-a22b-thinking-2507" | "cerebras/zai-glm-4.6" | "cerebras/zai-glm-4.7">;
export declare const ModelNameSchema: z.ZodUnion<readonly [z.ZodTemplateLiteral<"openai/gpt-4.1" | "openai/gpt-4.1-2025-04-14" | "openai/gpt-4.1-mini" | "openai/gpt-4.1-mini-2025-04-14" | "openai/gpt-4.1-nano" | "openai/gpt-4.1-nano-2025-04-14" | "openai/gpt-4o" | "openai/gpt-4o-2024-05-13" | "openai/gpt-4o-2024-08-06" | "openai/gpt-4o-2024-11-20" | "openai/gpt-4o-audio-preview" | "openai/gpt-4o-audio-preview-2024-12-17" | "openai/gpt-4o-search-preview" | "openai/gpt-4o-search-preview-2025-03-11" | "openai/gpt-4o-mini-search-preview" | "openai/gpt-4o-mini-search-preview-2025-03-11" | "openai/gpt-4o-mini" | "openai/gpt-4o-mini-2024-07-18" | "openai/gpt-3.5-turbo-0125" | "openai/gpt-3.5-turbo" | "openai/gpt-3.5-turbo-1106" | "openai/gpt-5-chat-latest" | "openai/o1" | "openai/o1-2024-12-17" | "openai/o3" | "openai/o3-2025-04-16" | "openai/o3-mini" | "openai/o3-mini-2025-01-31" | "openai/o4-mini" | "openai/o4-mini-2025-04-16" | "openai/gpt-5" | "openai/gpt-5-2025-08-07" | "openai/gpt-5-codex" | "openai/gpt-5-mini" | "openai/gpt-5-mini-2025-08-07" | "openai/gpt-5-nano" | "openai/gpt-5-nano-2025-08-07" | "openai/gpt-5-pro" | "openai/gpt-5-pro-2025-10-06" | "openai/gpt-5.1" | "openai/gpt-5.1-chat-latest" | "openai/gpt-5.1-codex-mini" | "openai/gpt-5.1-codex" | "openai/gpt-5.1-codex-max" | "openai/gpt-5.2" | "openai/gpt-5.2-chat-latest" | "openai/gpt-5.2-pro" | "openai/gpt-5.2-codex" | "openai/gpt-5.3-chat-latest" | "openai/gpt-5.3-codex" | "openai/gpt-5.4" | "openai/gpt-5.4-2026-03-05" | "openai/gpt-5.4-mini" | "openai/gpt-5.4-mini-2026-03-17" | "openai/gpt-5.4-nano" | "openai/gpt-5.4-nano-2026-03-17" | "openai/gpt-5.4-pro" | "openai/gpt-5.4-pro-2026-03-05" | "openai/gpt-5.5" | "openai/gpt-5.5-2026-04-23" | "openai/gpt-5.6" | "openai/gpt-5.6-luna" | "openai/gpt-5.6-sol" | "openai/gpt-5.6-terra">, z.ZodTemplateLiteral<"anthropic/claude-3-haiku-20240307" | "anthropic/claude-haiku-4-5-20251001" | "anthropic/claude-haiku-4-5" | "anthropic/claude-opus-4-0" | "anthropic/claude-opus-4-20250514" | "anthropic/claude-opus-4-1-20250805" | "anthropic/claude-opus-4-1" | "anthropic/claude-opus-4-5" | "anthropic/claude-opus-4-5-20251101" | "anthropic/claude-sonnet-4-0" | "anthropic/claude-sonnet-4-20250514" | "anthropic/claude-sonnet-4-5-20250929" | "anthropic/claude-sonnet-4-5" | "anthropic/claude-sonnet-4-6" | "anthropic/claude-opus-4-6" | "anthropic/claude-opus-4-7" | "anthropic/claude-opus-4-8" | "anthropic/claude-fable-5" | "anthropic/claude-sonnet-5">, z.ZodTemplateLiteral<"google/gemini-2.0-flash" | "google/gemini-2.0-flash-001" | "google/gemini-2.0-flash-lite" | "google/gemini-2.0-flash-lite-001" | "google/gemini-2.5-pro" | "google/gemini-2.5-flash" | "google/gemini-2.5-flash-image" | "google/gemini-2.5-flash-lite" | "google/gemini-2.5-flash-preview-tts" | "google/gemini-2.5-pro-preview-tts" | "google/gemini-2.5-flash-native-audio-latest" | "google/gemini-2.5-flash-native-audio-preview-09-2025" | "google/gemini-2.5-flash-native-audio-preview-12-2025" | "google/gemini-2.5-computer-use-preview-10-2025" | "google/gemini-3-pro-preview" | "google/gemini-3-pro-image-preview" | "google/gemini-3-flash-preview" | "google/gemini-3.1-pro-preview" | "google/gemini-3.1-pro-preview-customtools" | "google/gemini-3.1-flash-image-preview" | "google/gemini-3.1-flash-lite-preview" | "google/gemini-3.1-flash-tts-preview" | "google/gemini-3.5-flash" | "google/gemini-pro-latest" | "google/gemini-flash-latest" | "google/gemini-flash-lite-latest" | "google/deep-research-pro-preview-12-2025" | "google/deep-research-max-preview-04-2026" | "google/deep-research-preview-04-2026" | "google/nano-banana-pro-preview" | "google/aqa" | "google/gemini-robotics-er-1.5-preview" | "google/gemma-3-1b-it" | "google/gemma-3-4b-it" | "google/gemma-3n-e4b-it" | "google/gemma-3n-e2b-it" | "google/gemma-3-12b-it" | "google/gemma-3-27b-it">, z.ZodTemplateLiteral<"groq/gemma2-9b-it" | "groq/llama-3.1-8b-instant" | "groq/llama-3.3-70b-versatile" | "groq/meta-llama/llama-guard-4-12b" | "groq/openai/gpt-oss-120b" | "groq/openai/gpt-oss-20b" | "groq/deepseek-r1-distill-llama-70b" | "groq/meta-llama/llama-4-maverick-17b-128e-instruct" | "groq/meta-llama/llama-4-scout-17b-16e-instruct" | "groq/meta-llama/llama-prompt-guard-2-22m" | "groq/meta-llama/llama-prompt-guard-2-86m" | "groq/moonshotai/kimi-k2-instruct-0905" | "groq/qwen/qwen3-32b" | "groq/llama-guard-3-8b" | "groq/llama3-70b-8192" | "groq/llama3-8b-8192" | "groq/mixtral-8x7b-32768" | "groq/qwen-qwq-32b" | "groq/qwen-2.5-32b" | "groq/deepseek-r1-distill-qwen-32b">, z.ZodTemplateLiteral<"cerebras/llama3.1-8b" | "cerebras/gpt-oss-120b" | "cerebras/qwen-3-235b-a22b-instruct-2507" | "cerebras/qwen-3-235b-a22b-thinking-2507" | "cerebras/zai-glm-4.6" | "cerebras/zai-glm-4.7">]>;
export declare const CookieSchema: z.ZodObject<{
    name: z.ZodString;
    value: z.ZodString;
    domain: z.ZodString;
    path: z.ZodString;
    expires: z.ZodNumber;
    httpOnly: z.ZodBoolean;
    secure: z.ZodBoolean;
    sameSite: z.ZodEnum<{
        Strict: "Strict";
        Lax: "Lax";
        None: "None";
    }>;
}, z.core.$strict>;
export declare const CookieParamSchema: z.ZodObject<{
    name: z.ZodString;
    value: z.ZodString;
    url: z.ZodOptional<z.ZodString>;
    domain: z.ZodOptional<z.ZodString>;
    path: z.ZodOptional<z.ZodString>;
    expires: z.ZodOptional<z.ZodNumber>;
    httpOnly: z.ZodOptional<z.ZodBoolean>;
    secure: z.ZodOptional<z.ZodBoolean>;
    sameSite: z.ZodOptional<z.ZodEnum<{
        Strict: "Strict";
        Lax: "Lax";
        None: "None";
    }>>;
}, z.core.$strict>;
export declare const CookieRegexSchema: z.ZodObject<{
    source: z.ZodString;
    flags: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const CookieFilterSchema: z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
    source: z.ZodString;
    flags: z.ZodOptional<z.ZodString>;
}, z.core.$strict>]>;
export declare const ClearCookieOptionsSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        source: z.ZodString;
        flags: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>]>>;
    domain: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        source: z.ZodString;
        flags: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>]>>;
    path: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        source: z.ZodString;
        flags: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>]>>;
}, z.core.$strict>;
export declare const DomainPolicySchema: z.ZodObject<{
    allowedDomains: z.ZodOptional<z.ZodArray<z.ZodString>>;
    blockedDomains: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export declare const LLMRoleSchema: z.ZodEnum<{
    user: "user";
    assistant: "assistant";
}>;
export declare const LLMAnnotationsSchema: z.ZodObject<{
    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        user: "user";
        assistant: "assistant";
    }>>>;
    priority: z.ZodOptional<z.ZodNumber>;
    lastModified: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const LLMTextContentSchema: z.ZodObject<{
    type: z.ZodLiteral<"text">;
    text: z.ZodString;
    annotations: z.ZodOptional<z.ZodObject<{
        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            user: "user";
            assistant: "assistant";
        }>>>;
        priority: z.ZodOptional<z.ZodNumber>;
        lastModified: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const LLMImageContentSchema: z.ZodObject<{
    type: z.ZodLiteral<"image">;
    data: z.ZodBase64;
    mimeType: z.ZodString;
    annotations: z.ZodOptional<z.ZodObject<{
        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            user: "user";
            assistant: "assistant";
        }>>>;
        priority: z.ZodOptional<z.ZodNumber>;
        lastModified: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const LLMToolUseContentSchema: z.ZodObject<{
    type: z.ZodLiteral<"tool_use">;
    id: z.ZodString;
    name: z.ZodString;
    input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
}, z.core.$strict>;
export declare const LLMToolResultContentSchema: z.ZodObject<{
    type: z.ZodLiteral<"tool_result">;
    toolUseId: z.ZodString;
    content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodBase64;
        mimeType: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>], "type">>;
    structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
    isError: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export declare const LLMMessageContentBlockSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"text">;
    text: z.ZodString;
    annotations: z.ZodOptional<z.ZodObject<{
        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            user: "user";
            assistant: "assistant";
        }>>>;
        priority: z.ZodOptional<z.ZodNumber>;
        lastModified: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"image">;
    data: z.ZodBase64;
    mimeType: z.ZodString;
    annotations: z.ZodOptional<z.ZodObject<{
        audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            user: "user";
            assistant: "assistant";
        }>>>;
        priority: z.ZodOptional<z.ZodNumber>;
        lastModified: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"tool_use">;
    id: z.ZodString;
    name: z.ZodString;
    input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"tool_result">;
    toolUseId: z.ZodString;
    content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodBase64;
        mimeType: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>], "type">>;
    structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
    isError: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>], "type">;
export declare const LLMMessageSchema: z.ZodObject<{
    role: z.ZodEnum<{
        user: "user";
        assistant: "assistant";
    }>;
    content: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodBase64;
        mimeType: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_use">;
        id: z.ZodString;
        name: z.ZodString;
        input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_result">;
        toolUseId: z.ZodString;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>], "type">>;
        structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
        isError: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>], "type">, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodBase64;
        mimeType: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_use">;
        id: z.ZodString;
        name: z.ZodString;
        input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_result">;
        toolUseId: z.ZodString;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>], "type">>;
        structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
        isError: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>], "type">>]>;
}, z.core.$strict>;
export declare const LLMToolAnnotationsSchema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    readOnlyHint: z.ZodOptional<z.ZodBoolean>;
    destructiveHint: z.ZodOptional<z.ZodBoolean>;
    idempotentHint: z.ZodOptional<z.ZodBoolean>;
    openWorldHint: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export declare const LLMToolExecutionSchema: z.ZodObject<{
    taskSupport: z.ZodOptional<z.ZodEnum<{
        optional: "optional";
        required: "required";
        forbidden: "forbidden";
    }>>;
}, z.core.$strict>;
export declare const LLMToolIconSchema: z.ZodObject<{
    src: z.ZodURL;
    mimeType: z.ZodOptional<z.ZodString>;
    sizes: z.ZodOptional<z.ZodArray<z.ZodString>>;
    theme: z.ZodOptional<z.ZodEnum<{
        light: "light";
        dark: "dark";
    }>>;
}, z.core.$strict>;
export declare const LLMClientToolSchema: z.ZodObject<{
    name: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    icons: z.ZodOptional<z.ZodArray<z.ZodObject<{
        src: z.ZodURL;
        mimeType: z.ZodOptional<z.ZodString>;
        sizes: z.ZodOptional<z.ZodArray<z.ZodString>>;
        theme: z.ZodOptional<z.ZodEnum<{
            light: "light";
            dark: "dark";
        }>>;
    }, z.core.$strict>>>;
    description: z.ZodOptional<z.ZodString>;
    inputSchema: z.ZodObject<{
        $schema: z.ZodOptional<z.ZodString>;
        type: z.ZodLiteral<"object">;
        properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodJSONSchema>>>;
        required: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    execution: z.ZodOptional<z.ZodObject<{
        taskSupport: z.ZodOptional<z.ZodEnum<{
            optional: "optional";
            required: "required";
            forbidden: "forbidden";
        }>>;
    }, z.core.$strict>>;
    outputSchema: z.ZodOptional<z.ZodObject<{
        $schema: z.ZodOptional<z.ZodString>;
        type: z.ZodLiteral<"object">;
        properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodJSONSchema>>>;
        required: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
    annotations: z.ZodOptional<z.ZodObject<{
        title: z.ZodOptional<z.ZodString>;
        readOnlyHint: z.ZodOptional<z.ZodBoolean>;
        destructiveHint: z.ZodOptional<z.ZodBoolean>;
        idempotentHint: z.ZodOptional<z.ZodBoolean>;
        openWorldHint: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const LLMToolChoiceSchema: z.ZodObject<{
    mode: z.ZodOptional<z.ZodEnum<{
        required: "required";
        auto: "auto";
        none: "none";
    }>>;
}, z.core.$strict>;
export declare const LLMTextResponseFormatSchema: z.ZodObject<{
    type: z.ZodLiteral<"text">;
}, z.core.$strict>;
export declare const LLMJsonSchemaResponseFormatSchema: z.ZodObject<{
    type: z.ZodLiteral<"json_schema">;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    schema: z.ZodJSONSchema;
}, z.core.$strict>;
export declare const LLMResponseFormatSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"text">;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"json_schema">;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    schema: z.ZodJSONSchema;
}, z.core.$strict>], "type">;
export declare const LLMMessageGenerateParamsSchema: z.ZodObject<{
    messages: z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<{
            user: "user";
            assistant: "assistant";
        }>;
        content: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_use">;
            id: z.ZodString;
            name: z.ZodString;
            input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_result">;
            toolUseId: z.ZodString;
            content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodBase64;
                mimeType: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>], "type">>;
            structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
            isError: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>], "type">, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_use">;
            id: z.ZodString;
            name: z.ZodString;
            input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_result">;
            toolUseId: z.ZodString;
            content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodBase64;
                mimeType: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>], "type">>;
            structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
            isError: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>], "type">>]>;
    }, z.core.$strict>>;
    systemPrompt: z.ZodOptional<z.ZodString>;
    temperature: z.ZodOptional<z.ZodNumber>;
    stopSequences: z.ZodOptional<z.ZodArray<z.ZodString>>;
    tools: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        icons: z.ZodOptional<z.ZodArray<z.ZodObject<{
            src: z.ZodURL;
            mimeType: z.ZodOptional<z.ZodString>;
            sizes: z.ZodOptional<z.ZodArray<z.ZodString>>;
            theme: z.ZodOptional<z.ZodEnum<{
                light: "light";
                dark: "dark";
            }>>;
        }, z.core.$strict>>>;
        description: z.ZodOptional<z.ZodString>;
        inputSchema: z.ZodObject<{
            $schema: z.ZodOptional<z.ZodString>;
            type: z.ZodLiteral<"object">;
            properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodJSONSchema>>>;
            required: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>;
        execution: z.ZodOptional<z.ZodObject<{
            taskSupport: z.ZodOptional<z.ZodEnum<{
                optional: "optional";
                required: "required";
                forbidden: "forbidden";
            }>>;
        }, z.core.$strict>>;
        outputSchema: z.ZodOptional<z.ZodObject<{
            $schema: z.ZodOptional<z.ZodString>;
            type: z.ZodLiteral<"object">;
            properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodJSONSchema>>>;
            required: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>>;
        annotations: z.ZodOptional<z.ZodObject<{
            title: z.ZodOptional<z.ZodString>;
            readOnlyHint: z.ZodOptional<z.ZodBoolean>;
            destructiveHint: z.ZodOptional<z.ZodBoolean>;
            idempotentHint: z.ZodOptional<z.ZodBoolean>;
            openWorldHint: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>>;
    }, z.core.$strict>>>;
    toolChoice: z.ZodOptional<z.ZodObject<{
        mode: z.ZodOptional<z.ZodEnum<{
            required: "required";
            auto: "auto";
            none: "none";
        }>>;
    }, z.core.$strict>>;
    responseFormat: z.ZodOptional<z.ZodObject<{
        type: z.ZodLiteral<"text">;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const LLMStructuredGenerateParamsSchema: z.ZodObject<{
    messages: z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<{
            user: "user";
            assistant: "assistant";
        }>;
        content: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_use">;
            id: z.ZodString;
            name: z.ZodString;
            input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_result">;
            toolUseId: z.ZodString;
            content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodBase64;
                mimeType: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>], "type">>;
            structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
            isError: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>], "type">, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_use">;
            id: z.ZodString;
            name: z.ZodString;
            input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_result">;
            toolUseId: z.ZodString;
            content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodBase64;
                mimeType: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>], "type">>;
            structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
            isError: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>], "type">>]>;
    }, z.core.$strict>>;
    systemPrompt: z.ZodOptional<z.ZodString>;
    temperature: z.ZodOptional<z.ZodNumber>;
    stopSequences: z.ZodOptional<z.ZodArray<z.ZodString>>;
    responseFormat: z.ZodObject<{
        type: z.ZodLiteral<"json_schema">;
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        schema: z.ZodJSONSchema;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const LLMGenerateParamsSchema: z.ZodUnion<readonly [z.ZodObject<{
    messages: z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<{
            user: "user";
            assistant: "assistant";
        }>;
        content: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_use">;
            id: z.ZodString;
            name: z.ZodString;
            input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_result">;
            toolUseId: z.ZodString;
            content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodBase64;
                mimeType: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>], "type">>;
            structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
            isError: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>], "type">, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_use">;
            id: z.ZodString;
            name: z.ZodString;
            input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_result">;
            toolUseId: z.ZodString;
            content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodBase64;
                mimeType: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>], "type">>;
            structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
            isError: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>], "type">>]>;
    }, z.core.$strict>>;
    systemPrompt: z.ZodOptional<z.ZodString>;
    temperature: z.ZodOptional<z.ZodNumber>;
    stopSequences: z.ZodOptional<z.ZodArray<z.ZodString>>;
    responseFormat: z.ZodObject<{
        type: z.ZodLiteral<"json_schema">;
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        schema: z.ZodJSONSchema;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    messages: z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<{
            user: "user";
            assistant: "assistant";
        }>;
        content: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_use">;
            id: z.ZodString;
            name: z.ZodString;
            input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_result">;
            toolUseId: z.ZodString;
            content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodBase64;
                mimeType: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>], "type">>;
            structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
            isError: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>], "type">, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_use">;
            id: z.ZodString;
            name: z.ZodString;
            input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"tool_result">;
            toolUseId: z.ZodString;
            content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodBase64;
                mimeType: z.ZodString;
                annotations: z.ZodOptional<z.ZodObject<{
                    audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>>>;
                    priority: z.ZodOptional<z.ZodNumber>;
                    lastModified: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>], "type">>;
            structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
            isError: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>], "type">>]>;
    }, z.core.$strict>>;
    systemPrompt: z.ZodOptional<z.ZodString>;
    temperature: z.ZodOptional<z.ZodNumber>;
    stopSequences: z.ZodOptional<z.ZodArray<z.ZodString>>;
    tools: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        icons: z.ZodOptional<z.ZodArray<z.ZodObject<{
            src: z.ZodURL;
            mimeType: z.ZodOptional<z.ZodString>;
            sizes: z.ZodOptional<z.ZodArray<z.ZodString>>;
            theme: z.ZodOptional<z.ZodEnum<{
                light: "light";
                dark: "dark";
            }>>;
        }, z.core.$strict>>>;
        description: z.ZodOptional<z.ZodString>;
        inputSchema: z.ZodObject<{
            $schema: z.ZodOptional<z.ZodString>;
            type: z.ZodLiteral<"object">;
            properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodJSONSchema>>>;
            required: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>;
        execution: z.ZodOptional<z.ZodObject<{
            taskSupport: z.ZodOptional<z.ZodEnum<{
                optional: "optional";
                required: "required";
                forbidden: "forbidden";
            }>>;
        }, z.core.$strict>>;
        outputSchema: z.ZodOptional<z.ZodObject<{
            $schema: z.ZodOptional<z.ZodString>;
            type: z.ZodLiteral<"object">;
            properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodJSONSchema>>>;
            required: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>>;
        annotations: z.ZodOptional<z.ZodObject<{
            title: z.ZodOptional<z.ZodString>;
            readOnlyHint: z.ZodOptional<z.ZodBoolean>;
            destructiveHint: z.ZodOptional<z.ZodBoolean>;
            idempotentHint: z.ZodOptional<z.ZodBoolean>;
            openWorldHint: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>>;
    }, z.core.$strict>>>;
    toolChoice: z.ZodOptional<z.ZodObject<{
        mode: z.ZodOptional<z.ZodEnum<{
            required: "required";
            auto: "auto";
            none: "none";
        }>>;
    }, z.core.$strict>>;
    responseFormat: z.ZodOptional<z.ZodObject<{
        type: z.ZodLiteral<"text">;
    }, z.core.$strict>>;
}, z.core.$strict>]>;
export declare const LLMUsageSchema: z.ZodObject<{
    inputTokens: z.ZodNumber;
    outputTokens: z.ZodNumber;
    totalTokens: z.ZodNumber;
    reasoningTokens: z.ZodOptional<z.ZodNumber>;
    cachedInputTokens: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const LLMMessageGenerateResultSchema: z.ZodObject<{
    role: z.ZodEnum<{
        user: "user";
        assistant: "assistant";
    }>;
    content: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodBase64;
        mimeType: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_use">;
        id: z.ZodString;
        name: z.ZodString;
        input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_result">;
        toolUseId: z.ZodString;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>], "type">>;
        structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
        isError: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>], "type">, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodBase64;
        mimeType: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_use">;
        id: z.ZodString;
        name: z.ZodString;
        input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_result">;
        toolUseId: z.ZodString;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>], "type">>;
        structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
        isError: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>], "type">>]>;
    stopReason: z.ZodOptional<z.ZodString>;
    usage: z.ZodOptional<z.ZodObject<{
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        totalTokens: z.ZodNumber;
        reasoningTokens: z.ZodOptional<z.ZodNumber>;
        cachedInputTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    outputFormat: z.ZodLiteral<"text">;
}, z.core.$catchall<z.ZodJSONSchema>>;
export declare const LLMStructuredGenerateResultSchema: z.ZodObject<{
    role: z.ZodEnum<{
        user: "user";
        assistant: "assistant";
    }>;
    content: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodBase64;
        mimeType: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_use">;
        id: z.ZodString;
        name: z.ZodString;
        input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_result">;
        toolUseId: z.ZodString;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>], "type">>;
        structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
        isError: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>], "type">, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodBase64;
        mimeType: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_use">;
        id: z.ZodString;
        name: z.ZodString;
        input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_result">;
        toolUseId: z.ZodString;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>], "type">>;
        structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
        isError: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>], "type">>]>;
    stopReason: z.ZodOptional<z.ZodString>;
    usage: z.ZodOptional<z.ZodObject<{
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        totalTokens: z.ZodNumber;
        reasoningTokens: z.ZodOptional<z.ZodNumber>;
        cachedInputTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    outputFormat: z.ZodLiteral<"json_schema">;
    structuredContent: z.ZodJSONSchema;
}, z.core.$catchall<z.ZodJSONSchema>>;
export declare const LLMGenerateResultSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    role: z.ZodEnum<{
        user: "user";
        assistant: "assistant";
    }>;
    content: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodBase64;
        mimeType: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_use">;
        id: z.ZodString;
        name: z.ZodString;
        input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_result">;
        toolUseId: z.ZodString;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>], "type">>;
        structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
        isError: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>], "type">, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodBase64;
        mimeType: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_use">;
        id: z.ZodString;
        name: z.ZodString;
        input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_result">;
        toolUseId: z.ZodString;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>], "type">>;
        structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
        isError: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>], "type">>]>;
    stopReason: z.ZodOptional<z.ZodString>;
    usage: z.ZodOptional<z.ZodObject<{
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        totalTokens: z.ZodNumber;
        reasoningTokens: z.ZodOptional<z.ZodNumber>;
        cachedInputTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    outputFormat: z.ZodLiteral<"text">;
}, z.core.$catchall<z.ZodJSONSchema>>, z.ZodObject<{
    role: z.ZodEnum<{
        user: "user";
        assistant: "assistant";
    }>;
    content: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodBase64;
        mimeType: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_use">;
        id: z.ZodString;
        name: z.ZodString;
        input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_result">;
        toolUseId: z.ZodString;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>], "type">>;
        structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
        isError: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>], "type">, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodBase64;
        mimeType: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_use">;
        id: z.ZodString;
        name: z.ZodString;
        input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_result">;
        toolUseId: z.ZodString;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>], "type">>;
        structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
        isError: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>], "type">>]>;
    stopReason: z.ZodOptional<z.ZodString>;
    usage: z.ZodOptional<z.ZodObject<{
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        totalTokens: z.ZodNumber;
        reasoningTokens: z.ZodOptional<z.ZodNumber>;
        cachedInputTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    outputFormat: z.ZodLiteral<"json_schema">;
    structuredContent: z.ZodJSONSchema;
}, z.core.$catchall<z.ZodJSONSchema>>], "outputFormat">;
/**
 * Builds the result validator for a particular llm.generate request.
 *
 * Prefer the original in-memory Zod schema. When only the wire JSON Schema is
 * available, Zod can recreate an equivalent validator.
 */
export declare function createLLMGenerateResultSchema(params: z.output<typeof LLMGenerateParamsSchema>, originalStructuredContentSchema?: z.ZodType): z.ZodObject<{
    role: z.ZodEnum<{
        user: "user";
        assistant: "assistant";
    }>;
    content: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodBase64;
        mimeType: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_use">;
        id: z.ZodString;
        name: z.ZodString;
        input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_result">;
        toolUseId: z.ZodString;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>], "type">>;
        structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
        isError: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>], "type">, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodBase64;
        mimeType: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_use">;
        id: z.ZodString;
        name: z.ZodString;
        input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_result">;
        toolUseId: z.ZodString;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>], "type">>;
        structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
        isError: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>], "type">>]>;
    stopReason: z.ZodOptional<z.ZodString>;
    usage: z.ZodOptional<z.ZodObject<{
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        totalTokens: z.ZodNumber;
        reasoningTokens: z.ZodOptional<z.ZodNumber>;
        cachedInputTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    outputFormat: z.ZodLiteral<"text">;
}, z.core.$catchall<z.ZodJSONSchema>> | z.ZodObject<{
    role: z.ZodEnum<{
        user: "user";
        assistant: "assistant";
    }>;
    content: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodBase64;
        mimeType: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_use">;
        id: z.ZodString;
        name: z.ZodString;
        input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_result">;
        toolUseId: z.ZodString;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>], "type">>;
        structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
        isError: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>], "type">, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodBase64;
        mimeType: z.ZodString;
        annotations: z.ZodOptional<z.ZodObject<{
            audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                user: "user";
                assistant: "assistant";
            }>>>;
            priority: z.ZodOptional<z.ZodNumber>;
            lastModified: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_use">;
        id: z.ZodString;
        name: z.ZodString;
        input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"tool_result">;
        toolUseId: z.ZodString;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodBase64;
            mimeType: z.ZodString;
            annotations: z.ZodOptional<z.ZodObject<{
                audience: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>>>;
                priority: z.ZodOptional<z.ZodNumber>;
                lastModified: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>], "type">>;
        structuredContent: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
        isError: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>], "type">>]>;
    stopReason: z.ZodOptional<z.ZodString>;
    usage: z.ZodOptional<z.ZodObject<{
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        totalTokens: z.ZodNumber;
        reasoningTokens: z.ZodOptional<z.ZodNumber>;
        cachedInputTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    outputFormat: z.ZodLiteral<"json_schema">;
    structuredContent: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
}, z.core.$catchall<z.ZodJSONSchema>>;
export declare const VariablePrimitiveSchema: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
export declare const VariableValueSchema: z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>, z.ZodObject<{
    value: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
    description: z.ZodOptional<z.ZodString>;
}, z.core.$strict>]>;
export declare const VariablesSchema: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>, z.ZodObject<{
    value: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
    description: z.ZodOptional<z.ZodString>;
}, z.core.$strict>]>>;
export declare const LocatorCoordinatesSchema: z.ZodObject<{
    x: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    y: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    top: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    left: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    bottom: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    right: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, z.core.$strict>;
declare const PageLocatorKnownSchema: z.ZodObject<{
    pageIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    title: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    active: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    targetId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    tabId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    frameId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const PageLocatorSchema: typeof PageLocatorKnownSchema;
export declare const LocatorSchema: z.ZodObject<{
    pageIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    title: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    active: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    targetId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    tabId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    frameId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    idx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    frameIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    xpath: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    css: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    reactElementName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    coordinates: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        x: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        y: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        top: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        left: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        bottom: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        right: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strict>>>;
    snapshotId: z.ZodOptional<z.ZodNullable<z.ZodUUID>>;
    elementId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const StagehandMetricsSchema: z.ZodObject<{
    actPromptTokens: z.ZodNumber;
    actCompletionTokens: z.ZodNumber;
    actReasoningTokens: z.ZodNumber;
    actCachedInputTokens: z.ZodNumber;
    actInferenceTimeMs: z.ZodNumber;
    extractPromptTokens: z.ZodNumber;
    extractCompletionTokens: z.ZodNumber;
    extractReasoningTokens: z.ZodNumber;
    extractCachedInputTokens: z.ZodNumber;
    extractInferenceTimeMs: z.ZodNumber;
    observePromptTokens: z.ZodNumber;
    observeCompletionTokens: z.ZodNumber;
    observeReasoningTokens: z.ZodNumber;
    observeCachedInputTokens: z.ZodNumber;
    observeInferenceTimeMs: z.ZodNumber;
    totalPromptTokens: z.ZodNumber;
    totalCompletionTokens: z.ZodNumber;
    totalReasoningTokens: z.ZodNumber;
    totalCachedInputTokens: z.ZodNumber;
    totalInferenceTimeMs: z.ZodNumber;
}, z.core.$strict>;
/** Server-side caching configuration: a boolean toggle, or an object enabling
 * caching with an optional hit-count threshold (how many identical results
 * must be seen before the cache serves a hit; overrides the project's
 * configured threshold). */
export declare const CachingSchema: z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
    threshold: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>]>;
/** Detailed model configuration object */
export declare const GoogleServiceAccountCredentialsSchema: z.ZodObject<{
    type: z.ZodOptional<z.ZodLiteral<"service_account">>;
    projectId: z.ZodOptional<z.ZodString>;
    privateKeyId: z.ZodOptional<z.ZodString>;
    privateKey: z.ZodString;
    clientEmail: z.ZodString;
    clientId: z.ZodOptional<z.ZodString>;
    authUri: z.ZodOptional<z.ZodURL>;
    tokenUri: z.ZodOptional<z.ZodURL>;
    authProviderX509CertUrl: z.ZodOptional<z.ZodURL>;
    clientX509CertUrl: z.ZodOptional<z.ZodURL>;
    universeDomain: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const GoogleServiceAccountAuthSchema: z.ZodObject<{
    type: z.ZodLiteral<"googleServiceAccount">;
    credentials: z.ZodObject<{
        type: z.ZodOptional<z.ZodLiteral<"service_account">>;
        projectId: z.ZodOptional<z.ZodString>;
        privateKeyId: z.ZodOptional<z.ZodString>;
        privateKey: z.ZodString;
        clientEmail: z.ZodString;
        clientId: z.ZodOptional<z.ZodString>;
        authUri: z.ZodOptional<z.ZodURL>;
        tokenUri: z.ZodOptional<z.ZodURL>;
        authProviderX509CertUrl: z.ZodOptional<z.ZodURL>;
        clientX509CertUrl: z.ZodOptional<z.ZodURL>;
        universeDomain: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    scopes: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    projectId: z.ZodOptional<z.ZodString>;
    universeDomain: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const AzureEntraIdAuthSchema: z.ZodObject<{
    type: z.ZodLiteral<"azureEntraId">;
    token: z.ZodString;
}, z.core.$strict>;
export declare const VertexProviderOptionsSchema: z.ZodObject<{
    project: z.ZodString;
    location: z.ZodString;
    baseURL: z.ZodOptional<z.ZodURL>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strict>;
export declare const AzureProviderOptionsSchema: z.ZodObject<{
    resourceName: z.ZodOptional<z.ZodString>;
    baseURL: z.ZodOptional<z.ZodURL>;
    apiVersion: z.ZodOptional<z.ZodString>;
    useDeploymentBasedUrls: z.ZodOptional<z.ZodBoolean>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strict>;
export declare const VertexModelProviderOptionsSchema: z.ZodObject<{
    type: z.ZodLiteral<"vertex">;
    options: z.ZodObject<{
        project: z.ZodString;
        location: z.ZodString;
        baseURL: z.ZodOptional<z.ZodURL>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const AzureModelProviderOptionsSchema: z.ZodObject<{
    type: z.ZodLiteral<"azure">;
    options: z.ZodObject<{
        resourceName: z.ZodOptional<z.ZodString>;
        baseURL: z.ZodOptional<z.ZodURL>;
        apiVersion: z.ZodOptional<z.ZodString>;
        useDeploymentBasedUrls: z.ZodOptional<z.ZodBoolean>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const KnownModelConfigSchema: z.ZodObject<{
    apiKey: z.ZodOptional<z.ZodString>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    modelName: z.ZodUnion<readonly [z.ZodTemplateLiteral<"openai/gpt-4.1" | "openai/gpt-4.1-2025-04-14" | "openai/gpt-4.1-mini" | "openai/gpt-4.1-mini-2025-04-14" | "openai/gpt-4.1-nano" | "openai/gpt-4.1-nano-2025-04-14" | "openai/gpt-4o" | "openai/gpt-4o-2024-05-13" | "openai/gpt-4o-2024-08-06" | "openai/gpt-4o-2024-11-20" | "openai/gpt-4o-audio-preview" | "openai/gpt-4o-audio-preview-2024-12-17" | "openai/gpt-4o-search-preview" | "openai/gpt-4o-search-preview-2025-03-11" | "openai/gpt-4o-mini-search-preview" | "openai/gpt-4o-mini-search-preview-2025-03-11" | "openai/gpt-4o-mini" | "openai/gpt-4o-mini-2024-07-18" | "openai/gpt-3.5-turbo-0125" | "openai/gpt-3.5-turbo" | "openai/gpt-3.5-turbo-1106" | "openai/gpt-5-chat-latest" | "openai/o1" | "openai/o1-2024-12-17" | "openai/o3" | "openai/o3-2025-04-16" | "openai/o3-mini" | "openai/o3-mini-2025-01-31" | "openai/o4-mini" | "openai/o4-mini-2025-04-16" | "openai/gpt-5" | "openai/gpt-5-2025-08-07" | "openai/gpt-5-codex" | "openai/gpt-5-mini" | "openai/gpt-5-mini-2025-08-07" | "openai/gpt-5-nano" | "openai/gpt-5-nano-2025-08-07" | "openai/gpt-5-pro" | "openai/gpt-5-pro-2025-10-06" | "openai/gpt-5.1" | "openai/gpt-5.1-chat-latest" | "openai/gpt-5.1-codex-mini" | "openai/gpt-5.1-codex" | "openai/gpt-5.1-codex-max" | "openai/gpt-5.2" | "openai/gpt-5.2-chat-latest" | "openai/gpt-5.2-pro" | "openai/gpt-5.2-codex" | "openai/gpt-5.3-chat-latest" | "openai/gpt-5.3-codex" | "openai/gpt-5.4" | "openai/gpt-5.4-2026-03-05" | "openai/gpt-5.4-mini" | "openai/gpt-5.4-mini-2026-03-17" | "openai/gpt-5.4-nano" | "openai/gpt-5.4-nano-2026-03-17" | "openai/gpt-5.4-pro" | "openai/gpt-5.4-pro-2026-03-05" | "openai/gpt-5.5" | "openai/gpt-5.5-2026-04-23" | "openai/gpt-5.6" | "openai/gpt-5.6-luna" | "openai/gpt-5.6-sol" | "openai/gpt-5.6-terra">, z.ZodTemplateLiteral<"anthropic/claude-3-haiku-20240307" | "anthropic/claude-haiku-4-5-20251001" | "anthropic/claude-haiku-4-5" | "anthropic/claude-opus-4-0" | "anthropic/claude-opus-4-20250514" | "anthropic/claude-opus-4-1-20250805" | "anthropic/claude-opus-4-1" | "anthropic/claude-opus-4-5" | "anthropic/claude-opus-4-5-20251101" | "anthropic/claude-sonnet-4-0" | "anthropic/claude-sonnet-4-20250514" | "anthropic/claude-sonnet-4-5-20250929" | "anthropic/claude-sonnet-4-5" | "anthropic/claude-sonnet-4-6" | "anthropic/claude-opus-4-6" | "anthropic/claude-opus-4-7" | "anthropic/claude-opus-4-8" | "anthropic/claude-fable-5" | "anthropic/claude-sonnet-5">, z.ZodTemplateLiteral<"google/gemini-2.0-flash" | "google/gemini-2.0-flash-001" | "google/gemini-2.0-flash-lite" | "google/gemini-2.0-flash-lite-001" | "google/gemini-2.5-pro" | "google/gemini-2.5-flash" | "google/gemini-2.5-flash-image" | "google/gemini-2.5-flash-lite" | "google/gemini-2.5-flash-preview-tts" | "google/gemini-2.5-pro-preview-tts" | "google/gemini-2.5-flash-native-audio-latest" | "google/gemini-2.5-flash-native-audio-preview-09-2025" | "google/gemini-2.5-flash-native-audio-preview-12-2025" | "google/gemini-2.5-computer-use-preview-10-2025" | "google/gemini-3-pro-preview" | "google/gemini-3-pro-image-preview" | "google/gemini-3-flash-preview" | "google/gemini-3.1-pro-preview" | "google/gemini-3.1-pro-preview-customtools" | "google/gemini-3.1-flash-image-preview" | "google/gemini-3.1-flash-lite-preview" | "google/gemini-3.1-flash-tts-preview" | "google/gemini-3.5-flash" | "google/gemini-pro-latest" | "google/gemini-flash-latest" | "google/gemini-flash-lite-latest" | "google/deep-research-pro-preview-12-2025" | "google/deep-research-max-preview-04-2026" | "google/deep-research-preview-04-2026" | "google/nano-banana-pro-preview" | "google/aqa" | "google/gemini-robotics-er-1.5-preview" | "google/gemma-3-1b-it" | "google/gemma-3-4b-it" | "google/gemma-3n-e4b-it" | "google/gemma-3n-e2b-it" | "google/gemma-3-12b-it" | "google/gemma-3-27b-it">, z.ZodTemplateLiteral<"groq/gemma2-9b-it" | "groq/llama-3.1-8b-instant" | "groq/llama-3.3-70b-versatile" | "groq/meta-llama/llama-guard-4-12b" | "groq/openai/gpt-oss-120b" | "groq/openai/gpt-oss-20b" | "groq/deepseek-r1-distill-llama-70b" | "groq/meta-llama/llama-4-maverick-17b-128e-instruct" | "groq/meta-llama/llama-4-scout-17b-16e-instruct" | "groq/meta-llama/llama-prompt-guard-2-22m" | "groq/meta-llama/llama-prompt-guard-2-86m" | "groq/moonshotai/kimi-k2-instruct-0905" | "groq/qwen/qwen3-32b" | "groq/llama-guard-3-8b" | "groq/llama3-70b-8192" | "groq/llama3-8b-8192" | "groq/mixtral-8x7b-32768" | "groq/qwen-qwq-32b" | "groq/qwen-2.5-32b" | "groq/deepseek-r1-distill-qwen-32b">, z.ZodTemplateLiteral<"cerebras/llama3.1-8b" | "cerebras/gpt-oss-120b" | "cerebras/qwen-3-235b-a22b-instruct-2507" | "cerebras/qwen-3-235b-a22b-thinking-2507" | "cerebras/zai-glm-4.6" | "cerebras/zai-glm-4.7">]>;
}, z.core.$strict>;
export declare const CustomModelConfigSchema: z.ZodObject<{
    apiKey: z.ZodOptional<z.ZodString>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    modelName: z.ZodString;
    baseURL: z.ZodURL;
}, z.core.$strict>;
export declare const ModelConfigSchema: z.ZodUnion<readonly [z.ZodObject<{
    apiKey: z.ZodOptional<z.ZodString>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    modelName: z.ZodUnion<readonly [z.ZodTemplateLiteral<"openai/gpt-4.1" | "openai/gpt-4.1-2025-04-14" | "openai/gpt-4.1-mini" | "openai/gpt-4.1-mini-2025-04-14" | "openai/gpt-4.1-nano" | "openai/gpt-4.1-nano-2025-04-14" | "openai/gpt-4o" | "openai/gpt-4o-2024-05-13" | "openai/gpt-4o-2024-08-06" | "openai/gpt-4o-2024-11-20" | "openai/gpt-4o-audio-preview" | "openai/gpt-4o-audio-preview-2024-12-17" | "openai/gpt-4o-search-preview" | "openai/gpt-4o-search-preview-2025-03-11" | "openai/gpt-4o-mini-search-preview" | "openai/gpt-4o-mini-search-preview-2025-03-11" | "openai/gpt-4o-mini" | "openai/gpt-4o-mini-2024-07-18" | "openai/gpt-3.5-turbo-0125" | "openai/gpt-3.5-turbo" | "openai/gpt-3.5-turbo-1106" | "openai/gpt-5-chat-latest" | "openai/o1" | "openai/o1-2024-12-17" | "openai/o3" | "openai/o3-2025-04-16" | "openai/o3-mini" | "openai/o3-mini-2025-01-31" | "openai/o4-mini" | "openai/o4-mini-2025-04-16" | "openai/gpt-5" | "openai/gpt-5-2025-08-07" | "openai/gpt-5-codex" | "openai/gpt-5-mini" | "openai/gpt-5-mini-2025-08-07" | "openai/gpt-5-nano" | "openai/gpt-5-nano-2025-08-07" | "openai/gpt-5-pro" | "openai/gpt-5-pro-2025-10-06" | "openai/gpt-5.1" | "openai/gpt-5.1-chat-latest" | "openai/gpt-5.1-codex-mini" | "openai/gpt-5.1-codex" | "openai/gpt-5.1-codex-max" | "openai/gpt-5.2" | "openai/gpt-5.2-chat-latest" | "openai/gpt-5.2-pro" | "openai/gpt-5.2-codex" | "openai/gpt-5.3-chat-latest" | "openai/gpt-5.3-codex" | "openai/gpt-5.4" | "openai/gpt-5.4-2026-03-05" | "openai/gpt-5.4-mini" | "openai/gpt-5.4-mini-2026-03-17" | "openai/gpt-5.4-nano" | "openai/gpt-5.4-nano-2026-03-17" | "openai/gpt-5.4-pro" | "openai/gpt-5.4-pro-2026-03-05" | "openai/gpt-5.5" | "openai/gpt-5.5-2026-04-23" | "openai/gpt-5.6" | "openai/gpt-5.6-luna" | "openai/gpt-5.6-sol" | "openai/gpt-5.6-terra">, z.ZodTemplateLiteral<"anthropic/claude-3-haiku-20240307" | "anthropic/claude-haiku-4-5-20251001" | "anthropic/claude-haiku-4-5" | "anthropic/claude-opus-4-0" | "anthropic/claude-opus-4-20250514" | "anthropic/claude-opus-4-1-20250805" | "anthropic/claude-opus-4-1" | "anthropic/claude-opus-4-5" | "anthropic/claude-opus-4-5-20251101" | "anthropic/claude-sonnet-4-0" | "anthropic/claude-sonnet-4-20250514" | "anthropic/claude-sonnet-4-5-20250929" | "anthropic/claude-sonnet-4-5" | "anthropic/claude-sonnet-4-6" | "anthropic/claude-opus-4-6" | "anthropic/claude-opus-4-7" | "anthropic/claude-opus-4-8" | "anthropic/claude-fable-5" | "anthropic/claude-sonnet-5">, z.ZodTemplateLiteral<"google/gemini-2.0-flash" | "google/gemini-2.0-flash-001" | "google/gemini-2.0-flash-lite" | "google/gemini-2.0-flash-lite-001" | "google/gemini-2.5-pro" | "google/gemini-2.5-flash" | "google/gemini-2.5-flash-image" | "google/gemini-2.5-flash-lite" | "google/gemini-2.5-flash-preview-tts" | "google/gemini-2.5-pro-preview-tts" | "google/gemini-2.5-flash-native-audio-latest" | "google/gemini-2.5-flash-native-audio-preview-09-2025" | "google/gemini-2.5-flash-native-audio-preview-12-2025" | "google/gemini-2.5-computer-use-preview-10-2025" | "google/gemini-3-pro-preview" | "google/gemini-3-pro-image-preview" | "google/gemini-3-flash-preview" | "google/gemini-3.1-pro-preview" | "google/gemini-3.1-pro-preview-customtools" | "google/gemini-3.1-flash-image-preview" | "google/gemini-3.1-flash-lite-preview" | "google/gemini-3.1-flash-tts-preview" | "google/gemini-3.5-flash" | "google/gemini-pro-latest" | "google/gemini-flash-latest" | "google/gemini-flash-lite-latest" | "google/deep-research-pro-preview-12-2025" | "google/deep-research-max-preview-04-2026" | "google/deep-research-preview-04-2026" | "google/nano-banana-pro-preview" | "google/aqa" | "google/gemini-robotics-er-1.5-preview" | "google/gemma-3-1b-it" | "google/gemma-3-4b-it" | "google/gemma-3n-e4b-it" | "google/gemma-3n-e2b-it" | "google/gemma-3-12b-it" | "google/gemma-3-27b-it">, z.ZodTemplateLiteral<"groq/gemma2-9b-it" | "groq/llama-3.1-8b-instant" | "groq/llama-3.3-70b-versatile" | "groq/meta-llama/llama-guard-4-12b" | "groq/openai/gpt-oss-120b" | "groq/openai/gpt-oss-20b" | "groq/deepseek-r1-distill-llama-70b" | "groq/meta-llama/llama-4-maverick-17b-128e-instruct" | "groq/meta-llama/llama-4-scout-17b-16e-instruct" | "groq/meta-llama/llama-prompt-guard-2-22m" | "groq/meta-llama/llama-prompt-guard-2-86m" | "groq/moonshotai/kimi-k2-instruct-0905" | "groq/qwen/qwen3-32b" | "groq/llama-guard-3-8b" | "groq/llama3-70b-8192" | "groq/llama3-8b-8192" | "groq/mixtral-8x7b-32768" | "groq/qwen-qwq-32b" | "groq/qwen-2.5-32b" | "groq/deepseek-r1-distill-qwen-32b">, z.ZodTemplateLiteral<"cerebras/llama3.1-8b" | "cerebras/gpt-oss-120b" | "cerebras/qwen-3-235b-a22b-instruct-2507" | "cerebras/qwen-3-235b-a22b-thinking-2507" | "cerebras/zai-glm-4.6" | "cerebras/zai-glm-4.7">]>;
}, z.core.$strict>, z.ZodObject<{
    apiKey: z.ZodOptional<z.ZodString>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    modelName: z.ZodString;
    baseURL: z.ZodURL;
}, z.core.$strict>]>;
/** Serializable reference to an LLM implemented by the connected Stagehand client. */
export declare const ClientModelReferenceSchema: z.ZodObject<{
    source: z.ZodLiteral<"client">;
}, z.core.$strict>;
/** Browserbase viewport configuration. */
export declare const BrowserbaseViewportSchema: z.ZodObject<{
    width: z.ZodOptional<z.ZodNumber>;
    height: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
/** Browserbase fingerprint screen configuration. */
export declare const BrowserbaseFingerprintScreenSchema: z.ZodObject<{
    maxHeight: z.ZodOptional<z.ZodNumber>;
    maxWidth: z.ZodOptional<z.ZodNumber>;
    minHeight: z.ZodOptional<z.ZodNumber>;
    minWidth: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
/** Browserbase fingerprint configuration for stealth mode. */
export declare const BrowserbaseFingerprintSchema: z.ZodObject<{
    browsers: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        chrome: "chrome";
        edge: "edge";
        firefox: "firefox";
        safari: "safari";
    }>>>;
    devices: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        desktop: "desktop";
        mobile: "mobile";
    }>>>;
    httpVersion: z.ZodOptional<z.ZodEnum<{
        1: "1";
        2: "2";
    }>>;
    locales: z.ZodOptional<z.ZodArray<z.ZodString>>;
    operatingSystems: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        android: "android";
        ios: "ios";
        linux: "linux";
        macos: "macos";
        windows: "windows";
    }>>>;
    screen: z.ZodOptional<z.ZodObject<{
        maxHeight: z.ZodOptional<z.ZodNumber>;
        maxWidth: z.ZodOptional<z.ZodNumber>;
        minHeight: z.ZodOptional<z.ZodNumber>;
        minWidth: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** Browserbase context configuration for session persistence. */
export declare const BrowserbaseContextSchema: z.ZodObject<{
    id: z.ZodString;
    persist: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
/** Browserbase browser settings for session creation. */
export declare const BrowserbaseBrowserSettingsSchema: z.ZodObject<{
    advancedStealth: z.ZodOptional<z.ZodBoolean>;
    blockAds: z.ZodOptional<z.ZodBoolean>;
    captchaImageSelector: z.ZodOptional<z.ZodString>;
    captchaInputSelector: z.ZodOptional<z.ZodString>;
    context: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        persist: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    extensionId: z.ZodOptional<z.ZodString>;
    fingerprint: z.ZodOptional<z.ZodObject<{
        browsers: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            chrome: "chrome";
            edge: "edge";
            firefox: "firefox";
            safari: "safari";
        }>>>;
        devices: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            desktop: "desktop";
            mobile: "mobile";
        }>>>;
        httpVersion: z.ZodOptional<z.ZodEnum<{
            1: "1";
            2: "2";
        }>>;
        locales: z.ZodOptional<z.ZodArray<z.ZodString>>;
        operatingSystems: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            android: "android";
            ios: "ios";
            linux: "linux";
            macos: "macos";
            windows: "windows";
        }>>>;
        screen: z.ZodOptional<z.ZodObject<{
            maxHeight: z.ZodOptional<z.ZodNumber>;
            maxWidth: z.ZodOptional<z.ZodNumber>;
            minHeight: z.ZodOptional<z.ZodNumber>;
            minWidth: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    logSession: z.ZodOptional<z.ZodBoolean>;
    os: z.ZodOptional<z.ZodEnum<{
        mobile: "mobile";
        linux: "linux";
        windows: "windows";
        mac: "mac";
        tablet: "tablet";
    }>>;
    recordSession: z.ZodOptional<z.ZodBoolean>;
    solveCaptchas: z.ZodOptional<z.ZodBoolean>;
    verified: z.ZodOptional<z.ZodBoolean>;
    viewport: z.ZodOptional<z.ZodObject<{
        width: z.ZodOptional<z.ZodNumber>;
        height: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** Browserbase managed proxy geolocation configuration. */
export declare const BrowserbaseProxyGeolocationSchema: z.ZodObject<{
    country: z.ZodString;
    city: z.ZodOptional<z.ZodString>;
    state: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** Browserbase managed proxy configuration. */
export declare const BrowserbaseProxyConfigSchema: z.ZodObject<{
    type: z.ZodLiteral<"browserbase">;
    domainPattern: z.ZodOptional<z.ZodString>;
    geolocation: z.ZodOptional<z.ZodObject<{
        country: z.ZodString;
        city: z.ZodOptional<z.ZodString>;
        state: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** External proxy configuration. */
export declare const ExternalProxyConfigSchema: z.ZodObject<{
    type: z.ZodLiteral<"external">;
    server: z.ZodString;
    domainPattern: z.ZodOptional<z.ZodString>;
    username: z.ZodOptional<z.ZodString>;
    password: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** Browserbase session proxy configuration. */
export declare const ProxyConfigSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"browserbase">;
    domainPattern: z.ZodOptional<z.ZodString>;
    geolocation: z.ZodOptional<z.ZodObject<{
        country: z.ZodString;
        city: z.ZodOptional<z.ZodString>;
        state: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"external">;
    server: z.ZodString;
    domainPattern: z.ZodOptional<z.ZodString>;
    username: z.ZodOptional<z.ZodString>;
    password: z.ZodOptional<z.ZodString>;
}, z.core.$strip>], "type">;
/** Browserbase region identifier for multi-region support. */
export declare const BrowserbaseRegionSchema: z.ZodEnum<{
    "us-west-2": "us-west-2";
    "us-east-1": "us-east-1";
    "eu-central-1": "eu-central-1";
    "ap-southeast-1": "ap-southeast-1";
}>;
/** Browserbase session creation parameters. */
export declare const BrowserbaseSessionCreateParamsSchema: z.ZodObject<{
    browserSettings: z.ZodOptional<z.ZodObject<{
        advancedStealth: z.ZodOptional<z.ZodBoolean>;
        blockAds: z.ZodOptional<z.ZodBoolean>;
        captchaImageSelector: z.ZodOptional<z.ZodString>;
        captchaInputSelector: z.ZodOptional<z.ZodString>;
        context: z.ZodOptional<z.ZodObject<{
            id: z.ZodString;
            persist: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
        extensionId: z.ZodOptional<z.ZodString>;
        fingerprint: z.ZodOptional<z.ZodObject<{
            browsers: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                chrome: "chrome";
                edge: "edge";
                firefox: "firefox";
                safari: "safari";
            }>>>;
            devices: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                desktop: "desktop";
                mobile: "mobile";
            }>>>;
            httpVersion: z.ZodOptional<z.ZodEnum<{
                1: "1";
                2: "2";
            }>>;
            locales: z.ZodOptional<z.ZodArray<z.ZodString>>;
            operatingSystems: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                android: "android";
                ios: "ios";
                linux: "linux";
                macos: "macos";
                windows: "windows";
            }>>>;
            screen: z.ZodOptional<z.ZodObject<{
                maxHeight: z.ZodOptional<z.ZodNumber>;
                maxWidth: z.ZodOptional<z.ZodNumber>;
                minHeight: z.ZodOptional<z.ZodNumber>;
                minWidth: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        logSession: z.ZodOptional<z.ZodBoolean>;
        os: z.ZodOptional<z.ZodEnum<{
            mobile: "mobile";
            linux: "linux";
            windows: "windows";
            mac: "mac";
            tablet: "tablet";
        }>>;
        recordSession: z.ZodOptional<z.ZodBoolean>;
        solveCaptchas: z.ZodOptional<z.ZodBoolean>;
        verified: z.ZodOptional<z.ZodBoolean>;
        viewport: z.ZodOptional<z.ZodObject<{
            width: z.ZodOptional<z.ZodNumber>;
            height: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    extensionId: z.ZodOptional<z.ZodString>;
    keepAlive: z.ZodOptional<z.ZodBoolean>;
    proxies: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"browserbase">;
        domainPattern: z.ZodOptional<z.ZodString>;
        geolocation: z.ZodOptional<z.ZodObject<{
            country: z.ZodString;
            city: z.ZodOptional<z.ZodString>;
            state: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"external">;
        server: z.ZodString;
        domainPattern: z.ZodOptional<z.ZodString>;
        username: z.ZodOptional<z.ZodString>;
        password: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "type">>]>>;
    region: z.ZodOptional<z.ZodEnum<{
        "us-west-2": "us-west-2";
        "us-east-1": "us-east-1";
        "eu-central-1": "eu-central-1";
        "ap-southeast-1": "ap-southeast-1";
    }>>;
    timeout: z.ZodOptional<z.ZodNumber>;
    userMetadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strict>;
/** Browserbase configuration available to both the SDK and the service worker. */
export declare const BrowserbaseBrowserSourceSchema: z.ZodObject<{
    browserSettings: z.ZodOptional<z.ZodObject<{
        advancedStealth: z.ZodOptional<z.ZodBoolean>;
        blockAds: z.ZodOptional<z.ZodBoolean>;
        captchaImageSelector: z.ZodOptional<z.ZodString>;
        captchaInputSelector: z.ZodOptional<z.ZodString>;
        context: z.ZodOptional<z.ZodObject<{
            id: z.ZodString;
            persist: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
        extensionId: z.ZodOptional<z.ZodString>;
        fingerprint: z.ZodOptional<z.ZodObject<{
            browsers: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                chrome: "chrome";
                edge: "edge";
                firefox: "firefox";
                safari: "safari";
            }>>>;
            devices: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                desktop: "desktop";
                mobile: "mobile";
            }>>>;
            httpVersion: z.ZodOptional<z.ZodEnum<{
                1: "1";
                2: "2";
            }>>;
            locales: z.ZodOptional<z.ZodArray<z.ZodString>>;
            operatingSystems: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                android: "android";
                ios: "ios";
                linux: "linux";
                macos: "macos";
                windows: "windows";
            }>>>;
            screen: z.ZodOptional<z.ZodObject<{
                maxHeight: z.ZodOptional<z.ZodNumber>;
                maxWidth: z.ZodOptional<z.ZodNumber>;
                minHeight: z.ZodOptional<z.ZodNumber>;
                minWidth: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        logSession: z.ZodOptional<z.ZodBoolean>;
        os: z.ZodOptional<z.ZodEnum<{
            mobile: "mobile";
            linux: "linux";
            windows: "windows";
            mac: "mac";
            tablet: "tablet";
        }>>;
        recordSession: z.ZodOptional<z.ZodBoolean>;
        solveCaptchas: z.ZodOptional<z.ZodBoolean>;
        verified: z.ZodOptional<z.ZodBoolean>;
        viewport: z.ZodOptional<z.ZodObject<{
            width: z.ZodOptional<z.ZodNumber>;
            height: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    extensionId: z.ZodOptional<z.ZodString>;
    keepAlive: z.ZodOptional<z.ZodBoolean>;
    proxies: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"browserbase">;
        domainPattern: z.ZodOptional<z.ZodString>;
        geolocation: z.ZodOptional<z.ZodObject<{
            country: z.ZodString;
            city: z.ZodOptional<z.ZodString>;
            state: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"external">;
        server: z.ZodString;
        domainPattern: z.ZodOptional<z.ZodString>;
        username: z.ZodOptional<z.ZodString>;
        password: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "type">>]>>;
    region: z.ZodOptional<z.ZodEnum<{
        "us-west-2": "us-west-2";
        "us-east-1": "us-east-1";
        "eu-central-1": "eu-central-1";
        "ap-southeast-1": "ap-southeast-1";
    }>>;
    timeout: z.ZodOptional<z.ZodNumber>;
    userMetadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    type: z.ZodLiteral<"browserbase">;
    sessionId: z.ZodString;
}, z.core.$strict>;
/** Action object returned by observe and used by act */
export declare const ActionSchema: z.ZodObject<{
    selector: z.ZodString;
    description: z.ZodString;
    method: z.ZodOptional<z.ZodString>;
    arguments: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export declare const ActOptionsSchema: z.ZodOptional<z.ZodObject<{
    model: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
        apiKey: z.ZodOptional<z.ZodString>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        modelName: z.ZodUnion<readonly [z.ZodTemplateLiteral<"openai/gpt-4.1" | "openai/gpt-4.1-2025-04-14" | "openai/gpt-4.1-mini" | "openai/gpt-4.1-mini-2025-04-14" | "openai/gpt-4.1-nano" | "openai/gpt-4.1-nano-2025-04-14" | "openai/gpt-4o" | "openai/gpt-4o-2024-05-13" | "openai/gpt-4o-2024-08-06" | "openai/gpt-4o-2024-11-20" | "openai/gpt-4o-audio-preview" | "openai/gpt-4o-audio-preview-2024-12-17" | "openai/gpt-4o-search-preview" | "openai/gpt-4o-search-preview-2025-03-11" | "openai/gpt-4o-mini-search-preview" | "openai/gpt-4o-mini-search-preview-2025-03-11" | "openai/gpt-4o-mini" | "openai/gpt-4o-mini-2024-07-18" | "openai/gpt-3.5-turbo-0125" | "openai/gpt-3.5-turbo" | "openai/gpt-3.5-turbo-1106" | "openai/gpt-5-chat-latest" | "openai/o1" | "openai/o1-2024-12-17" | "openai/o3" | "openai/o3-2025-04-16" | "openai/o3-mini" | "openai/o3-mini-2025-01-31" | "openai/o4-mini" | "openai/o4-mini-2025-04-16" | "openai/gpt-5" | "openai/gpt-5-2025-08-07" | "openai/gpt-5-codex" | "openai/gpt-5-mini" | "openai/gpt-5-mini-2025-08-07" | "openai/gpt-5-nano" | "openai/gpt-5-nano-2025-08-07" | "openai/gpt-5-pro" | "openai/gpt-5-pro-2025-10-06" | "openai/gpt-5.1" | "openai/gpt-5.1-chat-latest" | "openai/gpt-5.1-codex-mini" | "openai/gpt-5.1-codex" | "openai/gpt-5.1-codex-max" | "openai/gpt-5.2" | "openai/gpt-5.2-chat-latest" | "openai/gpt-5.2-pro" | "openai/gpt-5.2-codex" | "openai/gpt-5.3-chat-latest" | "openai/gpt-5.3-codex" | "openai/gpt-5.4" | "openai/gpt-5.4-2026-03-05" | "openai/gpt-5.4-mini" | "openai/gpt-5.4-mini-2026-03-17" | "openai/gpt-5.4-nano" | "openai/gpt-5.4-nano-2026-03-17" | "openai/gpt-5.4-pro" | "openai/gpt-5.4-pro-2026-03-05" | "openai/gpt-5.5" | "openai/gpt-5.5-2026-04-23" | "openai/gpt-5.6" | "openai/gpt-5.6-luna" | "openai/gpt-5.6-sol" | "openai/gpt-5.6-terra">, z.ZodTemplateLiteral<"anthropic/claude-3-haiku-20240307" | "anthropic/claude-haiku-4-5-20251001" | "anthropic/claude-haiku-4-5" | "anthropic/claude-opus-4-0" | "anthropic/claude-opus-4-20250514" | "anthropic/claude-opus-4-1-20250805" | "anthropic/claude-opus-4-1" | "anthropic/claude-opus-4-5" | "anthropic/claude-opus-4-5-20251101" | "anthropic/claude-sonnet-4-0" | "anthropic/claude-sonnet-4-20250514" | "anthropic/claude-sonnet-4-5-20250929" | "anthropic/claude-sonnet-4-5" | "anthropic/claude-sonnet-4-6" | "anthropic/claude-opus-4-6" | "anthropic/claude-opus-4-7" | "anthropic/claude-opus-4-8" | "anthropic/claude-fable-5" | "anthropic/claude-sonnet-5">, z.ZodTemplateLiteral<"google/gemini-2.0-flash" | "google/gemini-2.0-flash-001" | "google/gemini-2.0-flash-lite" | "google/gemini-2.0-flash-lite-001" | "google/gemini-2.5-pro" | "google/gemini-2.5-flash" | "google/gemini-2.5-flash-image" | "google/gemini-2.5-flash-lite" | "google/gemini-2.5-flash-preview-tts" | "google/gemini-2.5-pro-preview-tts" | "google/gemini-2.5-flash-native-audio-latest" | "google/gemini-2.5-flash-native-audio-preview-09-2025" | "google/gemini-2.5-flash-native-audio-preview-12-2025" | "google/gemini-2.5-computer-use-preview-10-2025" | "google/gemini-3-pro-preview" | "google/gemini-3-pro-image-preview" | "google/gemini-3-flash-preview" | "google/gemini-3.1-pro-preview" | "google/gemini-3.1-pro-preview-customtools" | "google/gemini-3.1-flash-image-preview" | "google/gemini-3.1-flash-lite-preview" | "google/gemini-3.1-flash-tts-preview" | "google/gemini-3.5-flash" | "google/gemini-pro-latest" | "google/gemini-flash-latest" | "google/gemini-flash-lite-latest" | "google/deep-research-pro-preview-12-2025" | "google/deep-research-max-preview-04-2026" | "google/deep-research-preview-04-2026" | "google/nano-banana-pro-preview" | "google/aqa" | "google/gemini-robotics-er-1.5-preview" | "google/gemma-3-1b-it" | "google/gemma-3-4b-it" | "google/gemma-3n-e4b-it" | "google/gemma-3n-e2b-it" | "google/gemma-3-12b-it" | "google/gemma-3-27b-it">, z.ZodTemplateLiteral<"groq/gemma2-9b-it" | "groq/llama-3.1-8b-instant" | "groq/llama-3.3-70b-versatile" | "groq/meta-llama/llama-guard-4-12b" | "groq/openai/gpt-oss-120b" | "groq/openai/gpt-oss-20b" | "groq/deepseek-r1-distill-llama-70b" | "groq/meta-llama/llama-4-maverick-17b-128e-instruct" | "groq/meta-llama/llama-4-scout-17b-16e-instruct" | "groq/meta-llama/llama-prompt-guard-2-22m" | "groq/meta-llama/llama-prompt-guard-2-86m" | "groq/moonshotai/kimi-k2-instruct-0905" | "groq/qwen/qwen3-32b" | "groq/llama-guard-3-8b" | "groq/llama3-70b-8192" | "groq/llama3-8b-8192" | "groq/mixtral-8x7b-32768" | "groq/qwen-qwq-32b" | "groq/qwen-2.5-32b" | "groq/deepseek-r1-distill-qwen-32b">, z.ZodTemplateLiteral<"cerebras/llama3.1-8b" | "cerebras/gpt-oss-120b" | "cerebras/qwen-3-235b-a22b-instruct-2507" | "cerebras/qwen-3-235b-a22b-thinking-2507" | "cerebras/zai-glm-4.6" | "cerebras/zai-glm-4.7">]>;
    }, z.core.$strict>, z.ZodObject<{
        apiKey: z.ZodOptional<z.ZodString>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        modelName: z.ZodString;
        baseURL: z.ZodURL;
    }, z.core.$strict>]>>;
    variables: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>, z.ZodObject<{
        value: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
        description: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>]>>>;
    timeout: z.ZodOptional<z.ZodNumber>;
    locator: z.ZodOptional<z.ZodObject<{
        pageIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        title: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        active: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        targetId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        tabId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        frameId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        idx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        frameIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        xpath: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        css: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        reactElementName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        coordinates: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            x: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            y: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            top: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            left: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            bottom: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            right: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        }, z.core.$strict>>>;
        snapshotId: z.ZodOptional<z.ZodNullable<z.ZodUUID>>;
        elementId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    cache: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
        threshold: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>]>>;
}, z.core.$strip>>;
/** Inner act result data */
export declare const ActResultDataSchema: z.ZodObject<{
    success: z.ZodBoolean;
    message: z.ZodString;
    actionDescription: z.ZodString;
    actions: z.ZodArray<z.ZodObject<{
        selector: z.ZodString;
        description: z.ZodString;
        method: z.ZodOptional<z.ZodString>;
        arguments: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const ActResultSchema: z.ZodObject<{
    result: z.ZodObject<{
        success: z.ZodBoolean;
        message: z.ZodString;
        actionDescription: z.ZodString;
        actions: z.ZodArray<z.ZodObject<{
            selector: z.ZodString;
            description: z.ZodString;
            method: z.ZodOptional<z.ZodString>;
            arguments: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    actionId: z.ZodOptional<z.ZodString>;
    cacheStatus: z.ZodOptional<z.ZodEnum<{
        HIT: "HIT";
        MISS: "MISS";
    }>>;
}, z.core.$strip>;
export declare const ExtractOptionsSchema: z.ZodOptional<z.ZodObject<{
    model: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
        apiKey: z.ZodOptional<z.ZodString>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        modelName: z.ZodUnion<readonly [z.ZodTemplateLiteral<"openai/gpt-4.1" | "openai/gpt-4.1-2025-04-14" | "openai/gpt-4.1-mini" | "openai/gpt-4.1-mini-2025-04-14" | "openai/gpt-4.1-nano" | "openai/gpt-4.1-nano-2025-04-14" | "openai/gpt-4o" | "openai/gpt-4o-2024-05-13" | "openai/gpt-4o-2024-08-06" | "openai/gpt-4o-2024-11-20" | "openai/gpt-4o-audio-preview" | "openai/gpt-4o-audio-preview-2024-12-17" | "openai/gpt-4o-search-preview" | "openai/gpt-4o-search-preview-2025-03-11" | "openai/gpt-4o-mini-search-preview" | "openai/gpt-4o-mini-search-preview-2025-03-11" | "openai/gpt-4o-mini" | "openai/gpt-4o-mini-2024-07-18" | "openai/gpt-3.5-turbo-0125" | "openai/gpt-3.5-turbo" | "openai/gpt-3.5-turbo-1106" | "openai/gpt-5-chat-latest" | "openai/o1" | "openai/o1-2024-12-17" | "openai/o3" | "openai/o3-2025-04-16" | "openai/o3-mini" | "openai/o3-mini-2025-01-31" | "openai/o4-mini" | "openai/o4-mini-2025-04-16" | "openai/gpt-5" | "openai/gpt-5-2025-08-07" | "openai/gpt-5-codex" | "openai/gpt-5-mini" | "openai/gpt-5-mini-2025-08-07" | "openai/gpt-5-nano" | "openai/gpt-5-nano-2025-08-07" | "openai/gpt-5-pro" | "openai/gpt-5-pro-2025-10-06" | "openai/gpt-5.1" | "openai/gpt-5.1-chat-latest" | "openai/gpt-5.1-codex-mini" | "openai/gpt-5.1-codex" | "openai/gpt-5.1-codex-max" | "openai/gpt-5.2" | "openai/gpt-5.2-chat-latest" | "openai/gpt-5.2-pro" | "openai/gpt-5.2-codex" | "openai/gpt-5.3-chat-latest" | "openai/gpt-5.3-codex" | "openai/gpt-5.4" | "openai/gpt-5.4-2026-03-05" | "openai/gpt-5.4-mini" | "openai/gpt-5.4-mini-2026-03-17" | "openai/gpt-5.4-nano" | "openai/gpt-5.4-nano-2026-03-17" | "openai/gpt-5.4-pro" | "openai/gpt-5.4-pro-2026-03-05" | "openai/gpt-5.5" | "openai/gpt-5.5-2026-04-23" | "openai/gpt-5.6" | "openai/gpt-5.6-luna" | "openai/gpt-5.6-sol" | "openai/gpt-5.6-terra">, z.ZodTemplateLiteral<"anthropic/claude-3-haiku-20240307" | "anthropic/claude-haiku-4-5-20251001" | "anthropic/claude-haiku-4-5" | "anthropic/claude-opus-4-0" | "anthropic/claude-opus-4-20250514" | "anthropic/claude-opus-4-1-20250805" | "anthropic/claude-opus-4-1" | "anthropic/claude-opus-4-5" | "anthropic/claude-opus-4-5-20251101" | "anthropic/claude-sonnet-4-0" | "anthropic/claude-sonnet-4-20250514" | "anthropic/claude-sonnet-4-5-20250929" | "anthropic/claude-sonnet-4-5" | "anthropic/claude-sonnet-4-6" | "anthropic/claude-opus-4-6" | "anthropic/claude-opus-4-7" | "anthropic/claude-opus-4-8" | "anthropic/claude-fable-5" | "anthropic/claude-sonnet-5">, z.ZodTemplateLiteral<"google/gemini-2.0-flash" | "google/gemini-2.0-flash-001" | "google/gemini-2.0-flash-lite" | "google/gemini-2.0-flash-lite-001" | "google/gemini-2.5-pro" | "google/gemini-2.5-flash" | "google/gemini-2.5-flash-image" | "google/gemini-2.5-flash-lite" | "google/gemini-2.5-flash-preview-tts" | "google/gemini-2.5-pro-preview-tts" | "google/gemini-2.5-flash-native-audio-latest" | "google/gemini-2.5-flash-native-audio-preview-09-2025" | "google/gemini-2.5-flash-native-audio-preview-12-2025" | "google/gemini-2.5-computer-use-preview-10-2025" | "google/gemini-3-pro-preview" | "google/gemini-3-pro-image-preview" | "google/gemini-3-flash-preview" | "google/gemini-3.1-pro-preview" | "google/gemini-3.1-pro-preview-customtools" | "google/gemini-3.1-flash-image-preview" | "google/gemini-3.1-flash-lite-preview" | "google/gemini-3.1-flash-tts-preview" | "google/gemini-3.5-flash" | "google/gemini-pro-latest" | "google/gemini-flash-latest" | "google/gemini-flash-lite-latest" | "google/deep-research-pro-preview-12-2025" | "google/deep-research-max-preview-04-2026" | "google/deep-research-preview-04-2026" | "google/nano-banana-pro-preview" | "google/aqa" | "google/gemini-robotics-er-1.5-preview" | "google/gemma-3-1b-it" | "google/gemma-3-4b-it" | "google/gemma-3n-e4b-it" | "google/gemma-3n-e2b-it" | "google/gemma-3-12b-it" | "google/gemma-3-27b-it">, z.ZodTemplateLiteral<"groq/gemma2-9b-it" | "groq/llama-3.1-8b-instant" | "groq/llama-3.3-70b-versatile" | "groq/meta-llama/llama-guard-4-12b" | "groq/openai/gpt-oss-120b" | "groq/openai/gpt-oss-20b" | "groq/deepseek-r1-distill-llama-70b" | "groq/meta-llama/llama-4-maverick-17b-128e-instruct" | "groq/meta-llama/llama-4-scout-17b-16e-instruct" | "groq/meta-llama/llama-prompt-guard-2-22m" | "groq/meta-llama/llama-prompt-guard-2-86m" | "groq/moonshotai/kimi-k2-instruct-0905" | "groq/qwen/qwen3-32b" | "groq/llama-guard-3-8b" | "groq/llama3-70b-8192" | "groq/llama3-8b-8192" | "groq/mixtral-8x7b-32768" | "groq/qwen-qwq-32b" | "groq/qwen-2.5-32b" | "groq/deepseek-r1-distill-qwen-32b">, z.ZodTemplateLiteral<"cerebras/llama3.1-8b" | "cerebras/gpt-oss-120b" | "cerebras/qwen-3-235b-a22b-instruct-2507" | "cerebras/qwen-3-235b-a22b-thinking-2507" | "cerebras/zai-glm-4.6" | "cerebras/zai-glm-4.7">]>;
    }, z.core.$strict>, z.ZodObject<{
        apiKey: z.ZodOptional<z.ZodString>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        modelName: z.ZodString;
        baseURL: z.ZodURL;
    }, z.core.$strict>]>>;
    timeout: z.ZodOptional<z.ZodNumber>;
    selector: z.ZodOptional<z.ZodString>;
    ignoreSelectors: z.ZodOptional<z.ZodArray<z.ZodString>>;
    screenshot: z.ZodOptional<z.ZodBoolean>;
    locator: z.ZodOptional<z.ZodObject<{
        pageIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        title: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        active: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        targetId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        tabId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        frameId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        idx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        frameIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        xpath: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        css: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        reactElementName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        coordinates: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            x: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            y: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            top: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            left: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            bottom: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            right: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        }, z.core.$strict>>>;
        snapshotId: z.ZodOptional<z.ZodNullable<z.ZodUUID>>;
        elementId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    cache: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
        threshold: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>]>>;
}, z.core.$strip>>;
export declare const ExtractResultSchema: z.ZodObject<{
    result: z.ZodUnknown;
    actionId: z.ZodOptional<z.ZodString>;
    cacheStatus: z.ZodOptional<z.ZodEnum<{
        HIT: "HIT";
        MISS: "MISS";
    }>>;
}, z.core.$strip>;
export declare const ObserveOptionsSchema: z.ZodOptional<z.ZodObject<{
    model: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
        apiKey: z.ZodOptional<z.ZodString>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        modelName: z.ZodUnion<readonly [z.ZodTemplateLiteral<"openai/gpt-4.1" | "openai/gpt-4.1-2025-04-14" | "openai/gpt-4.1-mini" | "openai/gpt-4.1-mini-2025-04-14" | "openai/gpt-4.1-nano" | "openai/gpt-4.1-nano-2025-04-14" | "openai/gpt-4o" | "openai/gpt-4o-2024-05-13" | "openai/gpt-4o-2024-08-06" | "openai/gpt-4o-2024-11-20" | "openai/gpt-4o-audio-preview" | "openai/gpt-4o-audio-preview-2024-12-17" | "openai/gpt-4o-search-preview" | "openai/gpt-4o-search-preview-2025-03-11" | "openai/gpt-4o-mini-search-preview" | "openai/gpt-4o-mini-search-preview-2025-03-11" | "openai/gpt-4o-mini" | "openai/gpt-4o-mini-2024-07-18" | "openai/gpt-3.5-turbo-0125" | "openai/gpt-3.5-turbo" | "openai/gpt-3.5-turbo-1106" | "openai/gpt-5-chat-latest" | "openai/o1" | "openai/o1-2024-12-17" | "openai/o3" | "openai/o3-2025-04-16" | "openai/o3-mini" | "openai/o3-mini-2025-01-31" | "openai/o4-mini" | "openai/o4-mini-2025-04-16" | "openai/gpt-5" | "openai/gpt-5-2025-08-07" | "openai/gpt-5-codex" | "openai/gpt-5-mini" | "openai/gpt-5-mini-2025-08-07" | "openai/gpt-5-nano" | "openai/gpt-5-nano-2025-08-07" | "openai/gpt-5-pro" | "openai/gpt-5-pro-2025-10-06" | "openai/gpt-5.1" | "openai/gpt-5.1-chat-latest" | "openai/gpt-5.1-codex-mini" | "openai/gpt-5.1-codex" | "openai/gpt-5.1-codex-max" | "openai/gpt-5.2" | "openai/gpt-5.2-chat-latest" | "openai/gpt-5.2-pro" | "openai/gpt-5.2-codex" | "openai/gpt-5.3-chat-latest" | "openai/gpt-5.3-codex" | "openai/gpt-5.4" | "openai/gpt-5.4-2026-03-05" | "openai/gpt-5.4-mini" | "openai/gpt-5.4-mini-2026-03-17" | "openai/gpt-5.4-nano" | "openai/gpt-5.4-nano-2026-03-17" | "openai/gpt-5.4-pro" | "openai/gpt-5.4-pro-2026-03-05" | "openai/gpt-5.5" | "openai/gpt-5.5-2026-04-23" | "openai/gpt-5.6" | "openai/gpt-5.6-luna" | "openai/gpt-5.6-sol" | "openai/gpt-5.6-terra">, z.ZodTemplateLiteral<"anthropic/claude-3-haiku-20240307" | "anthropic/claude-haiku-4-5-20251001" | "anthropic/claude-haiku-4-5" | "anthropic/claude-opus-4-0" | "anthropic/claude-opus-4-20250514" | "anthropic/claude-opus-4-1-20250805" | "anthropic/claude-opus-4-1" | "anthropic/claude-opus-4-5" | "anthropic/claude-opus-4-5-20251101" | "anthropic/claude-sonnet-4-0" | "anthropic/claude-sonnet-4-20250514" | "anthropic/claude-sonnet-4-5-20250929" | "anthropic/claude-sonnet-4-5" | "anthropic/claude-sonnet-4-6" | "anthropic/claude-opus-4-6" | "anthropic/claude-opus-4-7" | "anthropic/claude-opus-4-8" | "anthropic/claude-fable-5" | "anthropic/claude-sonnet-5">, z.ZodTemplateLiteral<"google/gemini-2.0-flash" | "google/gemini-2.0-flash-001" | "google/gemini-2.0-flash-lite" | "google/gemini-2.0-flash-lite-001" | "google/gemini-2.5-pro" | "google/gemini-2.5-flash" | "google/gemini-2.5-flash-image" | "google/gemini-2.5-flash-lite" | "google/gemini-2.5-flash-preview-tts" | "google/gemini-2.5-pro-preview-tts" | "google/gemini-2.5-flash-native-audio-latest" | "google/gemini-2.5-flash-native-audio-preview-09-2025" | "google/gemini-2.5-flash-native-audio-preview-12-2025" | "google/gemini-2.5-computer-use-preview-10-2025" | "google/gemini-3-pro-preview" | "google/gemini-3-pro-image-preview" | "google/gemini-3-flash-preview" | "google/gemini-3.1-pro-preview" | "google/gemini-3.1-pro-preview-customtools" | "google/gemini-3.1-flash-image-preview" | "google/gemini-3.1-flash-lite-preview" | "google/gemini-3.1-flash-tts-preview" | "google/gemini-3.5-flash" | "google/gemini-pro-latest" | "google/gemini-flash-latest" | "google/gemini-flash-lite-latest" | "google/deep-research-pro-preview-12-2025" | "google/deep-research-max-preview-04-2026" | "google/deep-research-preview-04-2026" | "google/nano-banana-pro-preview" | "google/aqa" | "google/gemini-robotics-er-1.5-preview" | "google/gemma-3-1b-it" | "google/gemma-3-4b-it" | "google/gemma-3n-e4b-it" | "google/gemma-3n-e2b-it" | "google/gemma-3-12b-it" | "google/gemma-3-27b-it">, z.ZodTemplateLiteral<"groq/gemma2-9b-it" | "groq/llama-3.1-8b-instant" | "groq/llama-3.3-70b-versatile" | "groq/meta-llama/llama-guard-4-12b" | "groq/openai/gpt-oss-120b" | "groq/openai/gpt-oss-20b" | "groq/deepseek-r1-distill-llama-70b" | "groq/meta-llama/llama-4-maverick-17b-128e-instruct" | "groq/meta-llama/llama-4-scout-17b-16e-instruct" | "groq/meta-llama/llama-prompt-guard-2-22m" | "groq/meta-llama/llama-prompt-guard-2-86m" | "groq/moonshotai/kimi-k2-instruct-0905" | "groq/qwen/qwen3-32b" | "groq/llama-guard-3-8b" | "groq/llama3-70b-8192" | "groq/llama3-8b-8192" | "groq/mixtral-8x7b-32768" | "groq/qwen-qwq-32b" | "groq/qwen-2.5-32b" | "groq/deepseek-r1-distill-qwen-32b">, z.ZodTemplateLiteral<"cerebras/llama3.1-8b" | "cerebras/gpt-oss-120b" | "cerebras/qwen-3-235b-a22b-instruct-2507" | "cerebras/qwen-3-235b-a22b-thinking-2507" | "cerebras/zai-glm-4.6" | "cerebras/zai-glm-4.7">]>;
    }, z.core.$strict>, z.ZodObject<{
        apiKey: z.ZodOptional<z.ZodString>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        modelName: z.ZodString;
        baseURL: z.ZodURL;
    }, z.core.$strict>]>>;
    variables: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>, z.ZodObject<{
        value: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
        description: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>]>>>;
    timeout: z.ZodOptional<z.ZodNumber>;
    selector: z.ZodOptional<z.ZodString>;
    ignoreSelectors: z.ZodOptional<z.ZodArray<z.ZodString>>;
    locator: z.ZodOptional<z.ZodObject<{
        pageIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        title: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        active: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        targetId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        tabId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        frameId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        idx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        frameIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        xpath: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        css: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        reactElementName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        coordinates: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            x: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            y: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            top: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            left: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            bottom: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            right: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        }, z.core.$strict>>>;
        snapshotId: z.ZodOptional<z.ZodNullable<z.ZodUUID>>;
        elementId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    cache: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
        threshold: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>]>>;
}, z.core.$strip>>;
export declare const ObserveResultSchema: z.ZodObject<{
    result: z.ZodArray<z.ZodObject<{
        selector: z.ZodString;
        description: z.ZodString;
        method: z.ZodOptional<z.ZodString>;
        arguments: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    actionId: z.ZodOptional<z.ZodString>;
    cacheStatus: z.ZodOptional<z.ZodEnum<{
        HIT: "HIT";
        MISS: "MISS";
    }>>;
}, z.core.$strip>;
export declare const EmptyParamsSchema: z.ZodObject<{}, z.core.$strict>;
export declare const LoadStateSchema: z.ZodEnum<{
    load: "load";
    domcontentloaded: "domcontentloaded";
    networkidle: "networkidle";
}>;
export declare const PageNavigationOptionsSchema: z.ZodObject<{
    waitUntil: z.ZodOptional<z.ZodEnum<{
        load: "load";
        domcontentloaded: "domcontentloaded";
        networkidle: "networkidle";
    }>>;
    timeout: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const PageVoidResultSchema: z.ZodObject<{
    ok: z.ZodLiteral<true>;
}, z.core.$strict>;
export declare const ContextVoidResultSchema: z.ZodObject<{
    ok: z.ZodLiteral<true>;
}, z.core.$strict>;
export declare const ContextCloseResultSchema: z.ZodObject<{
    closed: z.ZodLiteral<true>;
}, z.core.$strict>;
export declare const PageCoordinateResultSchema: z.ZodObject<{
    xpath: z.ZodString;
}, z.core.$strict>;
export declare const PageScreenshotClipSchema: z.ZodObject<{
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
}, z.core.$strict>;
export declare const SnapshotResultSchema: z.ZodObject<{
    formattedTree: z.ZodString;
    xpathMap: z.ZodRecord<z.ZodString, z.ZodString>;
    urlMap: z.ZodRecord<z.ZodString, z.ZodString>;
}, z.core.$strict>;
export declare const PageSnapshotOptionsSchema: z.ZodObject<{
    includeIframes: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export declare const PageRefSchema: z.ZodObject<{
    pageId: z.ZodString;
    url: z.ZodOptional<z.ZodString>;
    title: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const LocatorDescriptorSchema: z.ZodObject<{
    pageId: z.ZodString;
    selector: z.ZodString;
    nth: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const DEFAULT_TELEMETRY_CONFIG: {
    traces: {
        endpoint: string;
        headers: {};
    };
};
export declare const TelemetryConfigSchema: z.ZodObject<{
    traces: z.ZodObject<{
        endpoint: z.ZodURL;
        headers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const StagehandInitParamsSchema: z.ZodObject<{
    apiKey: z.ZodOptional<z.ZodString>;
    browser: z.ZodOptional<z.ZodObject<{
        browserSettings: z.ZodOptional<z.ZodObject<{
            advancedStealth: z.ZodOptional<z.ZodBoolean>;
            blockAds: z.ZodOptional<z.ZodBoolean>;
            captchaImageSelector: z.ZodOptional<z.ZodString>;
            captchaInputSelector: z.ZodOptional<z.ZodString>;
            context: z.ZodOptional<z.ZodObject<{
                id: z.ZodString;
                persist: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>;
            extensionId: z.ZodOptional<z.ZodString>;
            fingerprint: z.ZodOptional<z.ZodObject<{
                browsers: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    chrome: "chrome";
                    edge: "edge";
                    firefox: "firefox";
                    safari: "safari";
                }>>>;
                devices: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    desktop: "desktop";
                    mobile: "mobile";
                }>>>;
                httpVersion: z.ZodOptional<z.ZodEnum<{
                    1: "1";
                    2: "2";
                }>>;
                locales: z.ZodOptional<z.ZodArray<z.ZodString>>;
                operatingSystems: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    android: "android";
                    ios: "ios";
                    linux: "linux";
                    macos: "macos";
                    windows: "windows";
                }>>>;
                screen: z.ZodOptional<z.ZodObject<{
                    maxHeight: z.ZodOptional<z.ZodNumber>;
                    maxWidth: z.ZodOptional<z.ZodNumber>;
                    minHeight: z.ZodOptional<z.ZodNumber>;
                    minWidth: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            logSession: z.ZodOptional<z.ZodBoolean>;
            os: z.ZodOptional<z.ZodEnum<{
                mobile: "mobile";
                linux: "linux";
                windows: "windows";
                mac: "mac";
                tablet: "tablet";
            }>>;
            recordSession: z.ZodOptional<z.ZodBoolean>;
            solveCaptchas: z.ZodOptional<z.ZodBoolean>;
            verified: z.ZodOptional<z.ZodBoolean>;
            viewport: z.ZodOptional<z.ZodObject<{
                width: z.ZodOptional<z.ZodNumber>;
                height: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        extensionId: z.ZodOptional<z.ZodString>;
        keepAlive: z.ZodOptional<z.ZodBoolean>;
        proxies: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"browserbase">;
            domainPattern: z.ZodOptional<z.ZodString>;
            geolocation: z.ZodOptional<z.ZodObject<{
                country: z.ZodString;
                city: z.ZodOptional<z.ZodString>;
                state: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"external">;
            server: z.ZodString;
            domainPattern: z.ZodOptional<z.ZodString>;
            username: z.ZodOptional<z.ZodString>;
            password: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>], "type">>]>>;
        region: z.ZodOptional<z.ZodEnum<{
            "us-west-2": "us-west-2";
            "us-east-1": "us-east-1";
            "eu-central-1": "eu-central-1";
            "ap-southeast-1": "ap-southeast-1";
        }>>;
        timeout: z.ZodOptional<z.ZodNumber>;
        userMetadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        type: z.ZodLiteral<"browserbase">;
        sessionId: z.ZodString;
    }, z.core.$strict>>;
    model: z.ZodOptional<z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodObject<{
        apiKey: z.ZodOptional<z.ZodString>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        modelName: z.ZodUnion<readonly [z.ZodTemplateLiteral<"openai/gpt-4.1" | "openai/gpt-4.1-2025-04-14" | "openai/gpt-4.1-mini" | "openai/gpt-4.1-mini-2025-04-14" | "openai/gpt-4.1-nano" | "openai/gpt-4.1-nano-2025-04-14" | "openai/gpt-4o" | "openai/gpt-4o-2024-05-13" | "openai/gpt-4o-2024-08-06" | "openai/gpt-4o-2024-11-20" | "openai/gpt-4o-audio-preview" | "openai/gpt-4o-audio-preview-2024-12-17" | "openai/gpt-4o-search-preview" | "openai/gpt-4o-search-preview-2025-03-11" | "openai/gpt-4o-mini-search-preview" | "openai/gpt-4o-mini-search-preview-2025-03-11" | "openai/gpt-4o-mini" | "openai/gpt-4o-mini-2024-07-18" | "openai/gpt-3.5-turbo-0125" | "openai/gpt-3.5-turbo" | "openai/gpt-3.5-turbo-1106" | "openai/gpt-5-chat-latest" | "openai/o1" | "openai/o1-2024-12-17" | "openai/o3" | "openai/o3-2025-04-16" | "openai/o3-mini" | "openai/o3-mini-2025-01-31" | "openai/o4-mini" | "openai/o4-mini-2025-04-16" | "openai/gpt-5" | "openai/gpt-5-2025-08-07" | "openai/gpt-5-codex" | "openai/gpt-5-mini" | "openai/gpt-5-mini-2025-08-07" | "openai/gpt-5-nano" | "openai/gpt-5-nano-2025-08-07" | "openai/gpt-5-pro" | "openai/gpt-5-pro-2025-10-06" | "openai/gpt-5.1" | "openai/gpt-5.1-chat-latest" | "openai/gpt-5.1-codex-mini" | "openai/gpt-5.1-codex" | "openai/gpt-5.1-codex-max" | "openai/gpt-5.2" | "openai/gpt-5.2-chat-latest" | "openai/gpt-5.2-pro" | "openai/gpt-5.2-codex" | "openai/gpt-5.3-chat-latest" | "openai/gpt-5.3-codex" | "openai/gpt-5.4" | "openai/gpt-5.4-2026-03-05" | "openai/gpt-5.4-mini" | "openai/gpt-5.4-mini-2026-03-17" | "openai/gpt-5.4-nano" | "openai/gpt-5.4-nano-2026-03-17" | "openai/gpt-5.4-pro" | "openai/gpt-5.4-pro-2026-03-05" | "openai/gpt-5.5" | "openai/gpt-5.5-2026-04-23" | "openai/gpt-5.6" | "openai/gpt-5.6-luna" | "openai/gpt-5.6-sol" | "openai/gpt-5.6-terra">, z.ZodTemplateLiteral<"anthropic/claude-3-haiku-20240307" | "anthropic/claude-haiku-4-5-20251001" | "anthropic/claude-haiku-4-5" | "anthropic/claude-opus-4-0" | "anthropic/claude-opus-4-20250514" | "anthropic/claude-opus-4-1-20250805" | "anthropic/claude-opus-4-1" | "anthropic/claude-opus-4-5" | "anthropic/claude-opus-4-5-20251101" | "anthropic/claude-sonnet-4-0" | "anthropic/claude-sonnet-4-20250514" | "anthropic/claude-sonnet-4-5-20250929" | "anthropic/claude-sonnet-4-5" | "anthropic/claude-sonnet-4-6" | "anthropic/claude-opus-4-6" | "anthropic/claude-opus-4-7" | "anthropic/claude-opus-4-8" | "anthropic/claude-fable-5" | "anthropic/claude-sonnet-5">, z.ZodTemplateLiteral<"google/gemini-2.0-flash" | "google/gemini-2.0-flash-001" | "google/gemini-2.0-flash-lite" | "google/gemini-2.0-flash-lite-001" | "google/gemini-2.5-pro" | "google/gemini-2.5-flash" | "google/gemini-2.5-flash-image" | "google/gemini-2.5-flash-lite" | "google/gemini-2.5-flash-preview-tts" | "google/gemini-2.5-pro-preview-tts" | "google/gemini-2.5-flash-native-audio-latest" | "google/gemini-2.5-flash-native-audio-preview-09-2025" | "google/gemini-2.5-flash-native-audio-preview-12-2025" | "google/gemini-2.5-computer-use-preview-10-2025" | "google/gemini-3-pro-preview" | "google/gemini-3-pro-image-preview" | "google/gemini-3-flash-preview" | "google/gemini-3.1-pro-preview" | "google/gemini-3.1-pro-preview-customtools" | "google/gemini-3.1-flash-image-preview" | "google/gemini-3.1-flash-lite-preview" | "google/gemini-3.1-flash-tts-preview" | "google/gemini-3.5-flash" | "google/gemini-pro-latest" | "google/gemini-flash-latest" | "google/gemini-flash-lite-latest" | "google/deep-research-pro-preview-12-2025" | "google/deep-research-max-preview-04-2026" | "google/deep-research-preview-04-2026" | "google/nano-banana-pro-preview" | "google/aqa" | "google/gemini-robotics-er-1.5-preview" | "google/gemma-3-1b-it" | "google/gemma-3-4b-it" | "google/gemma-3n-e4b-it" | "google/gemma-3n-e2b-it" | "google/gemma-3-12b-it" | "google/gemma-3-27b-it">, z.ZodTemplateLiteral<"groq/gemma2-9b-it" | "groq/llama-3.1-8b-instant" | "groq/llama-3.3-70b-versatile" | "groq/meta-llama/llama-guard-4-12b" | "groq/openai/gpt-oss-120b" | "groq/openai/gpt-oss-20b" | "groq/deepseek-r1-distill-llama-70b" | "groq/meta-llama/llama-4-maverick-17b-128e-instruct" | "groq/meta-llama/llama-4-scout-17b-16e-instruct" | "groq/meta-llama/llama-prompt-guard-2-22m" | "groq/meta-llama/llama-prompt-guard-2-86m" | "groq/moonshotai/kimi-k2-instruct-0905" | "groq/qwen/qwen3-32b" | "groq/llama-guard-3-8b" | "groq/llama3-70b-8192" | "groq/llama3-8b-8192" | "groq/mixtral-8x7b-32768" | "groq/qwen-qwq-32b" | "groq/qwen-2.5-32b" | "groq/deepseek-r1-distill-qwen-32b">, z.ZodTemplateLiteral<"cerebras/llama3.1-8b" | "cerebras/gpt-oss-120b" | "cerebras/qwen-3-235b-a22b-instruct-2507" | "cerebras/qwen-3-235b-a22b-thinking-2507" | "cerebras/zai-glm-4.6" | "cerebras/zai-glm-4.7">]>;
    }, z.core.$strict>, z.ZodObject<{
        apiKey: z.ZodOptional<z.ZodString>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        modelName: z.ZodString;
        baseURL: z.ZodURL;
    }, z.core.$strict>]>, z.ZodObject<{
        source: z.ZodLiteral<"client">;
    }, z.core.$strict>]>>;
    telemetry: z.ZodDefault<z.ZodObject<{
        traces: z.ZodObject<{
            endpoint: z.ZodURL;
            headers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
    }, z.core.$strict>>;
    systemPrompt: z.ZodOptional<z.ZodString>;
    selfHeal: z.ZodOptional<z.ZodBoolean>;
    domSettleTimeoutMs: z.ZodOptional<z.ZodNumber>;
    cache: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
        threshold: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>]>>;
}, z.core.$strict>;
export declare const RuntimeConfigureParamsSchema: z.ZodObject<{
    cdpUrl: z.ZodString;
    telemetry: z.ZodDefault<z.ZodObject<{
        traces: z.ZodObject<{
            endpoint: z.ZodURL;
            headers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const StagehandActParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    input: z.ZodString;
    options: z.ZodOptional<z.ZodObject<{
        model: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
            apiKey: z.ZodOptional<z.ZodString>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            modelName: z.ZodUnion<readonly [z.ZodTemplateLiteral<"openai/gpt-4.1" | "openai/gpt-4.1-2025-04-14" | "openai/gpt-4.1-mini" | "openai/gpt-4.1-mini-2025-04-14" | "openai/gpt-4.1-nano" | "openai/gpt-4.1-nano-2025-04-14" | "openai/gpt-4o" | "openai/gpt-4o-2024-05-13" | "openai/gpt-4o-2024-08-06" | "openai/gpt-4o-2024-11-20" | "openai/gpt-4o-audio-preview" | "openai/gpt-4o-audio-preview-2024-12-17" | "openai/gpt-4o-search-preview" | "openai/gpt-4o-search-preview-2025-03-11" | "openai/gpt-4o-mini-search-preview" | "openai/gpt-4o-mini-search-preview-2025-03-11" | "openai/gpt-4o-mini" | "openai/gpt-4o-mini-2024-07-18" | "openai/gpt-3.5-turbo-0125" | "openai/gpt-3.5-turbo" | "openai/gpt-3.5-turbo-1106" | "openai/gpt-5-chat-latest" | "openai/o1" | "openai/o1-2024-12-17" | "openai/o3" | "openai/o3-2025-04-16" | "openai/o3-mini" | "openai/o3-mini-2025-01-31" | "openai/o4-mini" | "openai/o4-mini-2025-04-16" | "openai/gpt-5" | "openai/gpt-5-2025-08-07" | "openai/gpt-5-codex" | "openai/gpt-5-mini" | "openai/gpt-5-mini-2025-08-07" | "openai/gpt-5-nano" | "openai/gpt-5-nano-2025-08-07" | "openai/gpt-5-pro" | "openai/gpt-5-pro-2025-10-06" | "openai/gpt-5.1" | "openai/gpt-5.1-chat-latest" | "openai/gpt-5.1-codex-mini" | "openai/gpt-5.1-codex" | "openai/gpt-5.1-codex-max" | "openai/gpt-5.2" | "openai/gpt-5.2-chat-latest" | "openai/gpt-5.2-pro" | "openai/gpt-5.2-codex" | "openai/gpt-5.3-chat-latest" | "openai/gpt-5.3-codex" | "openai/gpt-5.4" | "openai/gpt-5.4-2026-03-05" | "openai/gpt-5.4-mini" | "openai/gpt-5.4-mini-2026-03-17" | "openai/gpt-5.4-nano" | "openai/gpt-5.4-nano-2026-03-17" | "openai/gpt-5.4-pro" | "openai/gpt-5.4-pro-2026-03-05" | "openai/gpt-5.5" | "openai/gpt-5.5-2026-04-23" | "openai/gpt-5.6" | "openai/gpt-5.6-luna" | "openai/gpt-5.6-sol" | "openai/gpt-5.6-terra">, z.ZodTemplateLiteral<"anthropic/claude-3-haiku-20240307" | "anthropic/claude-haiku-4-5-20251001" | "anthropic/claude-haiku-4-5" | "anthropic/claude-opus-4-0" | "anthropic/claude-opus-4-20250514" | "anthropic/claude-opus-4-1-20250805" | "anthropic/claude-opus-4-1" | "anthropic/claude-opus-4-5" | "anthropic/claude-opus-4-5-20251101" | "anthropic/claude-sonnet-4-0" | "anthropic/claude-sonnet-4-20250514" | "anthropic/claude-sonnet-4-5-20250929" | "anthropic/claude-sonnet-4-5" | "anthropic/claude-sonnet-4-6" | "anthropic/claude-opus-4-6" | "anthropic/claude-opus-4-7" | "anthropic/claude-opus-4-8" | "anthropic/claude-fable-5" | "anthropic/claude-sonnet-5">, z.ZodTemplateLiteral<"google/gemini-2.0-flash" | "google/gemini-2.0-flash-001" | "google/gemini-2.0-flash-lite" | "google/gemini-2.0-flash-lite-001" | "google/gemini-2.5-pro" | "google/gemini-2.5-flash" | "google/gemini-2.5-flash-image" | "google/gemini-2.5-flash-lite" | "google/gemini-2.5-flash-preview-tts" | "google/gemini-2.5-pro-preview-tts" | "google/gemini-2.5-flash-native-audio-latest" | "google/gemini-2.5-flash-native-audio-preview-09-2025" | "google/gemini-2.5-flash-native-audio-preview-12-2025" | "google/gemini-2.5-computer-use-preview-10-2025" | "google/gemini-3-pro-preview" | "google/gemini-3-pro-image-preview" | "google/gemini-3-flash-preview" | "google/gemini-3.1-pro-preview" | "google/gemini-3.1-pro-preview-customtools" | "google/gemini-3.1-flash-image-preview" | "google/gemini-3.1-flash-lite-preview" | "google/gemini-3.1-flash-tts-preview" | "google/gemini-3.5-flash" | "google/gemini-pro-latest" | "google/gemini-flash-latest" | "google/gemini-flash-lite-latest" | "google/deep-research-pro-preview-12-2025" | "google/deep-research-max-preview-04-2026" | "google/deep-research-preview-04-2026" | "google/nano-banana-pro-preview" | "google/aqa" | "google/gemini-robotics-er-1.5-preview" | "google/gemma-3-1b-it" | "google/gemma-3-4b-it" | "google/gemma-3n-e4b-it" | "google/gemma-3n-e2b-it" | "google/gemma-3-12b-it" | "google/gemma-3-27b-it">, z.ZodTemplateLiteral<"groq/gemma2-9b-it" | "groq/llama-3.1-8b-instant" | "groq/llama-3.3-70b-versatile" | "groq/meta-llama/llama-guard-4-12b" | "groq/openai/gpt-oss-120b" | "groq/openai/gpt-oss-20b" | "groq/deepseek-r1-distill-llama-70b" | "groq/meta-llama/llama-4-maverick-17b-128e-instruct" | "groq/meta-llama/llama-4-scout-17b-16e-instruct" | "groq/meta-llama/llama-prompt-guard-2-22m" | "groq/meta-llama/llama-prompt-guard-2-86m" | "groq/moonshotai/kimi-k2-instruct-0905" | "groq/qwen/qwen3-32b" | "groq/llama-guard-3-8b" | "groq/llama3-70b-8192" | "groq/llama3-8b-8192" | "groq/mixtral-8x7b-32768" | "groq/qwen-qwq-32b" | "groq/qwen-2.5-32b" | "groq/deepseek-r1-distill-qwen-32b">, z.ZodTemplateLiteral<"cerebras/llama3.1-8b" | "cerebras/gpt-oss-120b" | "cerebras/qwen-3-235b-a22b-instruct-2507" | "cerebras/qwen-3-235b-a22b-thinking-2507" | "cerebras/zai-glm-4.6" | "cerebras/zai-glm-4.7">]>;
        }, z.core.$strict>, z.ZodObject<{
            apiKey: z.ZodOptional<z.ZodString>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            modelName: z.ZodString;
            baseURL: z.ZodURL;
        }, z.core.$strict>]>>;
        variables: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>, z.ZodObject<{
            value: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>]>>>;
        timeout: z.ZodOptional<z.ZodNumber>;
        locator: z.ZodOptional<z.ZodObject<{
            pageIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            title: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            active: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
            targetId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            tabId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            frameId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            idx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            frameIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            xpath: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            css: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            reactElementName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            coordinates: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                x: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                y: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                top: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                left: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                bottom: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                right: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            }, z.core.$strict>>>;
            snapshotId: z.ZodOptional<z.ZodNullable<z.ZodUUID>>;
            elementId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>;
        cache: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
            threshold: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>]>>;
    }, z.core.$strip>>;
}, z.core.$strict>;
export declare const StagehandObserveParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    instruction: z.ZodOptional<z.ZodString>;
    options: z.ZodOptional<z.ZodObject<{
        model: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
            apiKey: z.ZodOptional<z.ZodString>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            modelName: z.ZodUnion<readonly [z.ZodTemplateLiteral<"openai/gpt-4.1" | "openai/gpt-4.1-2025-04-14" | "openai/gpt-4.1-mini" | "openai/gpt-4.1-mini-2025-04-14" | "openai/gpt-4.1-nano" | "openai/gpt-4.1-nano-2025-04-14" | "openai/gpt-4o" | "openai/gpt-4o-2024-05-13" | "openai/gpt-4o-2024-08-06" | "openai/gpt-4o-2024-11-20" | "openai/gpt-4o-audio-preview" | "openai/gpt-4o-audio-preview-2024-12-17" | "openai/gpt-4o-search-preview" | "openai/gpt-4o-search-preview-2025-03-11" | "openai/gpt-4o-mini-search-preview" | "openai/gpt-4o-mini-search-preview-2025-03-11" | "openai/gpt-4o-mini" | "openai/gpt-4o-mini-2024-07-18" | "openai/gpt-3.5-turbo-0125" | "openai/gpt-3.5-turbo" | "openai/gpt-3.5-turbo-1106" | "openai/gpt-5-chat-latest" | "openai/o1" | "openai/o1-2024-12-17" | "openai/o3" | "openai/o3-2025-04-16" | "openai/o3-mini" | "openai/o3-mini-2025-01-31" | "openai/o4-mini" | "openai/o4-mini-2025-04-16" | "openai/gpt-5" | "openai/gpt-5-2025-08-07" | "openai/gpt-5-codex" | "openai/gpt-5-mini" | "openai/gpt-5-mini-2025-08-07" | "openai/gpt-5-nano" | "openai/gpt-5-nano-2025-08-07" | "openai/gpt-5-pro" | "openai/gpt-5-pro-2025-10-06" | "openai/gpt-5.1" | "openai/gpt-5.1-chat-latest" | "openai/gpt-5.1-codex-mini" | "openai/gpt-5.1-codex" | "openai/gpt-5.1-codex-max" | "openai/gpt-5.2" | "openai/gpt-5.2-chat-latest" | "openai/gpt-5.2-pro" | "openai/gpt-5.2-codex" | "openai/gpt-5.3-chat-latest" | "openai/gpt-5.3-codex" | "openai/gpt-5.4" | "openai/gpt-5.4-2026-03-05" | "openai/gpt-5.4-mini" | "openai/gpt-5.4-mini-2026-03-17" | "openai/gpt-5.4-nano" | "openai/gpt-5.4-nano-2026-03-17" | "openai/gpt-5.4-pro" | "openai/gpt-5.4-pro-2026-03-05" | "openai/gpt-5.5" | "openai/gpt-5.5-2026-04-23" | "openai/gpt-5.6" | "openai/gpt-5.6-luna" | "openai/gpt-5.6-sol" | "openai/gpt-5.6-terra">, z.ZodTemplateLiteral<"anthropic/claude-3-haiku-20240307" | "anthropic/claude-haiku-4-5-20251001" | "anthropic/claude-haiku-4-5" | "anthropic/claude-opus-4-0" | "anthropic/claude-opus-4-20250514" | "anthropic/claude-opus-4-1-20250805" | "anthropic/claude-opus-4-1" | "anthropic/claude-opus-4-5" | "anthropic/claude-opus-4-5-20251101" | "anthropic/claude-sonnet-4-0" | "anthropic/claude-sonnet-4-20250514" | "anthropic/claude-sonnet-4-5-20250929" | "anthropic/claude-sonnet-4-5" | "anthropic/claude-sonnet-4-6" | "anthropic/claude-opus-4-6" | "anthropic/claude-opus-4-7" | "anthropic/claude-opus-4-8" | "anthropic/claude-fable-5" | "anthropic/claude-sonnet-5">, z.ZodTemplateLiteral<"google/gemini-2.0-flash" | "google/gemini-2.0-flash-001" | "google/gemini-2.0-flash-lite" | "google/gemini-2.0-flash-lite-001" | "google/gemini-2.5-pro" | "google/gemini-2.5-flash" | "google/gemini-2.5-flash-image" | "google/gemini-2.5-flash-lite" | "google/gemini-2.5-flash-preview-tts" | "google/gemini-2.5-pro-preview-tts" | "google/gemini-2.5-flash-native-audio-latest" | "google/gemini-2.5-flash-native-audio-preview-09-2025" | "google/gemini-2.5-flash-native-audio-preview-12-2025" | "google/gemini-2.5-computer-use-preview-10-2025" | "google/gemini-3-pro-preview" | "google/gemini-3-pro-image-preview" | "google/gemini-3-flash-preview" | "google/gemini-3.1-pro-preview" | "google/gemini-3.1-pro-preview-customtools" | "google/gemini-3.1-flash-image-preview" | "google/gemini-3.1-flash-lite-preview" | "google/gemini-3.1-flash-tts-preview" | "google/gemini-3.5-flash" | "google/gemini-pro-latest" | "google/gemini-flash-latest" | "google/gemini-flash-lite-latest" | "google/deep-research-pro-preview-12-2025" | "google/deep-research-max-preview-04-2026" | "google/deep-research-preview-04-2026" | "google/nano-banana-pro-preview" | "google/aqa" | "google/gemini-robotics-er-1.5-preview" | "google/gemma-3-1b-it" | "google/gemma-3-4b-it" | "google/gemma-3n-e4b-it" | "google/gemma-3n-e2b-it" | "google/gemma-3-12b-it" | "google/gemma-3-27b-it">, z.ZodTemplateLiteral<"groq/gemma2-9b-it" | "groq/llama-3.1-8b-instant" | "groq/llama-3.3-70b-versatile" | "groq/meta-llama/llama-guard-4-12b" | "groq/openai/gpt-oss-120b" | "groq/openai/gpt-oss-20b" | "groq/deepseek-r1-distill-llama-70b" | "groq/meta-llama/llama-4-maverick-17b-128e-instruct" | "groq/meta-llama/llama-4-scout-17b-16e-instruct" | "groq/meta-llama/llama-prompt-guard-2-22m" | "groq/meta-llama/llama-prompt-guard-2-86m" | "groq/moonshotai/kimi-k2-instruct-0905" | "groq/qwen/qwen3-32b" | "groq/llama-guard-3-8b" | "groq/llama3-70b-8192" | "groq/llama3-8b-8192" | "groq/mixtral-8x7b-32768" | "groq/qwen-qwq-32b" | "groq/qwen-2.5-32b" | "groq/deepseek-r1-distill-qwen-32b">, z.ZodTemplateLiteral<"cerebras/llama3.1-8b" | "cerebras/gpt-oss-120b" | "cerebras/qwen-3-235b-a22b-instruct-2507" | "cerebras/qwen-3-235b-a22b-thinking-2507" | "cerebras/zai-glm-4.6" | "cerebras/zai-glm-4.7">]>;
        }, z.core.$strict>, z.ZodObject<{
            apiKey: z.ZodOptional<z.ZodString>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            modelName: z.ZodString;
            baseURL: z.ZodURL;
        }, z.core.$strict>]>>;
        variables: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>, z.ZodObject<{
            value: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>]>>>;
        timeout: z.ZodOptional<z.ZodNumber>;
        selector: z.ZodOptional<z.ZodString>;
        ignoreSelectors: z.ZodOptional<z.ZodArray<z.ZodString>>;
        locator: z.ZodOptional<z.ZodObject<{
            pageIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            title: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            active: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
            targetId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            tabId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            frameId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            idx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            frameIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            xpath: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            css: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            reactElementName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            coordinates: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                x: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                y: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                top: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                left: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                bottom: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                right: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            }, z.core.$strict>>>;
            snapshotId: z.ZodOptional<z.ZodNullable<z.ZodUUID>>;
            elementId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>;
        cache: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
            threshold: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>]>>;
    }, z.core.$strip>>;
}, z.core.$strict>;
export declare const StagehandExtractParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    instruction: z.ZodString;
    schema: z.ZodJSONSchema;
    options: z.ZodOptional<z.ZodObject<{
        model: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
            apiKey: z.ZodOptional<z.ZodString>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            modelName: z.ZodUnion<readonly [z.ZodTemplateLiteral<"openai/gpt-4.1" | "openai/gpt-4.1-2025-04-14" | "openai/gpt-4.1-mini" | "openai/gpt-4.1-mini-2025-04-14" | "openai/gpt-4.1-nano" | "openai/gpt-4.1-nano-2025-04-14" | "openai/gpt-4o" | "openai/gpt-4o-2024-05-13" | "openai/gpt-4o-2024-08-06" | "openai/gpt-4o-2024-11-20" | "openai/gpt-4o-audio-preview" | "openai/gpt-4o-audio-preview-2024-12-17" | "openai/gpt-4o-search-preview" | "openai/gpt-4o-search-preview-2025-03-11" | "openai/gpt-4o-mini-search-preview" | "openai/gpt-4o-mini-search-preview-2025-03-11" | "openai/gpt-4o-mini" | "openai/gpt-4o-mini-2024-07-18" | "openai/gpt-3.5-turbo-0125" | "openai/gpt-3.5-turbo" | "openai/gpt-3.5-turbo-1106" | "openai/gpt-5-chat-latest" | "openai/o1" | "openai/o1-2024-12-17" | "openai/o3" | "openai/o3-2025-04-16" | "openai/o3-mini" | "openai/o3-mini-2025-01-31" | "openai/o4-mini" | "openai/o4-mini-2025-04-16" | "openai/gpt-5" | "openai/gpt-5-2025-08-07" | "openai/gpt-5-codex" | "openai/gpt-5-mini" | "openai/gpt-5-mini-2025-08-07" | "openai/gpt-5-nano" | "openai/gpt-5-nano-2025-08-07" | "openai/gpt-5-pro" | "openai/gpt-5-pro-2025-10-06" | "openai/gpt-5.1" | "openai/gpt-5.1-chat-latest" | "openai/gpt-5.1-codex-mini" | "openai/gpt-5.1-codex" | "openai/gpt-5.1-codex-max" | "openai/gpt-5.2" | "openai/gpt-5.2-chat-latest" | "openai/gpt-5.2-pro" | "openai/gpt-5.2-codex" | "openai/gpt-5.3-chat-latest" | "openai/gpt-5.3-codex" | "openai/gpt-5.4" | "openai/gpt-5.4-2026-03-05" | "openai/gpt-5.4-mini" | "openai/gpt-5.4-mini-2026-03-17" | "openai/gpt-5.4-nano" | "openai/gpt-5.4-nano-2026-03-17" | "openai/gpt-5.4-pro" | "openai/gpt-5.4-pro-2026-03-05" | "openai/gpt-5.5" | "openai/gpt-5.5-2026-04-23" | "openai/gpt-5.6" | "openai/gpt-5.6-luna" | "openai/gpt-5.6-sol" | "openai/gpt-5.6-terra">, z.ZodTemplateLiteral<"anthropic/claude-3-haiku-20240307" | "anthropic/claude-haiku-4-5-20251001" | "anthropic/claude-haiku-4-5" | "anthropic/claude-opus-4-0" | "anthropic/claude-opus-4-20250514" | "anthropic/claude-opus-4-1-20250805" | "anthropic/claude-opus-4-1" | "anthropic/claude-opus-4-5" | "anthropic/claude-opus-4-5-20251101" | "anthropic/claude-sonnet-4-0" | "anthropic/claude-sonnet-4-20250514" | "anthropic/claude-sonnet-4-5-20250929" | "anthropic/claude-sonnet-4-5" | "anthropic/claude-sonnet-4-6" | "anthropic/claude-opus-4-6" | "anthropic/claude-opus-4-7" | "anthropic/claude-opus-4-8" | "anthropic/claude-fable-5" | "anthropic/claude-sonnet-5">, z.ZodTemplateLiteral<"google/gemini-2.0-flash" | "google/gemini-2.0-flash-001" | "google/gemini-2.0-flash-lite" | "google/gemini-2.0-flash-lite-001" | "google/gemini-2.5-pro" | "google/gemini-2.5-flash" | "google/gemini-2.5-flash-image" | "google/gemini-2.5-flash-lite" | "google/gemini-2.5-flash-preview-tts" | "google/gemini-2.5-pro-preview-tts" | "google/gemini-2.5-flash-native-audio-latest" | "google/gemini-2.5-flash-native-audio-preview-09-2025" | "google/gemini-2.5-flash-native-audio-preview-12-2025" | "google/gemini-2.5-computer-use-preview-10-2025" | "google/gemini-3-pro-preview" | "google/gemini-3-pro-image-preview" | "google/gemini-3-flash-preview" | "google/gemini-3.1-pro-preview" | "google/gemini-3.1-pro-preview-customtools" | "google/gemini-3.1-flash-image-preview" | "google/gemini-3.1-flash-lite-preview" | "google/gemini-3.1-flash-tts-preview" | "google/gemini-3.5-flash" | "google/gemini-pro-latest" | "google/gemini-flash-latest" | "google/gemini-flash-lite-latest" | "google/deep-research-pro-preview-12-2025" | "google/deep-research-max-preview-04-2026" | "google/deep-research-preview-04-2026" | "google/nano-banana-pro-preview" | "google/aqa" | "google/gemini-robotics-er-1.5-preview" | "google/gemma-3-1b-it" | "google/gemma-3-4b-it" | "google/gemma-3n-e4b-it" | "google/gemma-3n-e2b-it" | "google/gemma-3-12b-it" | "google/gemma-3-27b-it">, z.ZodTemplateLiteral<"groq/gemma2-9b-it" | "groq/llama-3.1-8b-instant" | "groq/llama-3.3-70b-versatile" | "groq/meta-llama/llama-guard-4-12b" | "groq/openai/gpt-oss-120b" | "groq/openai/gpt-oss-20b" | "groq/deepseek-r1-distill-llama-70b" | "groq/meta-llama/llama-4-maverick-17b-128e-instruct" | "groq/meta-llama/llama-4-scout-17b-16e-instruct" | "groq/meta-llama/llama-prompt-guard-2-22m" | "groq/meta-llama/llama-prompt-guard-2-86m" | "groq/moonshotai/kimi-k2-instruct-0905" | "groq/qwen/qwen3-32b" | "groq/llama-guard-3-8b" | "groq/llama3-70b-8192" | "groq/llama3-8b-8192" | "groq/mixtral-8x7b-32768" | "groq/qwen-qwq-32b" | "groq/qwen-2.5-32b" | "groq/deepseek-r1-distill-qwen-32b">, z.ZodTemplateLiteral<"cerebras/llama3.1-8b" | "cerebras/gpt-oss-120b" | "cerebras/qwen-3-235b-a22b-instruct-2507" | "cerebras/qwen-3-235b-a22b-thinking-2507" | "cerebras/zai-glm-4.6" | "cerebras/zai-glm-4.7">]>;
        }, z.core.$strict>, z.ZodObject<{
            apiKey: z.ZodOptional<z.ZodString>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            modelName: z.ZodString;
            baseURL: z.ZodURL;
        }, z.core.$strict>]>>;
        timeout: z.ZodOptional<z.ZodNumber>;
        selector: z.ZodOptional<z.ZodString>;
        ignoreSelectors: z.ZodOptional<z.ZodArray<z.ZodString>>;
        screenshot: z.ZodOptional<z.ZodBoolean>;
        locator: z.ZodOptional<z.ZodObject<{
            pageIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            title: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            active: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
            targetId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            tabId: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            frameId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            idx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            frameIdx: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            xpath: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            css: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            reactElementName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            coordinates: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                x: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                y: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                top: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                left: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                bottom: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                right: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            }, z.core.$strict>>>;
            snapshotId: z.ZodOptional<z.ZodNullable<z.ZodUUID>>;
            elementId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>;
        cache: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
            threshold: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>]>>;
    }, z.core.$strip>>;
}, z.core.$strict>;
export declare const ContextNewPageParamsSchema: z.ZodObject<{
    url: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const ContextSetActivePageParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
}, z.core.$strict>;
export declare const ContextAddInitScriptParamsSchema: z.ZodObject<{
    source: z.ZodString;
}, z.core.$strict>;
export declare const ContextSetExtraHTTPHeadersParamsSchema: z.ZodObject<{
    headers: z.ZodRecord<z.ZodString, z.ZodString>;
}, z.core.$strict>;
export declare const ContextSetDomainPolicyParamsSchema: z.ZodObject<{
    policy: z.ZodNullable<z.ZodObject<{
        allowedDomains: z.ZodOptional<z.ZodArray<z.ZodString>>;
        blockedDomains: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const ContextCookiesParamsSchema: z.ZodObject<{
    urls: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
}, z.core.$strict>;
export declare const ContextAddCookiesParamsSchema: z.ZodObject<{
    cookies: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        value: z.ZodString;
        url: z.ZodOptional<z.ZodString>;
        domain: z.ZodOptional<z.ZodString>;
        path: z.ZodOptional<z.ZodString>;
        expires: z.ZodOptional<z.ZodNumber>;
        httpOnly: z.ZodOptional<z.ZodBoolean>;
        secure: z.ZodOptional<z.ZodBoolean>;
        sameSite: z.ZodOptional<z.ZodEnum<{
            Strict: "Strict";
            Lax: "Lax";
            None: "None";
        }>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const ContextClearCookiesParamsSchema: z.ZodObject<{
    options: z.ZodOptional<z.ZodObject<{
        name: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
            source: z.ZodString;
            flags: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>]>>;
        domain: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
            source: z.ZodString;
            flags: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>]>>;
        path: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
            source: z.ZodString;
            flags: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>]>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const ContextClipboardTargetSchema: z.ZodObject<{
    pageId: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const ContextClipboardReadTextParamsSchema: z.ZodObject<{
    pageId: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const ContextClipboardWriteTextParamsSchema: z.ZodObject<{
    pageId: z.ZodOptional<z.ZodString>;
    text: z.ZodString;
}, z.core.$strict>;
export declare const ContextClipboardClearParamsSchema: z.ZodObject<{
    pageId: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const ContextClipboardPasteParamsSchema: z.ZodObject<{
    pageId: z.ZodOptional<z.ZodString>;
    shortcut: z.ZodOptional<z.ZodEnum<{
        "ControlOrMeta+V": "ControlOrMeta+V";
        "Meta+V": "Meta+V";
        "Control+V": "Control+V";
    }>>;
}, z.core.$strict>;
export declare const ContextClipboardCopyParamsSchema: z.ZodObject<{
    pageId: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const ContextClipboardCutParamsSchema: z.ZodObject<{
    pageId: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const PageGotoParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    url: z.ZodString;
    options: z.ZodOptional<z.ZodObject<{
        waitUntil: z.ZodOptional<z.ZodEnum<{
            load: "load";
            domcontentloaded: "domcontentloaded";
            networkidle: "networkidle";
        }>>;
        timeout: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const PageIdParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
}, z.core.$strict>;
export declare const MouseButtonSchema: z.ZodEnum<{
    left: "left";
    right: "right";
    middle: "middle";
}>;
export declare const PageReloadParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    options: z.ZodOptional<z.ZodObject<{
        waitUntil: z.ZodOptional<z.ZodEnum<{
            load: "load";
            domcontentloaded: "domcontentloaded";
            networkidle: "networkidle";
        }>>;
        timeout: z.ZodOptional<z.ZodNumber>;
        ignoreCache: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const PageGoBackParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    options: z.ZodOptional<z.ZodObject<{
        waitUntil: z.ZodOptional<z.ZodEnum<{
            load: "load";
            domcontentloaded: "domcontentloaded";
            networkidle: "networkidle";
        }>>;
        timeout: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const PageGoForwardParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    options: z.ZodOptional<z.ZodObject<{
        waitUntil: z.ZodOptional<z.ZodEnum<{
            load: "load";
            domcontentloaded: "domcontentloaded";
            networkidle: "networkidle";
        }>>;
        timeout: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const PageClickParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    options: z.ZodOptional<z.ZodObject<{
        button: z.ZodOptional<z.ZodEnum<{
            left: "left";
            right: "right";
            middle: "middle";
        }>>;
        clickCount: z.ZodOptional<z.ZodNumber>;
        returnXpath: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const PageHoverParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    options: z.ZodOptional<z.ZodObject<{
        returnXpath: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const PageScrollParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    deltaX: z.ZodNumber;
    deltaY: z.ZodNumber;
    options: z.ZodOptional<z.ZodObject<{
        returnXpath: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const PageDragAndDropParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    fromX: z.ZodNumber;
    fromY: z.ZodNumber;
    toX: z.ZodNumber;
    toY: z.ZodNumber;
    options: z.ZodOptional<z.ZodObject<{
        button: z.ZodOptional<z.ZodEnum<{
            left: "left";
            right: "right";
            middle: "middle";
        }>>;
        steps: z.ZodOptional<z.ZodNumber>;
        delay: z.ZodOptional<z.ZodNumber>;
        returnXpath: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const PageTypeParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    text: z.ZodString;
    options: z.ZodOptional<z.ZodObject<{
        delay: z.ZodOptional<z.ZodNumber>;
        withMistakes: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const PageKeyPressParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    key: z.ZodString;
    options: z.ZodOptional<z.ZodObject<{
        delay: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const PageEvaluateParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    expression: z.ZodString;
}, z.core.$strict>;
export declare const PageAddInitScriptParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    source: z.ZodString;
}, z.core.$strict>;
export declare const PageSetExtraHTTPHeadersParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    headers: z.ZodRecord<z.ZodString, z.ZodString>;
}, z.core.$strict>;
export declare const PageScreenshotOptionsSchema: z.ZodObject<{
    animations: z.ZodOptional<z.ZodEnum<{
        disabled: "disabled";
        allow: "allow";
    }>>;
    caret: z.ZodOptional<z.ZodEnum<{
        hide: "hide";
        initial: "initial";
    }>>;
    clip: z.ZodOptional<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        width: z.ZodNumber;
        height: z.ZodNumber;
    }, z.core.$strict>>;
    fullPage: z.ZodOptional<z.ZodBoolean>;
    mask: z.ZodOptional<z.ZodArray<z.ZodObject<{
        pageId: z.ZodString;
        selector: z.ZodString;
        nth: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>>;
    maskColor: z.ZodOptional<z.ZodString>;
    omitBackground: z.ZodOptional<z.ZodBoolean>;
    quality: z.ZodOptional<z.ZodNumber>;
    scale: z.ZodOptional<z.ZodEnum<{
        css: "css";
        device: "device";
    }>>;
    style: z.ZodOptional<z.ZodString>;
    timeout: z.ZodOptional<z.ZodNumber>;
    type: z.ZodOptional<z.ZodEnum<{
        png: "png";
        jpeg: "jpeg";
    }>>;
}, z.core.$strict>;
export declare const PageScreenshotParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    options: z.ZodOptional<z.ZodObject<{
        animations: z.ZodOptional<z.ZodEnum<{
            disabled: "disabled";
            allow: "allow";
        }>>;
        caret: z.ZodOptional<z.ZodEnum<{
            hide: "hide";
            initial: "initial";
        }>>;
        clip: z.ZodOptional<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            width: z.ZodNumber;
            height: z.ZodNumber;
        }, z.core.$strict>>;
        fullPage: z.ZodOptional<z.ZodBoolean>;
        mask: z.ZodOptional<z.ZodArray<z.ZodObject<{
            pageId: z.ZodString;
            selector: z.ZodString;
            nth: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>>;
        maskColor: z.ZodOptional<z.ZodString>;
        omitBackground: z.ZodOptional<z.ZodBoolean>;
        quality: z.ZodOptional<z.ZodNumber>;
        scale: z.ZodOptional<z.ZodEnum<{
            css: "css";
            device: "device";
        }>>;
        style: z.ZodOptional<z.ZodString>;
        timeout: z.ZodOptional<z.ZodNumber>;
        type: z.ZodOptional<z.ZodEnum<{
            png: "png";
            jpeg: "jpeg";
        }>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const PageSnapshotParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    options: z.ZodOptional<z.ZodObject<{
        includeIframes: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const PageSetViewportSizeParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    width: z.ZodNumber;
    height: z.ZodNumber;
    options: z.ZodOptional<z.ZodObject<{
        deviceScaleFactor: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const PageWaitForLoadStateParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    state: z.ZodEnum<{
        load: "load";
        domcontentloaded: "domcontentloaded";
        networkidle: "networkidle";
    }>;
    timeout: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const PageWaitForTimeoutParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    ms: z.ZodNumber;
}, z.core.$strict>;
export declare const PageWaitForSelectorParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    selector: z.ZodString;
    options: z.ZodOptional<z.ZodObject<{
        state: z.ZodOptional<z.ZodEnum<{
            attached: "attached";
            detached: "detached";
            visible: "visible";
            hidden: "hidden";
        }>>;
        timeout: z.ZodOptional<z.ZodNumber>;
        pierceShadow: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const LocatorClickParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    selector: z.ZodString;
    nth: z.ZodOptional<z.ZodNumber>;
    options: z.ZodOptional<z.ZodObject<{
        button: z.ZodOptional<z.ZodEnum<{
            left: "left";
            right: "right";
            middle: "middle";
        }>>;
        clickCount: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const LocatorFillParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    selector: z.ZodString;
    nth: z.ZodOptional<z.ZodNumber>;
    value: z.ZodString;
}, z.core.$strict>;
export declare const LocatorScrollToParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    selector: z.ZodString;
    nth: z.ZodOptional<z.ZodNumber>;
    percent: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>;
export declare const RgbaColorSchema: z.ZodObject<{
    r: z.ZodNumber;
    g: z.ZodNumber;
    b: z.ZodNumber;
    a: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const LocatorHighlightParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    selector: z.ZodString;
    nth: z.ZodOptional<z.ZodNumber>;
    options: z.ZodOptional<z.ZodObject<{
        durationMs: z.ZodOptional<z.ZodNumber>;
        borderColor: z.ZodOptional<z.ZodObject<{
            r: z.ZodNumber;
            g: z.ZodNumber;
            b: z.ZodNumber;
            a: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        contentColor: z.ZodOptional<z.ZodObject<{
            r: z.ZodNumber;
            g: z.ZodNumber;
            b: z.ZodNumber;
            a: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const LocatorSendClickEventParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    selector: z.ZodString;
    nth: z.ZodOptional<z.ZodNumber>;
    options: z.ZodOptional<z.ZodObject<{
        bubbles: z.ZodOptional<z.ZodBoolean>;
        cancelable: z.ZodOptional<z.ZodBoolean>;
        composed: z.ZodOptional<z.ZodBoolean>;
        detail: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const LocatorTypeParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    selector: z.ZodString;
    nth: z.ZodOptional<z.ZodNumber>;
    text: z.ZodString;
    options: z.ZodOptional<z.ZodObject<{
        delay: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const LocatorSelectOptionParamsSchema: z.ZodObject<{
    pageId: z.ZodString;
    selector: z.ZodString;
    nth: z.ZodOptional<z.ZodNumber>;
    values: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>;
}, z.core.$strict>;
export declare const StagehandPingResultSchema: z.ZodObject<{
    ok: z.ZodLiteral<true>;
    runtime: z.ZodLiteral<"service_worker">;
}, z.core.$strict>;
export declare const RuntimeConfigureResultSchema: z.ZodObject<{
    configured: z.ZodLiteral<true>;
}, z.core.$strict>;
export declare const RuntimeLoopbackStatusResultSchema: z.ZodObject<{
    configured: z.ZodBoolean;
    connected: z.ZodBoolean;
}, z.core.$strict>;
export declare const BrowserGetVersionResultSchema: z.ZodObject<{
    protocolVersion: z.ZodOptional<z.ZodString>;
    product: z.ZodOptional<z.ZodString>;
    revision: z.ZodOptional<z.ZodString>;
    userAgent: z.ZodOptional<z.ZodString>;
    jsVersion: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const StagehandInitResultSchema: z.ZodObject<{
    initialized: z.ZodLiteral<true>;
    pages: z.ZodArray<z.ZodObject<{
        pageId: z.ZodString;
        url: z.ZodOptional<z.ZodString>;
        title: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const StagehandCloseResultSchema: z.ZodObject<{
    closed: z.ZodLiteral<true>;
}, z.core.$strict>;
export declare const ContextPagesResultSchema: z.ZodArray<z.ZodObject<{
    pageId: z.ZodString;
    url: z.ZodOptional<z.ZodString>;
    title: z.ZodOptional<z.ZodString>;
}, z.core.$strict>>;
export declare const ContextActivePageResultSchema: z.ZodNullable<z.ZodObject<{
    pageId: z.ZodString;
    url: z.ZodOptional<z.ZodString>;
    title: z.ZodOptional<z.ZodString>;
}, z.core.$strict>>;
export declare const ContextGetDomainPolicyResultSchema: z.ZodObject<{
    policy: z.ZodNullable<z.ZodObject<{
        allowedDomains: z.ZodOptional<z.ZodArray<z.ZodString>>;
        blockedDomains: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const ContextCookiesResultSchema: z.ZodObject<{
    cookies: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        value: z.ZodString;
        domain: z.ZodString;
        path: z.ZodString;
        expires: z.ZodNumber;
        httpOnly: z.ZodBoolean;
        secure: z.ZodBoolean;
        sameSite: z.ZodEnum<{
            Strict: "Strict";
            Lax: "Lax";
            None: "None";
        }>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const ContextClipboardReadTextResultSchema: z.ZodObject<{
    text: z.ZodString;
}, z.core.$strict>;
export declare const PageUrlResultSchema: z.ZodObject<{
    url: z.ZodString;
}, z.core.$strict>;
export declare const PageTitleResultSchema: z.ZodObject<{
    title: z.ZodString;
}, z.core.$strict>;
export declare const PageCloseResultSchema: z.ZodObject<{
    closed: z.ZodLiteral<true>;
}, z.core.$strict>;
export declare const PageDragAndDropResultSchema: z.ZodObject<{
    fromXpath: z.ZodString;
    toXpath: z.ZodString;
}, z.core.$strict>;
export declare const PageEvaluateResultSchema: z.ZodObject<{
    value: z.ZodJSONSchema;
}, z.core.$strict>;
export declare const PageScreenshotResultSchema: z.ZodObject<{
    data: z.ZodBase64;
    type: z.ZodEnum<{
        png: "png";
        jpeg: "jpeg";
    }>;
}, z.core.$strict>;
export declare const PageWaitForSelectorResultSchema: z.ZodObject<{
    matched: z.ZodBoolean;
}, z.core.$strict>;
export declare const LocatorClickResultSchema: z.ZodObject<{
    clicked: z.ZodLiteral<true>;
}, z.core.$strict>;
export declare const LocatorFillResultSchema: z.ZodObject<{
    filled: z.ZodLiteral<true>;
}, z.core.$strict>;
export declare const LocatorHoverResultSchema: z.ZodObject<{
    hovered: z.ZodLiteral<true>;
}, z.core.$strict>;
export declare const LocatorCountResultSchema: z.ZodObject<{
    count: z.ZodNumber;
}, z.core.$strict>;
export declare const LocatorIsCheckedResultSchema: z.ZodObject<{
    checked: z.ZodBoolean;
}, z.core.$strict>;
export declare const LocatorInputValueResultSchema: z.ZodObject<{
    value: z.ZodString;
}, z.core.$strict>;
export declare const LocatorIsVisibleResultSchema: z.ZodObject<{
    visible: z.ZodBoolean;
}, z.core.$strict>;
export declare const LocatorInnerTextResultSchema: z.ZodObject<{
    text: z.ZodString;
}, z.core.$strict>;
export declare const LocatorInnerHtmlResultSchema: z.ZodObject<{
    html: z.ZodString;
}, z.core.$strict>;
export declare const LocatorTextContentResultSchema: z.ZodObject<{
    textContent: z.ZodString;
}, z.core.$strict>;
export declare const LocatorScrollToResultSchema: z.ZodObject<{
    scrolled: z.ZodLiteral<true>;
}, z.core.$strict>;
export declare const LocatorCentroidResultSchema: z.ZodObject<{
    x: z.ZodNumber;
    y: z.ZodNumber;
}, z.core.$strict>;
export declare const LocatorHighlightResultSchema: z.ZodObject<{
    highlighted: z.ZodLiteral<true>;
}, z.core.$strict>;
export declare const LocatorSendClickEventResultSchema: z.ZodObject<{
    clicked: z.ZodLiteral<true>;
}, z.core.$strict>;
export declare const LocatorTypeResultSchema: z.ZodObject<{
    typed: z.ZodLiteral<true>;
}, z.core.$strict>;
export declare const LocatorSelectOptionResultSchema: z.ZodObject<{
    values: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const StagehandLogLevelSchema: z.ZodEnum<{
    error: "error";
    debug: "debug";
    info: "info";
    warn: "warn";
}>;
export declare const StagehandLogDataSchema: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
export declare const StagehandLogSchema: z.ZodObject<{
    level: z.ZodEnum<{
        error: "error";
        debug: "debug";
        info: "info";
        warn: "warn";
    }>;
    message: z.ZodString;
    data: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
}, z.core.$strict>;
export {};
