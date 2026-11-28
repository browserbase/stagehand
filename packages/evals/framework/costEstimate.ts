import fs from "node:fs";
import path from "node:path";
import { getPackageRootDir } from "../runtimePaths.js";
import type { NormalizedUsage } from "./usageNormalization.js";

export interface ModelPrice {
  input_per_m: number | null;
  cached_input_per_m: number | null;
  cache_write_input_per_m?: number | null;
  output_per_m: number | null;
  source: string;
  note?: string;
}

export interface PriceMap {
  as_of: string;
  models: Record<string, ModelPrice>;
}

export type CostSource = "reported" | "computed" | "unavailable";

export interface BilledCost {
  cost_usd?: number;
  cost_source: CostSource;
  billing_channel: string;
  cost_pricing?: { as_of: string; model: string; source: string };
}

const REPORTED_CHANNEL: Readonly<Record<string, string>> = {
  claude_code: "anthropic_api",
  claude_cua: "anthropic_api",
  gemini_cua: "google_api",
  eve: "ai_gateway",
  pi: "pi_catalog",
  fx: "fx_gateway",
};

const DIRECT_PROVIDER_HARNESSES: ReadonlySet<string> = new Set([
  "codex",
  "claude_cua",
  "gemini_cua",
  "mastra",
  "deepagents",
  "eve",
  "pi",
]);

const SUBSCRIPTION_HARNESSES: ReadonlySet<string> = new Set(["cursor", "claude_code"]);

export interface ResolveBilledCostInput {
  harness: string;
  model: string | undefined;
  usage: NormalizedUsage;
  reportedCostUsd?: number;
  priceMap?: PriceMap;
}

export function resolveBilledCost({
  harness,
  model,
  usage,
  reportedCostUsd,
  priceMap = loadPriceMap(),
}: ResolveBilledCostInput): BilledCost {
  if (
    typeof reportedCostUsd === "number" &&
    Number.isFinite(reportedCostUsd) &&
    reportedCostUsd >= 0
  ) {
    return {
      cost_usd: reportedCostUsd,
      cost_source: "reported",
      billing_channel: Object.hasOwn(REPORTED_CHANNEL, harness)
        ? REPORTED_CHANNEL[harness]!
        : `${harness}_reported`,
    };
  }
  const provider = providerOf(model);
  const channel =
    harness === "fx"
      ? "fx_gateway"
      : SUBSCRIPTION_HARNESSES.has(harness)
        ? "subscription"
        : provider
          ? `${provider}_api`
          : "none";
  if (!DIRECT_PROVIDER_HARNESSES.has(harness) || usage.convention === "unreported") {
    return { cost_source: "unavailable", billing_channel: channel };
  }
  const matched = resolveModelPrice(model, priceMap);
  const computed = computeListCost(usage, model, priceMap);
  return computed === undefined || !matched
    ? { cost_source: "unavailable", billing_channel: channel }
    : {
        cost_usd: computed,
        cost_source: "computed",
        billing_channel: channel,
        cost_pricing: {
          as_of: priceMap.as_of,
          model: matched.key,
          source: matched.price.source,
        },
      };
}

export function providerOf(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const [candidate] = modelPriceCandidates(model);
  if (!candidate?.includes("/")) return undefined;
  const provider = candidate.slice(0, candidate.indexOf("/"));
  return provider === "spacexai" || provider === "x-ai" ? "xai" : provider;
}

export function computeListCost(
  usage: NormalizedUsage,
  model: string | undefined,
  priceMap: PriceMap = loadPriceMap(),
): number | undefined {
  if (usage.convention === "unreported") return undefined;
  const price = resolveModelPrice(model, priceMap)?.price;
  if (!price) return undefined;
  const cacheWriteRate = price.cache_write_input_per_m ?? price.input_per_m!;
  const billedOutput = usage.output + (usage.reasoning_in_output ? 0 : usage.reasoning);
  const cost =
    (usage.input_uncached * price.input_per_m! +
      usage.input_cached * price.cached_input_per_m! +
      usage.input_cache_write * cacheWriteRate +
      billedOutput * price.output_per_m!) /
    1_000_000;
  return Number.isFinite(cost) && cost >= 0 ? Number(cost.toFixed(6)) : undefined;
}

