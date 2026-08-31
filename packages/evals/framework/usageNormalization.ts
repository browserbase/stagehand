import type { ExternalHarnessUsage } from "./harnesses/externalRunner.js";

/**
 * How a harness SDK lays out the token buckets it reports.
 *
 * - `openai_cached_subset`: `inputTokens` is the whole prompt; cached (and any
 *   cache-write) tokens are a subset of it. Reasoning tokens are a subset of
 *   `outputTokens`. This is the OpenAI Responses shape and also what the AI SDK
 *   (v6+) and LangChain normalize every provider onto.
 * - `anthropic_cache_separate`: `inputTokens` excludes cache reads and cache
 *   writes; both are reported in their own fields. The raw Anthropic Messages
 *   API shape, surfaced unchanged by the Claude Agent SDK.
 * - `uncached_only`: the harness re-normalizes every provider onto an
 *   Anthropic-style split, so `inputTokens` is always the uncached remainder
 *   (pi: `usage.input` = 40 alongside 127k `cacheRead` observed).
 * - `unreported`: the SDK exposes no token usage at all; every bucket is 0 and
 *   must not be priced.
 */
export type UsageConvention =
  | "openai_cached_subset"
  | "anthropic_cache_separate"
  | "uncached_only"
  | "unreported";

export interface NormalizedUsage {
  /** Every prompt token billed on any input rate: uncached + cached + cache writes. */
  input_total: number;
  /** Prompt tokens served from a prompt cache. */
  input_cached: number;
  /** Prompt tokens written into a prompt cache (0 when the SDK does not split them out). */
  input_cache_write: number;
  /** Prompt tokens billed at the plain input rate. */
  input_uncached: number;
  /** Completion tokens, including reasoning when `reasoning_in_output`. */
  output: number;
  /** Reasoning / thinking tokens the SDK reported (0 when it does not). */
  reasoning: number;
  /** Whether `reasoning` is already counted inside `output`. */
  reasoning_in_output: boolean;
  convention: UsageConvention;
}

export interface NormalizeUsageInput {
  harness: string;
  /**
   * Model provider (e.g. "anthropic"). Accepted for forward compatibility; today
   * every harness SDK reports one shape regardless of provider, so the
   * convention is decided per harness.
   */
  provider?: string;
  raw: ExternalHarnessUsage;
}

/**
 * Convention per registered harness, decided from what each SDK actually
 * reports (see the runner's usage extraction, not its docs):
 *
 * | harness     | evidence                                                                              |
 * |-------------|---------------------------------------------------------------------------------------|
 * | claude_code | result message `usage.input_tokens` + separate `cache_read/creation_input_tokens`       |
 * | codex       | `turn.completed` usage: `cached_input_tokens` ⊂ `input_tokens`, reasoning ⊂ output      |
 * | mastra      | @mastra/core 1.57 on ai@7: `inputTokens` total, `cachedInputTokens` subset               |
 * | eve         | eve 0.29 reads AI SDK 7 `usage.inputTokens` + `inputTokenDetails.cacheReadTokens`        |
 * | deepagents  | LangChain `usage_metadata.input_tokens` total, `input_token_details.cache_read` subset   |
 * | fx          | `usage-v2.json` snapshot: `cache_read_tokens` 50 624 ⊂ `input_tokens` 58 837 observed    |
 * | pi          | pi-ai `usage.input` is the uncached remainder; `cacheRead`/`cacheWrite` separate         |
 * | cursor      | `CursorTokenUsage.reported === false`; the CLI never emits usage                        |
 */
const HARNESS_CONVENTIONS: Readonly<Record<string, UsageConvention>> = {
  claude_code: "anthropic_cache_separate",
  codex: "openai_cached_subset",
  mastra: "openai_cached_subset",
  eve: "openai_cached_subset",
  deepagents: "openai_cached_subset",
  fx: "openai_cached_subset",
  pi: "uncached_only",
  cursor: "unreported",
};

/** Unknown harnesses get the most common SDK shape; the metric is still labelled. */
const DEFAULT_CONVENTION: UsageConvention = "openai_cached_subset";

export function usageConventionFor(harness: string): UsageConvention {
  return HARNESS_CONVENTIONS[harness] ?? DEFAULT_CONVENTION;
}

export function normalizeUsage({ harness, raw }: NormalizeUsageInput): NormalizedUsage {
  const convention = usageConventionFor(harness);
  const input = nonNegative(raw.inputTokens);
  const cached = nonNegative(raw.cachedInputTokens);
  const cacheWrite = nonNegative(raw.cacheCreationInputTokens);
  const output = nonNegative(raw.outputTokens);
  const reasoning = nonNegative(raw.reasoningOutputTokens);

  switch (convention) {
    case "openai_cached_subset":
      return {
        input_total: input,
        input_cached: Math.min(cached, input),
        input_cache_write: Math.min(cacheWrite, Math.max(0, input - cached)),
        input_uncached: Math.max(0, input - cached - cacheWrite),
        output,
        reasoning,
        reasoning_in_output: true,
        convention,
      };
    case "anthropic_cache_separate":
    case "uncached_only":
      return {
        input_total: input + cached + cacheWrite,
        input_cached: cached,
        input_cache_write: cacheWrite,
        input_uncached: input,
        output,
        reasoning,
        reasoning_in_output: true,
        convention,
      };
    case "unreported":
      return {
        input_total: 0,
        input_cached: 0,
        input_cache_write: 0,
        input_uncached: 0,
        output: 0,
        reasoning: 0,
        reasoning_in_output: true,
        convention,
      };
  }
}

/** `in=<total> (cached <n>) out=<n>` for the trace result line. */
export function formatNormalizedUsage(usage: NormalizedUsage): string {
  if (usage.convention === "unreported") return "in=? out=? (usage unreported)";
  return `in=${usage.input_total} (cached ${usage.input_cached}) out=${usage.output}`;
}

function nonNegative(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
