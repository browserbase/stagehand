/**
 * Snapshot list prices for the curated eval model set into pricing/pricing.json.
 *
 * Prereqs: network access. No API key: the Vercel AI Gateway model list is
 * public; OpenRouter's public models endpoint is the fallback.
 * Args: none.
 * Env: EVAL_PRICING_SOURCE=gateway|openrouter to force one source.
 * Example: pnpm exec tsx packages/evals/scripts/update-pricing.ts
 *
 * EAP / codename models are written with null prices and
 * "source": "needs owner input" so cost estimation reports them as unpriced
 * instead of $0 — even when a public catalog happens to list a price for the
 * id (the observed value is kept in `note` for the owner to confirm).
 */
import fs from "node:fs";
import path from "node:path";
import { getPackageRootDir } from "../runtimePaths.js";
import type { ModelPrice, PriceMap } from "../framework/costEstimate.js";

const GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/** Canonical `provider/model` keys, spelled the way the AI Gateway lists them. */
const PRICED_MODELS = [
  "openai/gpt-5.4-mini",
  "openai/gpt-5.5",
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-opus-4.8",
  "anthropic/claude-sonnet-5",
  "anthropic/claude-opus-5",
  "google/gemini-3-flash",
  "google/gemini-3.5-flash",
  "google/gemini-3.6-flash",
  "google/gemini-3.7-flash",
  "spacexai/grok-4.5",
  "spacexai/grok-4.6",
  "zai/glm-5.3",
  "zai/glm-5.3-flash",
  "alibaba/qwen3.8-flash",
  "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v4-flash",
];

/** Models whose price the eval owner must confirm before any dollar figure is trusted. */
const OWNER_INPUT_MODELS = [
  "openai/gpt-5.6-luna",
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-terra",
  "anthropic/claude-fable-5",
  "anthropic/claude-melon",
];

/** OpenRouter spells a few creators differently from the gateway. */
const OPENROUTER_ID_ALIASES: Record<string, string> = {
  "spacexai/": "x-ai/",
  "zai/": "z-ai/",
  "alibaba/": "qwen/",
};

type FetchedPrice = Omit<ModelPrice, "source"> & { source: string };

async function fetchGatewayPrices(): Promise<Map<string, FetchedPrice>> {
  const response = await fetch(GATEWAY_MODELS_URL);
  if (!response.ok) throw new Error(`gateway models: HTTP ${response.status}`);
  const body = (await response.json()) as { data?: Array<Record<string, unknown>> };
  const prices = new Map<string, FetchedPrice>();
  for (const model of body.data ?? []) {
    const pricing = model.pricing as Record<string, unknown> | undefined;
    const id = typeof model.id === "string" ? model.id : undefined;
    if (!id || !pricing) continue;
    const input = perMillion(pricing.input);
    const output = perMillion(pricing.output);
    if (input === undefined || output === undefined) continue;
    prices.set(id, {
      input_per_m: input,
      cached_input_per_m: perMillion(pricing.input_cache_read) ?? input,
      ...(perMillion(pricing.input_cache_write) !== undefined && {
        cache_write_input_per_m: perMillion(pricing.input_cache_write),
      }),
      output_per_m: output,
      source: `${GATEWAY_MODELS_URL} (${id})`,
    });
  }
  return prices;
}

async function fetchOpenRouterPrices(): Promise<Map<string, FetchedPrice>> {
  const response = await fetch(OPENROUTER_MODELS_URL);
  if (!response.ok) throw new Error(`openrouter models: HTTP ${response.status}`);
  const body = (await response.json()) as { data?: Array<Record<string, unknown>> };
  const prices = new Map<string, FetchedPrice>();
  for (const model of body.data ?? []) {
    const pricing = model.pricing as Record<string, unknown> | undefined;
    const id = typeof model.id === "string" ? model.id : undefined;
    if (!id || !pricing) continue;
    const input = perMillion(pricing.prompt);
    const output = perMillion(pricing.completion);
    if (input === undefined || output === undefined) continue;
    prices.set(toGatewayId(id), {
      input_per_m: input,
      cached_input_per_m: perMillion(pricing.input_cache_read) ?? input,
      ...(perMillion(pricing.input_cache_write) !== undefined && {
        cache_write_input_per_m: perMillion(pricing.input_cache_write),
      }),
      output_per_m: output,
      source: `${OPENROUTER_MODELS_URL} (${id})`,
    });
  }
  return prices;
}

function toGatewayId(openRouterId: string): string {
  for (const [gateway, openRouter] of Object.entries(OPENROUTER_ID_ALIASES)) {
    if (openRouterId.startsWith(openRouter)) return gateway + openRouterId.slice(openRouter.length);
  }
  return openRouterId;
}

/** Catalogs quote USD per token as strings; the price map stores USD per million. */
function perMillion(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const perToken = Number(value);
  if (!Number.isFinite(perToken) || perToken < 0) return undefined;
  return Number((perToken * 1_000_000).toPrecision(10));
}

async function loadPrices(): Promise<{ prices: Map<string, FetchedPrice>; source: string }> {
  const forced = process.env.EVAL_PRICING_SOURCE;
  if (forced !== "openrouter") {
    try {
      return { prices: await fetchGatewayPrices(), source: "gateway" };
    } catch (error) {
      if (forced === "gateway") throw error;
      console.warn(`gateway fetch failed (${String(error)}); falling back to OpenRouter`);
    }
  }
  return { prices: await fetchOpenRouterPrices(), source: "openrouter" };
}

async function main(): Promise<void> {
  const { prices, source } = await loadPrices();
  const models: PriceMap["models"] = {};
  const missing: string[] = [];
  for (const id of PRICED_MODELS) {
    const price = prices.get(id);
    if (price) models[id] = price;
    else {
      missing.push(id);
      models[id] = {
        input_per_m: null,
        cached_input_per_m: null,
        output_per_m: null,
        source: `not listed by ${source} on ${today()}; needs owner input`,
      };
    }
  }
  for (const id of OWNER_INPUT_MODELS) {
    const observed = prices.get(id);
    models[id] = {
      input_per_m: null,
      cached_input_per_m: null,
      output_per_m: null,
      source: "needs owner input",
      ...(observed && {
        note: `${source} lists in=${observed.input_per_m} cached=${observed.cached_input_per_m} out=${observed.output_per_m} USD/M on ${today()}; confirm before pricing an EAP model`,
      }),
    };
  }
  const priceMap: PriceMap = { as_of: today(), models };
  const target = path.join(getPackageRootDir(), "pricing", "pricing.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(priceMap, null, 2) + "\n");
  console.log(
    `wrote ${target}: ${PRICED_MODELS.length - missing.length} priced from ${source}, ${OWNER_INPUT_MODELS.length} awaiting owner input` +
      (missing.length ? `, ${missing.length} not listed: ${missing.join(", ")}` : ""),
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

await main();