const PRICE_MAP_FILE = "pricing/pricing.json";
let cachedPriceMap: PriceMap | undefined;

export function loadPriceMap(filePath?: string): PriceMap {
  if (filePath) return readPriceMap(filePath);
  cachedPriceMap ??= readPriceMap(path.join(getPackageRootDir(), PRICE_MAP_FILE));
  return cachedPriceMap;
}

function readPriceMap(filePath: string): PriceMap {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<PriceMap>;
    return { as_of: parsed.as_of ?? "unknown", models: parsed.models ?? {} };
  } catch {
    return { as_of: "unknown", models: {} };
  }
}

export function resolveModelPrice(
  model: string | undefined,
  priceMap: PriceMap,
): { key: string; price: ModelPrice } | undefined {
  if (!model) return undefined;
  const keys = Object.keys(priceMap.models);
  for (const candidate of modelPriceCandidates(model)) {
    const key = candidate.includes("/")
      ? keys.find((entry) => entry === candidate)
      : uniqueMatch(keys, (entry) => entry.slice(entry.indexOf("/") + 1) === candidate);
    if (!key) continue;
    const price = priceMap.models[key];
    return isPriced(price) ? { key, price } : undefined;
  }
  return undefined;
}

function isPriced(price: ModelPrice | undefined): price is ModelPrice {
  return (
    !!price &&
    (price.cache_write_input_per_m == null ||
      (typeof price.cache_write_input_per_m === "number" &&
        Number.isFinite(price.cache_write_input_per_m) &&
        price.cache_write_input_per_m >= 0)) &&
    [price.input_per_m, price.cached_input_per_m, price.output_per_m].every(
      (rate) => typeof rate === "number" && Number.isFinite(rate) && rate >= 0,
    )
  );
}

const HARNESS_DEFAULT_MODELS: Record<string, string> = {
  "codex/default": "openai/gpt-5.4-mini",
};

const PROVIDER_ALIASES: Record<string, string[]> = {
  xai: ["spacexai", "x-ai"],
  spacexai: ["xai", "x-ai"],
  "x-ai": ["spacexai", "xai"],
  zai: ["z-ai"],
  "z-ai": ["zai"],
  alibaba: ["qwen"],
  qwen: ["alibaba"],
};

export function modelPriceCandidates(model: string): string[] {
  let id = model.trim();
  while (id.startsWith("gateway/")) id = id.slice("gateway/".length);
  id = Object.hasOwn(HARNESS_DEFAULT_MODELS, id) ? HARNESS_DEFAULT_MODELS[id]! : id;
  const slash = id.indexOf("/");
  const provider = slash >= 0 ? id.slice(0, slash) : undefined;
  const name = slash >= 0 ? id.slice(slash + 1) : id;

  const names = new Set<string>();
  for (const base of [name, name.replace(/(\d)-(?=\d)/g, "$1.")]) {
    names.add(base);
    const undated = base.replace(/-\d{8}$/u, "").replace(/-\d{2}-\d{4}$/u, "");
    names.add(undated);
    names.add(undated.replace(/-preview$/u, ""));
  }

  const providers = provider
    ? [provider, ...(Object.hasOwn(PROVIDER_ALIASES, provider) ? PROVIDER_ALIASES[provider]! : [])]
    : [];
  const candidates: string[] = [];
  for (const candidateName of names) {
    for (const candidateProvider of providers)
      candidates.push(`${candidateProvider}/${candidateName}`);
  }
  if (!provider) for (const candidateName of names) candidates.push(candidateName);
  return [...new Set(candidates)];
}

function uniqueMatch<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
  const matches = items.filter(predicate);
  return matches.length === 1 ? matches[0] : undefined;
}
