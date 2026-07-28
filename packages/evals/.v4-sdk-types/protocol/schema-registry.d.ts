import { z } from "zod/v4";
import { type RPCMethod } from "./json-rpc/schemas.ts";
export declare const STAGEHAND_SEND_TO_HOST_BINDING = "__stagehandSendToHost";
export declare const StagehandSendToHostBindingSchema: z.ZodLiteral<"__stagehandSendToHost">;
export declare const StagehandMethods: {
    readonly ping: {
        readonly name: "ping";
        readonly params: z.ZodObject<{}, z.core.$strict>;
        readonly result: z.ZodObject<{
            ok: z.ZodLiteral<true>;
            runtime: z.ZodLiteral<"service_worker">;
        }, z.core.$strict>;
    };
    readonly runtimeConfigure: {
        readonly name: "runtime.configure";
        readonly params: z.ZodObject<{
            cdpUrl: z.ZodString;
            telemetry: z.ZodDefault<z.ZodObject<{
                traces: z.ZodObject<{
                    endpoint: z.ZodURL;
                    headers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
                }, z.core.$strict>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            configured: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly runtimeLoopbackStatus: {
        readonly name: "runtime.loopback_status";
        readonly params: z.ZodObject<{}, z.core.$strict>;
        readonly result: z.ZodObject<{
            configured: z.ZodBoolean;
            connected: z.ZodBoolean;
        }, z.core.$strict>;
    };
    readonly browserGetVersion: {
        readonly name: "browser.get_version";
        readonly params: z.ZodObject<{}, z.core.$strict>;
        readonly result: z.ZodObject<{
            protocolVersion: z.ZodOptional<z.ZodString>;
            product: z.ZodOptional<z.ZodString>;
            revision: z.ZodOptional<z.ZodString>;
            userAgent: z.ZodOptional<z.ZodString>;
            jsVersion: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
    };
    readonly stagehandInit: {
        readonly name: "stagehand.init";
        readonly params: z.ZodObject<{
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
        readonly result: z.ZodObject<{
            initialized: z.ZodLiteral<true>;
            pages: z.ZodArray<z.ZodObject<{
                pageId: z.ZodString;
                url: z.ZodOptional<z.ZodString>;
                title: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
    };
    readonly stagehandClose: {
        readonly name: "stagehand.close";
        readonly params: z.ZodObject<{}, z.core.$strict>;
        readonly result: z.ZodObject<{
            closed: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly stagehandAct: {
        readonly name: "stagehand.act";
        readonly params: z.ZodObject<{
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
        readonly result: z.ZodObject<{
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
    };
    readonly stagehandObserve: {
        readonly name: "stagehand.observe";
        readonly params: z.ZodObject<{
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
        readonly result: z.ZodObject<{
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
    };
    readonly stagehandExtract: {
        readonly name: "stagehand.extract";
        readonly params: z.ZodObject<{
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
        readonly result: z.ZodObject<{
            result: z.ZodUnknown;
            actionId: z.ZodOptional<z.ZodString>;
            cacheStatus: z.ZodOptional<z.ZodEnum<{
                HIT: "HIT";
                MISS: "MISS";
            }>>;
        }, z.core.$strip>;
        readonly paramsWire: {
            readonly opaqueKeys: readonly ["schema"];
        };
        readonly resultWire: {
            readonly opaqueKeys: readonly ["result"];
        };
    };
    readonly stagehandMetrics: {
        readonly name: "stagehand.metrics";
        readonly params: z.ZodObject<{}, z.core.$strict>;
        readonly result: z.ZodObject<{
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
    };
    readonly llmGenerate: {
        readonly name: "llm.generate";
        readonly params: z.ZodUnion<readonly [z.ZodObject<{
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
        readonly result: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
        readonly paramsWire: {
            readonly opaqueKeys: readonly ["inputSchema", "outputSchema", "input", "structuredContent", "schema"];
        };
        readonly resultWire: {
            readonly opaqueKeys: readonly ["structuredContent"];
        };
    };
    readonly contextPages: {
        readonly name: "context.pages";
        readonly params: z.ZodObject<{}, z.core.$strict>;
        readonly result: z.ZodArray<z.ZodObject<{
            pageId: z.ZodString;
            url: z.ZodOptional<z.ZodString>;
            title: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    };
    readonly contextNewPage: {
        readonly name: "context.new_page";
        readonly params: z.ZodObject<{
            url: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            pageId: z.ZodString;
            url: z.ZodOptional<z.ZodString>;
            title: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
    };
    readonly contextActivePage: {
        readonly name: "context.active_page";
        readonly params: z.ZodObject<{}, z.core.$strict>;
        readonly result: z.ZodNullable<z.ZodObject<{
            pageId: z.ZodString;
            url: z.ZodOptional<z.ZodString>;
            title: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    };
    readonly contextSetActivePage: {
        readonly name: "context.set_active_page";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            ok: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly contextClose: {
        readonly name: "context.close";
        readonly params: z.ZodObject<{}, z.core.$strict>;
        readonly result: z.ZodObject<{
            closed: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly contextAddInitScript: {
        readonly name: "context.add_init_script";
        readonly params: z.ZodObject<{
            source: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            ok: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly contextSetExtraHTTPHeaders: {
        readonly name: "context.set_extra_http_headers";
        readonly params: z.ZodObject<{
            headers: z.ZodRecord<z.ZodString, z.ZodString>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            ok: z.ZodLiteral<true>;
        }, z.core.$strict>;
        readonly paramsWire: {
            readonly opaqueKeys: readonly ["headers"];
        };
    };
    readonly contextGetDomainPolicy: {
        readonly name: "context.get_domain_policy";
        readonly params: z.ZodObject<{}, z.core.$strict>;
        readonly result: z.ZodObject<{
            policy: z.ZodNullable<z.ZodObject<{
                allowedDomains: z.ZodOptional<z.ZodArray<z.ZodString>>;
                blockedDomains: z.ZodOptional<z.ZodArray<z.ZodString>>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
    };
    readonly contextSetDomainPolicy: {
        readonly name: "context.set_domain_policy";
        readonly params: z.ZodObject<{
            policy: z.ZodNullable<z.ZodObject<{
                allowedDomains: z.ZodOptional<z.ZodArray<z.ZodString>>;
                blockedDomains: z.ZodOptional<z.ZodArray<z.ZodString>>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            ok: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly contextCookies: {
        readonly name: "context.cookies";
        readonly params: z.ZodObject<{
            urls: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
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
    };
    readonly contextAddCookies: {
        readonly name: "context.add_cookies";
        readonly params: z.ZodObject<{
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
        readonly result: z.ZodObject<{
            ok: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly contextClearCookies: {
        readonly name: "context.clear_cookies";
        readonly params: z.ZodObject<{
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
        readonly result: z.ZodObject<{
            ok: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly contextClipboardReadText: {
        readonly name: "context.clipboard_read_text";
        readonly params: z.ZodObject<{
            pageId: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            text: z.ZodString;
        }, z.core.$strict>;
    };
    readonly contextClipboardWriteText: {
        readonly name: "context.clipboard_write_text";
        readonly params: z.ZodObject<{
            pageId: z.ZodOptional<z.ZodString>;
            text: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            ok: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly contextClipboardClear: {
        readonly name: "context.clipboard_clear";
        readonly params: z.ZodObject<{
            pageId: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            ok: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly contextClipboardPaste: {
        readonly name: "context.clipboard_paste";
        readonly params: z.ZodObject<{
            pageId: z.ZodOptional<z.ZodString>;
            shortcut: z.ZodOptional<z.ZodEnum<{
                "ControlOrMeta+V": "ControlOrMeta+V";
                "Meta+V": "Meta+V";
                "Control+V": "Control+V";
            }>>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            ok: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly contextClipboardCopy: {
        readonly name: "context.clipboard_copy";
        readonly params: z.ZodObject<{
            pageId: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            ok: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly contextClipboardCut: {
        readonly name: "context.clipboard_cut";
        readonly params: z.ZodObject<{
            pageId: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            ok: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly pageGoto: {
        readonly name: "page.goto";
        readonly params: z.ZodObject<{
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
        readonly result: z.ZodObject<{
            pageId: z.ZodString;
            url: z.ZodOptional<z.ZodString>;
            title: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
    };
    readonly pageUrl: {
        readonly name: "page.url";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            url: z.ZodString;
        }, z.core.$strict>;
    };
    readonly pageTitle: {
        readonly name: "page.title";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            title: z.ZodString;
        }, z.core.$strict>;
    };
    readonly pageClose: {
        readonly name: "page.close";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            closed: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly pageReload: {
        readonly name: "page.reload";
        readonly params: z.ZodObject<{
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
        readonly result: z.ZodObject<{
            pageId: z.ZodString;
            url: z.ZodOptional<z.ZodString>;
            title: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
    };
    readonly pageGoBack: {
        readonly name: "page.go_back";
        readonly params: z.ZodObject<{
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
        readonly result: z.ZodObject<{
            pageId: z.ZodString;
            url: z.ZodOptional<z.ZodString>;
            title: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
    };
    readonly pageGoForward: {
        readonly name: "page.go_forward";
        readonly params: z.ZodObject<{
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
        readonly result: z.ZodObject<{
            pageId: z.ZodString;
            url: z.ZodOptional<z.ZodString>;
            title: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
    };
    readonly pageClick: {
        readonly name: "page.click";
        readonly params: z.ZodObject<{
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
        readonly result: z.ZodObject<{
            xpath: z.ZodString;
        }, z.core.$strict>;
    };
    readonly pageHover: {
        readonly name: "page.hover";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            x: z.ZodNumber;
            y: z.ZodNumber;
            options: z.ZodOptional<z.ZodObject<{
                returnXpath: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            xpath: z.ZodString;
        }, z.core.$strict>;
    };
    readonly pageScroll: {
        readonly name: "page.scroll";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            x: z.ZodNumber;
            y: z.ZodNumber;
            deltaX: z.ZodNumber;
            deltaY: z.ZodNumber;
            options: z.ZodOptional<z.ZodObject<{
                returnXpath: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            xpath: z.ZodString;
        }, z.core.$strict>;
    };
    readonly pageDragAndDrop: {
        readonly name: "page.drag_and_drop";
        readonly params: z.ZodObject<{
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
        readonly result: z.ZodObject<{
            fromXpath: z.ZodString;
            toXpath: z.ZodString;
        }, z.core.$strict>;
    };
    readonly pageType: {
        readonly name: "page.type";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            text: z.ZodString;
            options: z.ZodOptional<z.ZodObject<{
                delay: z.ZodOptional<z.ZodNumber>;
                withMistakes: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            ok: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly pageKeyPress: {
        readonly name: "page.key_press";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            key: z.ZodString;
            options: z.ZodOptional<z.ZodObject<{
                delay: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            ok: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly pageEvaluate: {
        readonly name: "page.evaluate";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            expression: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            value: z.ZodJSONSchema;
        }, z.core.$strict>;
        readonly resultWire: {
            readonly opaqueKeys: readonly ["value"];
        };
    };
    readonly pageAddInitScript: {
        readonly name: "page.add_init_script";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            source: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            ok: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly pageSetExtraHTTPHeaders: {
        readonly name: "page.set_extra_http_headers";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            headers: z.ZodRecord<z.ZodString, z.ZodString>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            ok: z.ZodLiteral<true>;
        }, z.core.$strict>;
        readonly paramsWire: {
            readonly opaqueKeys: readonly ["headers"];
        };
    };
    readonly pageScreenshot: {
        readonly name: "page.screenshot";
        readonly params: z.ZodObject<{
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
        readonly result: z.ZodObject<{
            data: z.ZodBase64;
            type: z.ZodEnum<{
                png: "png";
                jpeg: "jpeg";
            }>;
        }, z.core.$strict>;
    };
    readonly pageSnapshot: {
        readonly name: "page.snapshot";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            options: z.ZodOptional<z.ZodObject<{
                includeIframes: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            formattedTree: z.ZodString;
            xpathMap: z.ZodRecord<z.ZodString, z.ZodString>;
            urlMap: z.ZodRecord<z.ZodString, z.ZodString>;
        }, z.core.$strict>;
        readonly resultWire: {
            readonly opaqueKeys: readonly ["xpathMap", "urlMap"];
        };
    };
    readonly pageSetViewportSize: {
        readonly name: "page.set_viewport_size";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            width: z.ZodNumber;
            height: z.ZodNumber;
            options: z.ZodOptional<z.ZodObject<{
                deviceScaleFactor: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            ok: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly pageWaitForLoadState: {
        readonly name: "page.wait_for_load_state";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            state: z.ZodEnum<{
                load: "load";
                domcontentloaded: "domcontentloaded";
                networkidle: "networkidle";
            }>;
            timeout: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            ok: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly pageWaitForTimeout: {
        readonly name: "page.wait_for_timeout";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            ms: z.ZodNumber;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            ok: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly pageWaitForSelector: {
        readonly name: "page.wait_for_selector";
        readonly params: z.ZodObject<{
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
        readonly result: z.ZodObject<{
            matched: z.ZodBoolean;
        }, z.core.$strict>;
    };
    readonly locatorClick: {
        readonly name: "locator.click";
        readonly params: z.ZodObject<{
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
        readonly result: z.ZodObject<{
            clicked: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly locatorFill: {
        readonly name: "locator.fill";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            selector: z.ZodString;
            nth: z.ZodOptional<z.ZodNumber>;
            value: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            filled: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly locatorHover: {
        readonly name: "locator.hover";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            selector: z.ZodString;
            nth: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            hovered: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly locatorCount: {
        readonly name: "locator.count";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            selector: z.ZodString;
            nth: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            count: z.ZodNumber;
        }, z.core.$strict>;
    };
    readonly locatorIsChecked: {
        readonly name: "locator.is_checked";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            selector: z.ZodString;
            nth: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            checked: z.ZodBoolean;
        }, z.core.$strict>;
    };
    readonly locatorInputValue: {
        readonly name: "locator.input_value";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            selector: z.ZodString;
            nth: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            value: z.ZodString;
        }, z.core.$strict>;
    };
    readonly locatorIsVisible: {
        readonly name: "locator.is_visible";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            selector: z.ZodString;
            nth: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            visible: z.ZodBoolean;
        }, z.core.$strict>;
    };
    readonly locatorInnerText: {
        readonly name: "locator.inner_text";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            selector: z.ZodString;
            nth: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            text: z.ZodString;
        }, z.core.$strict>;
    };
    readonly locatorInnerHtml: {
        readonly name: "locator.inner_html";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            selector: z.ZodString;
            nth: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            html: z.ZodString;
        }, z.core.$strict>;
    };
    readonly locatorTextContent: {
        readonly name: "locator.text_content";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            selector: z.ZodString;
            nth: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            textContent: z.ZodString;
        }, z.core.$strict>;
    };
    readonly locatorScrollTo: {
        readonly name: "locator.scroll_to";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            selector: z.ZodString;
            nth: z.ZodOptional<z.ZodNumber>;
            percent: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            scrolled: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly locatorCentroid: {
        readonly name: "locator.centroid";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            selector: z.ZodString;
            nth: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, z.core.$strict>;
    };
    readonly locatorHighlight: {
        readonly name: "locator.highlight";
        readonly params: z.ZodObject<{
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
        readonly result: z.ZodObject<{
            highlighted: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly locatorSendClickEvent: {
        readonly name: "locator.send_click_event";
        readonly params: z.ZodObject<{
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
        readonly result: z.ZodObject<{
            clicked: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly locatorType: {
        readonly name: "locator.type";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            selector: z.ZodString;
            nth: z.ZodOptional<z.ZodNumber>;
            text: z.ZodString;
            options: z.ZodOptional<z.ZodObject<{
                delay: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            typed: z.ZodLiteral<true>;
        }, z.core.$strict>;
    };
    readonly locatorSelectOption: {
        readonly name: "locator.select_option";
        readonly params: z.ZodObject<{
            pageId: z.ZodString;
            selector: z.ZodString;
            nth: z.ZodOptional<z.ZodNumber>;
            values: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            values: z.ZodArray<z.ZodString>;
        }, z.core.$strict>;
    };
};
export declare const StagehandMethodSchema: z.ZodEnum<{
    ping: "ping";
    "runtime.configure": "runtime.configure";
    "runtime.loopback_status": "runtime.loopback_status";
    "browser.get_version": "browser.get_version";
    "stagehand.init": "stagehand.init";
    "stagehand.close": "stagehand.close";
    "stagehand.act": "stagehand.act";
    "stagehand.observe": "stagehand.observe";
    "stagehand.extract": "stagehand.extract";
    "stagehand.metrics": "stagehand.metrics";
    "llm.generate": "llm.generate";
    "context.pages": "context.pages";
    "context.new_page": "context.new_page";
    "context.active_page": "context.active_page";
    "context.set_active_page": "context.set_active_page";
    "context.close": "context.close";
    "context.add_init_script": "context.add_init_script";
    "context.set_extra_http_headers": "context.set_extra_http_headers";
    "context.get_domain_policy": "context.get_domain_policy";
    "context.set_domain_policy": "context.set_domain_policy";
    "context.cookies": "context.cookies";
    "context.add_cookies": "context.add_cookies";
    "context.clear_cookies": "context.clear_cookies";
    "context.clipboard_read_text": "context.clipboard_read_text";
    "context.clipboard_write_text": "context.clipboard_write_text";
    "context.clipboard_clear": "context.clipboard_clear";
    "context.clipboard_paste": "context.clipboard_paste";
    "context.clipboard_copy": "context.clipboard_copy";
    "context.clipboard_cut": "context.clipboard_cut";
    "page.goto": "page.goto";
    "page.url": "page.url";
    "page.title": "page.title";
    "page.close": "page.close";
    "page.reload": "page.reload";
    "page.go_back": "page.go_back";
    "page.go_forward": "page.go_forward";
    "page.click": "page.click";
    "page.hover": "page.hover";
    "page.scroll": "page.scroll";
    "page.drag_and_drop": "page.drag_and_drop";
    "page.type": "page.type";
    "page.key_press": "page.key_press";
    "page.evaluate": "page.evaluate";
    "page.add_init_script": "page.add_init_script";
    "page.set_extra_http_headers": "page.set_extra_http_headers";
    "page.screenshot": "page.screenshot";
    "page.snapshot": "page.snapshot";
    "page.set_viewport_size": "page.set_viewport_size";
    "page.wait_for_load_state": "page.wait_for_load_state";
    "page.wait_for_timeout": "page.wait_for_timeout";
    "page.wait_for_selector": "page.wait_for_selector";
    "locator.click": "locator.click";
    "locator.fill": "locator.fill";
    "locator.hover": "locator.hover";
    "locator.count": "locator.count";
    "locator.is_checked": "locator.is_checked";
    "locator.input_value": "locator.input_value";
    "locator.is_visible": "locator.is_visible";
    "locator.inner_text": "locator.inner_text";
    "locator.inner_html": "locator.inner_html";
    "locator.text_content": "locator.text_content";
    "locator.scroll_to": "locator.scroll_to";
    "locator.centroid": "locator.centroid";
    "locator.highlight": "locator.highlight";
    "locator.send_click_event": "locator.send_click_event";
    "locator.type": "locator.type";
    "locator.select_option": "locator.select_option";
}>;
export declare const StagehandRpcRequestSchema: z.ZodUnion<[z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodInt;
    traceparent: z.ZodOptional<z.ZodString>;
    tracestate: z.ZodOptional<z.ZodString>;
    method: z.ZodLiteral<string>;
    params: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
}, z.core.$strict>, ...z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodInt;
    traceparent: z.ZodOptional<z.ZodString>;
    tracestate: z.ZodOptional<z.ZodString>;
    method: z.ZodLiteral<string>;
    params: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
}, z.core.$strict>[]]>;
export declare const StagehandNotifications: {
    readonly log: {
        readonly name: "stagehand.log";
        readonly params: z.ZodObject<{
            level: z.ZodEnum<{
                error: "error";
                debug: "debug";
                info: "info";
                warn: "warn";
            }>;
            message: z.ZodString;
            data: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
        }, z.core.$strict>;
    };
};
export declare const StagehandRpcNotificationSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    method: z.ZodLiteral<"stagehand.log">;
    params: z.ZodObject<{
        level: z.ZodEnum<{
            error: "error";
            debug: "debug";
            info: "info";
            warn: "warn";
        }>;
        message: z.ZodString;
        data: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare function getStagehandMethod(name: string): RPCMethod | undefined;
