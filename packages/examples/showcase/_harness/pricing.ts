export type ModelPrice = {
  inputPerMTok: number;
  cachedInputPerMTok: number;
  cacheWritePerMTok: number;
  outputPerMTok: number;
  source: string;
  checkedOn: string;
};

// USD per million tokens. Snapshotted into every results.json so published
// costs stay tied to the prices in effect when the run happened.
export const PRICES: Record<string, ModelPrice> = {
  "anthropic/claude-sonnet-5-5": {
    inputPerMTok: 2,
    cachedInputPerMTok: 0.2,
    cacheWritePerMTok: 2.5,
    outputPerMTok: 10,
    source: "https://platform.claude.com/docs/en/about-claude/pricing",
    checkedOn: "2026-09-25",
  },
  "openai/gpt-6-luna": {
    inputPerMTok: 0.1,
    cachedInputPerMTok: 0.01,
    cacheWritePerMTok: 0.1,
    outputPerMTok: 0.5,
    source: "https://developers.openai.com/api/docs/models/gpt-6-luna",
    checkedOn: "2026-10-03",
  },
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  reasoningTokens: number;
};

// Input counts include cache reads and writes, and output counts include
// reasoning, as the AI SDK reports them for every provider.
export function costUsd(model: string, usage: Usage): number {
  const price = PRICES[model];
  if (!price) throw new Error(`No price for ${model} in examples/_harness/pricing.ts`);
  const uncached = Math.max(
    0,
    usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteInputTokens,
  );
  return (
    (uncached * price.inputPerMTok +
      usage.cachedInputTokens * price.cachedInputPerMTok +
      usage.cacheWriteInputTokens * price.cacheWritePerMTok +
      usage.outputTokens * price.outputPerMTok) /
    1_000_000
  );
}
