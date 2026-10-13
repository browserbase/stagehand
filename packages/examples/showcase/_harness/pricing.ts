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
  "anthropic/claude-sonnet-5": {
    inputPerMTok: 2,
    cachedInputPerMTok: 0.2,
    cacheWritePerMTok: 2.5,
    outputPerMTok: 10,
    source: "https://platform.claude.com/docs/en/about-claude/pricing",
    checkedOn: "2026-09-25",
  },
  "openai/gpt-5.4-mini": {
    inputPerMTok: 0.75,
    cachedInputPerMTok: 0.075,
    cacheWritePerMTok: 0.75,
    outputPerMTok: 4.5,
    source: "https://openrouter.ai/openai/gpt-5.4-mini",
    checkedOn: "2026-09-25",
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
