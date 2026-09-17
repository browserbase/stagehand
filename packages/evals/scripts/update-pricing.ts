/**
 * Refresh the model entries already present in the versioned price map into pricing/pricing.json.
 *
 * Prereqs: network access. No API key: the Vercel AI Gateway model list is
 * public; OpenRouter's public models endpoint is the fallback.
 * Args: none.
 * Env: EVAL_PRICING_SOURCE=gateway|openrouter to force one source.
 * Example: pnpm exec tsx packages/evals/scripts/update-pricing.ts
 *
 * Entries already marked unpriced remain at null prices and
 * "source": "needs owner input" so cost estimation reports them as unpriced
 * instead of $0 — even when a public catalog happens to list a price for the
 * id (the observed value is kept in `note` for the owner to confirm).
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { EvalsError } from "../errors.js";
import { getPackageRootDir } from "../runtimePaths.js";
import type { ModelPrice, PriceMap } from "../framework/costEstimate.js";

const GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/** OpenRouter spells a few creators differently from the gateway. */
const OPENROUTER_ID_ALIASES: Record<string, string> = {
  "spacexai/": "x-ai/",
  "zai/": "z-ai/",
  "alibaba/": "qwen/",
};

type FetchedPrice = Omit<ModelPrice, "source"> & { source: string };

async function fetchCatalog(
  url: string,
  provider: string,
): Promise<{ data?: Array<Record<string, unknown>> }> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (cause) {
    throw new EvalsError(`${provider} model catalog request failed.`, { cause });
  }
  if (!response.ok) throw new EvalsError(`${provider} models: HTTP ${response.status}`);
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !Array.isArray((body as { data?: unknown }).data)) {
      throw new EvalsError(`${provider} model catalog has no model list.`);
    }
    return body as { data: Array<Record<string, unknown>> };
  } catch (cause) {
    if (cause instanceof EvalsError) throw cause;
    throw new EvalsError(`${provider} model catalog is not valid JSON.`, { cause });
  }
}

async function fetchGatewayPrices(): Promise<Map<string, FetchedPrice>> {
  const body = await fetchCatalog(GATEWAY_MODELS_URL, "gateway");
  const prices = new Map<string, FetchedPrice>();
  for (const model of Array.isArray(body.data) ? body.data : []) {
    if (!model || typeof model !== "object") continue;
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
  if (prices.size === 0) throw new EvalsError("Model catalog contained no usable prices.");
  return prices;
}

async function fetchOpenRouterPrices(): Promise<Map<string, FetchedPrice>> {
  const body = await fetchCatalog(OPENROUTER_MODELS_URL, "openrouter");
  const prices = new Map<string, FetchedPrice>();
  for (const model of Array.isArray(body.data) ? body.data : []) {
    if (!model || typeof model !== "object") continue;
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
  if (prices.size === 0) throw new EvalsError("Model catalog contained no usable prices.");
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
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return undefined;
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
      console.warn("gateway model catalog unavailable; falling back to OpenRouter");
    }
  }
  return { prices: await fetchOpenRouterPrices(), source: "openrouter" };
}

export async function updatePricing(
  target = path.join(getPackageRootDir(), "pricing", "pricing.json"),
): Promise<void> {
  const existing = JSON.parse(fs.readFileSync(target, "utf8")) as PriceMap;
  const pricedModels = Object.keys(existing.models).filter(
    (id) => existing.models[id].input_per_m !== null,
  );
  const ownerInputModels = Object.keys(existing.models).filter(
    (id) => existing.models[id].input_per_m === null,
  );
  const { prices, source } = await loadPrices();
  if (pricedModels.length && !pricedModels.some((id) => prices.has(id))) {
    throw new EvalsError(
      "Model catalog contained no prices for currently priced models; file unchanged.",
    );
  }
  const models: PriceMap["models"] = {};
  const missing: string[] = [];
  for (const id of pricedModels) {
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
  for (const id of ownerInputModels) {
    const observed = prices.get(id);
    models[id] = {
      input_per_m: null,
      cached_input_per_m: null,
      output_per_m: null,
      source: "needs owner input",
      ...(observed && {
        note: `${source} lists in=${observed.input_per_m} cached=${observed.cached_input_per_m}${observed.cache_write_input_per_m !== undefined ? ` cache_write=${observed.cache_write_input_per_m}` : ""} out=${observed.output_per_m} USD/M on ${today()}; confirm before enabling this price`,
      }),
    };
  }
  const priceMap: PriceMap = { as_of: today(), models };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(priceMap, null, 2) + "\n");
  console.log(
    `wrote ${target}: ${pricedModels.length - missing.length} priced from ${source}, ${ownerInputModels.length} awaiting owner input` +
      (missing.length ? `, ${missing.length} not listed: ${missing.join(", ")}` : ""),
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await updatePricing();
}
