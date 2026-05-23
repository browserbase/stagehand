import fs from "node:fs";
import { EvalsError } from "../errors.js";
import { toClawBenchStagehandModelName } from "./apiTypes.js";
import { resolveClawBenchModelsYaml } from "./paths.js";
import type { ClawBenchModelConfig } from "./types.js";

const DEFAULT_AGENT_MODEL = "deepseek-v4-flash";
const DEFAULT_JUDGE_MODEL = "deepseek-v4-pro";
const SUPPORTED_API_TYPES = [
  "anthropic-messages",
  "openai-responses",
  "openai-completions",
  "google-generative-ai",
] as const;

function isSupportedApiType(
  value: unknown,
): value is ClawBenchModelConfig["api_type"] {
  return (
    typeof value === "string" &&
    (SUPPORTED_API_TYPES as readonly string[]).includes(value)
  );
}

function parseScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((part) => String(parseScalar(part)))
      .filter(Boolean);
  }
  return trimmed;
}

function parseSimpleModelsYaml(content: string): Record<string, unknown> {
  const models: Record<string, Record<string, unknown>> = {};
  let current: string | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "");
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    const top = line.match(/^([A-Za-z0-9_./:-]+):\s*$/);
    if (top) {
      current = top[1];
      models[current] = {};
      continue;
    }

    const prop = line.match(/^\s+([A-Za-z0-9_./:-]+):\s*(.*?)\s*$/);
    if (prop && current) {
      models[current][prop[1]] = parseScalar(prop[2]);
    }
  }

  return models;
}

function readModelsFile(): Record<string, unknown> {
  const modelsYaml = resolveClawBenchModelsYaml();
  if (!fs.existsSync(modelsYaml)) {
    throw new EvalsError(
      `ClawBench models file not found at ${modelsYaml}. Set EVAL_CLAWBENCH_MODELS_YAML to your ClawBench models/models.yaml.`,
    );
  }
  return parseSimpleModelsYaml(fs.readFileSync(modelsYaml, "utf-8"));
}

function normalizeModelConfig(
  name: string,
  raw: unknown,
): ClawBenchModelConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new EvalsError(`ClawBench model "${name}" must be a YAML object.`);
  }
  const cfg = { ...(raw as Record<string, unknown>) };
  const baseUrl = cfg.base_url;
  const apiType = cfg.api_type;
  if (typeof baseUrl !== "string" || !baseUrl) {
    throw new EvalsError(`ClawBench model "${name}" is missing base_url.`);
  }
  if (!isSupportedApiType(apiType)) {
    throw new EvalsError(
      `ClawBench model "${name}" api_type must be one of: ${SUPPORTED_API_TYPES.join(", ")}.`,
    );
  }

  const apiKeys = Array.isArray(cfg.api_keys)
    ? cfg.api_keys.map(String).filter(Boolean)
    : undefined;
  const apiKey =
    apiKeys?.[0] ??
    (typeof cfg.api_key === "string" && cfg.api_key ? cfg.api_key : undefined);
  if (!apiKey) {
    throw new EvalsError(`ClawBench model "${name}" is missing api_key.`);
  }

  return {
    model: name,
    base_url: baseUrl,
    api_type: apiType,
    api_key: apiKey,
    api_keys: apiKeys ?? [apiKey],
    thinking_level:
      typeof cfg.thinking_level === "string" ? cfg.thinking_level : undefined,
    temperature:
      typeof cfg.temperature === "number" ? cfg.temperature : undefined,
    max_tokens: typeof cfg.max_tokens === "number" ? cfg.max_tokens : undefined,
  };
}

export function resolveClawBenchModelName(requested?: string): string {
  return requested || process.env.EVAL_CLAWBENCH_MODEL || DEFAULT_AGENT_MODEL;
}

export function resolveClawBenchJudgeModelName(): string {
  return process.env.EVAL_CLAWBENCH_JUDGE_MODEL || DEFAULT_JUDGE_MODEL;
}

export function loadClawBenchModelConfig(name: string): ClawBenchModelConfig {
  const allModels = readModelsFile();
  const raw = allModels[name];
  if (!raw) {
    throw new EvalsError(
      `ClawBench model "${name}" not found in ${resolveClawBenchModelsYaml()}. Available: ${Object.keys(allModels).join(", ")}`,
    );
  }
  return normalizeModelConfig(name, raw);
}

export function toStagehandModelConfig(config: ClawBenchModelConfig): {
  modelName: string;
  apiKey: string;
  baseURL: string;
  temperature?: number;
  reasoningEffort?: string;
} {
  return {
    modelName: toClawBenchStagehandModelName(config),
    apiKey: config.api_key ?? "",
    baseURL: config.base_url,
    temperature: config.temperature,
    reasoningEffort: config.thinking_level,
  };
}

export function redactClawBenchModelConfig(config: ClawBenchModelConfig): Omit<
  ClawBenchModelConfig,
  "api_key" | "api_keys"
> & {
  api_key: "[REDACTED]";
  api_keys: "[REDACTED]";
} {
  return {
    ...config,
    api_key: "[REDACTED]",
    api_keys: "[REDACTED]",
  };
}
