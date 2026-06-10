/**
 * Anthropic model capabilities + typed provider options for the agent paths.
 *
 * Adaptive thinking (`thinking: { type: "adaptive" }` + `effort`) is the
 * recommended thinking mode on Claude 4.6+ models and the only mode on
 * Opus 4.7/4.8; on Claude Fable 5 thinking is always on and adaptive is the
 * only mode. The CUA path (AnthropicCUAClient) sets the raw Messages API
 * fields directly; the hybrid/DOM path goes through @ai-sdk/anthropic, which
 * maps the typed provider options below to the same API fields.
 *
 * Fable 5 may decline a turn (stop_reason "refusal"). The `fallbacks`
 * provider option opts into the API's built-in server-side fallback: the API
 * retries a declined turn on the fallback model and returns one response.
 * @ai-sdk/anthropic adds the required server-side-fallback beta header
 * automatically when `fallbacks` is set.
 */

import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import type { ThinkingEffort } from "../types/public/model.js";

export const ANTHROPIC_FABLE_5_MODEL_ID = "claude-fable-5" as const;

// Fallback model used when Fable 5 declines a turn.
export const ANTHROPIC_FABLE_5_FALLBACK_MODEL_ID = "claude-opus-4-8" as const;

// Models that support adaptive thinking. Note: claude-opus-4-5-20251101 uses
// the newer computer tool but does NOT support adaptive thinking, so it is
// intentionally excluded.
const ADAPTIVE_THINKING_MODEL_BASES = new Set<string>([
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  ANTHROPIC_FABLE_5_MODEL_ID,
]);

// Models that accept effort "xhigh". Sending xhigh to other models (e.g.
// claude-sonnet-4-6) is rejected by the API, so it is clamped to "high".
const XHIGH_CAPABLE_MODEL_BASES = new Set<string>([
  "claude-opus-4-7",
  "claude-opus-4-8",
  ANTHROPIC_FABLE_5_MODEL_ID,
]);

/** Strip a leading `provider/` segment, e.g. "anthropic/claude-opus-4-8". */
export function stripModelProvider(modelId: string): string {
  return modelId.includes("/")
    ? modelId.slice(modelId.indexOf("/") + 1)
    : modelId;
}

/** True for Anthropic models that support adaptive thinking. */
export function isAdaptiveThinkingAnthropicModel(modelId: string): boolean {
  return ADAPTIVE_THINKING_MODEL_BASES.has(stripModelProvider(modelId));
}

export function isAnthropicFable5Model(modelId: string): boolean {
  return stripModelProvider(modelId) === ANTHROPIC_FABLE_5_MODEL_ID;
}

const VALID_EFFORTS: ReadonlySet<string> = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

/**
 * Resolve the adaptive effort to send, clamped to what the model accepts.
 * Precedence: explicit arg (e.g. clientOptions.thinkingEffort) >
 * STAGEHAND_THINKING_EFFORT env > undefined (the API default, "high").
 */
export function resolveAdaptiveEffort(
  modelId: string,
  explicit?: string,
): Exclude<ThinkingEffort, "none"> | undefined {
  const candidate = explicit ?? process.env.STAGEHAND_THINKING_EFFORT;
  if (!candidate || !VALID_EFFORTS.has(candidate) || candidate === "none") {
    return undefined;
  }
  if (
    candidate === "xhigh" &&
    !XHIGH_CAPABLE_MODEL_BASES.has(stripModelProvider(modelId))
  ) {
    return "high";
  }
  return candidate as Exclude<ThinkingEffort, "none">;
}

/**
 * Typed `anthropic` provider options requesting adaptive thinking for models
 * that support it, or `undefined` otherwise. Effort is omitted unless
 * configured, leaving the API default ("high") in charge.
 */
export function anthropicAdaptiveThinkingOptions(
  modelId: string,
  effort?: string,
): AnthropicProviderOptions | undefined {
  if (!isAdaptiveThinkingAnthropicModel(modelId)) return undefined;
  const resolved = resolveAdaptiveEffort(modelId, effort);
  return {
    thinking: { type: "adaptive" },
    ...(resolved ? { effort: resolved } : {}),
  } satisfies AnthropicProviderOptions;
}

/**
 * Typed `anthropic` provider options enabling the API's server-side refusal
 * fallback for Fable 5, or `undefined` for other models. The provider adds
 * the server-side-fallback beta header automatically.
 */
export function anthropicFallbacksOptions(
  modelId: string,
): AnthropicProviderOptions | undefined {
  if (!isAnthropicFable5Model(modelId)) return undefined;
  return {
    fallbacks: [{ model: ANTHROPIC_FABLE_5_FALLBACK_MODEL_ID }],
  } satisfies AnthropicProviderOptions;
}
