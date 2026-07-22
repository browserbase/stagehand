import fs from "node:fs";
import path from "node:path";

export const STAGEHAND_V4_SDK_PATH_ENV = "STAGEHAND_V4_SDK_PATH";
export const ANTHROPIC_DIRECT_BROWSER_ACCESS_HEADER =
  "anthropic-dangerous-direct-browser-access";

export type V4CodeMode = "deterministic" | "ai";

export interface V4CodeModelConfig {
  modelName: string;
  apiKey: string;
  headers?: Record<string, string>;
}

const PROVIDER_API_KEY_ENV = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
  groq: ["GROQ_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
} as const;

type V4ModelProvider = keyof typeof PROVIDER_API_KEY_ENV;

export function resolveV4SdkPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[STAGEHAND_V4_SDK_PATH_ENV]?.trim();
  if (!configured) {
    throw new Error(
      `${STAGEHAND_V4_SDK_PATH_ENV} must point to the V4 TypeScript SDK entry file.`,
    );
  }

  const resolved = path.resolve(configured);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(
      `${STAGEHAND_V4_SDK_PATH_ENV} does not point to a file: ${resolved}`,
    );
  }
  return resolved;
}

export function normalizeV4ModelName(modelName: string): string {
  const value = modelName.trim();
  if (!value) throw new Error("v4_code requires a non-empty harness model.");

  const slash = value.indexOf("/");
  if (slash > 0) {
    const provider = value.slice(0, slash);
    requireV4ModelProvider(provider, value);
    return value;
  }

  const provider = inferV4ModelProvider(value);
  if (!provider) {
    throw new Error(
      `v4_code cannot infer a V4 model provider for harness model "${value}". Use a provider-prefixed model such as "anthropic/claude-sonnet-5".`,
    );
  }
  return `${provider}/${value}`;
}

export function resolveV4CodeModelConfig(
  harnessModel: string,
  env: NodeJS.ProcessEnv = process.env,
): V4CodeModelConfig {
  const modelName = normalizeV4ModelName(harnessModel);
  const provider = requireV4ModelProvider(
    modelName.slice(0, modelName.indexOf("/")),
    modelName,
  );
  const keyNames = PROVIDER_API_KEY_ENV[provider];
  const apiKey = keyNames
    .map((keyName) => env[keyName]?.trim())
    .find((value): value is string => Boolean(value));
  if (!apiKey) {
    throw new Error(
      `v4_code requires ${keyNames.join(" or ")} for model "${modelName}".`,
    );
  }

  return {
    modelName,
    apiKey,
    ...(provider === "anthropic"
      ? {
          headers: {
            [ANTHROPIC_DIRECT_BROWSER_ACCESS_HEADER]: "true",
          },
        }
      : {}),
  };
}

function inferV4ModelProvider(modelName: string): V4ModelProvider | undefined {
  if (modelName.startsWith("claude-")) return "anthropic";
  if (modelName.startsWith("gpt-") || /^o\d(?:-|$)/.test(modelName)) {
    return "openai";
  }
  if (modelName.startsWith("gemini-") || modelName.startsWith("gemma-")) {
    return "google";
  }
  return undefined;
}

function requireV4ModelProvider(
  provider: string,
  modelName: string,
): V4ModelProvider {
  if (provider in PROVIDER_API_KEY_ENV) return provider as V4ModelProvider;
  throw new Error(
    `v4_code does not support provider "${provider}" from harness model "${modelName}". Supported providers: ${Object.keys(PROVIDER_API_KEY_ENV).join(", ")}.`,
  );
}
