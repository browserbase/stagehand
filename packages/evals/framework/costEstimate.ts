import fs from "node:fs";
import path from "node:path";
import { getPackageRootDir } from "../runtimePaths.js";
import type { NormalizedUsage } from "./usageNormalization.js";

/** USD per million tokens. `null` marks a model the owner has not priced yet. */
export interface ModelPrice {
  input_per_m: number | null;
  cached_input_per_m: number | null;
  /** Cache-write rate where the provider bills one; falls back to `input_per_m`. */
  cache_write_input_per_m?: number | null;
  output_per_m: number | null;
  source: string;
  note?: string;
}

export interface PriceMap {
  as_of: string;
  models: Record<string, ModelPrice>;
}

export type CostSource = "estimated" | "unpriced" | "no_usage";

export interface CostEstimate {
  cost_usd_estimated?: number;
  cost_source: CostSource;
  /** The price-map key the estimate used (absent when unpriced). */
  priced_with?: string;
  /** `as_of` of the price map the estimate came from. */
  prices_as_of?: string;
}

const PRICE_MAP_FILE = "pricing/pricing.json";
let cachedPriceMap: PriceMap | undefined;

/** The versioned price map shipped with the package (empty when the file is missing). */
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

/**
 * cost = uncached·p_in + cached·p_cached + cache_write·(p_write ?? p_in) + output·p_out,
 * plus reasoning at the output rate only when the SDK reports it outside output.
 */
export function estimateCost(
  usage: NormalizedUsage,
  model: string | undefined,
  priceMap: PriceMap = loadPriceMap(),
): CostEstimate {
  if (usage.convention === "unreported") return { cost_source: "no_usage" };
  const resolved = resolveModelPrice(model, priceMap);
  if (!resolved) return { cost_source: "unpriced" };
  const { key, price } = resolved;
  const cacheWriteRate = price.cache_write_input_per_m ?? price.input_per_m!;
  const billedOutput = usage.output + (usage.reasoning_in_output ? 0 : usage.reasoning);
  const cost =
    (usage.input_uncached * price.input_per_m! +
      usage.input_cached * price.cached_input_per_m! +
      usage.input_cache_write * cacheWriteRate +
      billedOutput * price.output_per_m!) /
    1_000_000;
  return {
    cost_usd_estimated: Number(cost.toFixed(6)),
    cost_source: "estimated",
    priced_with: key,
    prices_as_of: priceMap.as_of,
  };
}

/** Find a fully priced entry for the model id, trying each alias in turn. */
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
    typeof price.input_per_m === "number" &&
    typeof price.cached_input_per_m === "number" &&
    typeof price.output_per_m === "number"
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

/**
 * Alias forms of a configured model id, most specific first:
 * `gateway/` prefixes dropped, harness defaults expanded, version dashes as
 * dots (`claude-sonnet-4-6` → `claude-sonnet-4.6`), `-preview` and trailing
 * date/codename segments stripped, provider spellings swapped, and finally the
 * bare model name (matched only when one provider carries it).
 */
export function modelPriceCandidates(model: string): string[] {
  let id = model.trim();
  while (id.startsWith("gateway/")) id = id.slice("gateway/".length);
  id = HARNESS_DEFAULT_MODELS[id] ?? id;
  const slash = id.indexOf("/");
  const provider = slash >= 0 ? id.slice(0, slash) : undefined;
  const name = slash >= 0 ? id.slice(slash + 1) : id;

  // Only suffixes that never distinguish one priced model from another are
  // stripped; version segments (`-4-6`, `-mini`) stay so a sibling model's
  // price is never borrowed.
  const names = new Set<string>();
  for (const base of [name, name.replace(/(\d)-(?=\d)/g, "$1.")]) {
    names.add(base);
    const undated = base.replace(/-\d{8}$/u, "").replace(/-\d{2}-\d{4}$/u, "");
    names.add(undated);
    names.add(undated.replace(/-preview$/u, ""));
    names.add(undated.replace(/(?:-lp)?-eap$/u, ""));
  }

  const providers = provider ? [provider, ...(PROVIDER_ALIASES[provider] ?? [])] : [];
  const candidates: string[] = [];
  for (const candidateName of names) {
    for (const candidateProvider of providers)
      candidates.push(`${candidateProvider}/${candidateName}`);
  }
  for (const candidateName of names) candidates.push(candidateName);
  return [...new Set(candidates)];
}

function uniqueMatch<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
  const matches = items.filter(predicate);
  return matches.length === 1 ? matches[0] : undefined;
}
