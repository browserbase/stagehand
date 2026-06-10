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
import type { JSONValue } from "@ai-sdk/provider";
import type { ThinkingEffort } from "../types/public/model.js";
import { stripModelProvider } from "../../utils.js";

/**
 * Shape accepted by the AI SDK's per-provider `providerOptions` maps. The
 * helpers below build values as typed `AnthropicProviderOptions` (so field
 * names stay checked) and return them under this JSON-compatible alias so
 * call sites need no casts.
 */
export type AnthropicAgentProviderOptions = Record<string, JSONValue>;

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
  "claude-fable-5",
]);

// Models that accept effort "xhigh". Sending xhigh to other models (e.g.
// claude-sonnet-4-6) is rejected by the API, so it is clamped to "high".
const XHIGH_CAPABLE_MODEL_BASES = new Set<string>([
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-fable-5",
]);

/** True for Anthropic models that support adaptive thinking. */
export function isAdaptiveThinkingAnthropicModel(modelId: string): boolean {
  return ADAPTIVE_THINKING_MODEL_BASES.has(stripModelProvider(modelId));
}

export function isAnthropicFable5Model(modelId: string): boolean {
  return stripModelProvider(modelId) === "claude-fable-5";
}

/**
 * True for models that reject forced tool use
 * (`tool_choice: { type: "tool" }`). Forced tool choice is incompatible with
 * active extended thinking, and on Fable 5 thinking is always on — so the
 * rejection is a certainty there, not a transient quirk.
 */
export function rejectsForcedToolUse(modelId: string): boolean {
  return isAnthropicFable5Model(modelId);
}

const VALID_EFFORTS: ReadonlySet<string> = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

/** Default adaptive effort on both agent paths (CUA and hybrid/DOM),
 * overridable per client via `thinkingEffort`. */
export const DEFAULT_ANTHROPIC_ADAPTIVE_EFFORT: Exclude<
  ThinkingEffort,
  "none"
> = "medium";

/**
 * Resolve the adaptive effort to send, clamped to what the model accepts.
 * Precedence: the client's `thinkingEffort` > the shared default ("medium").
 * "none" is handled by the callers: it means "do not request thinking at
 * all", not an effort level.
 */
export function resolveAdaptiveEffort(
  modelId: string,
  explicit?: string,
): Exclude<ThinkingEffort, "none"> {
  const candidate =
    explicit && VALID_EFFORTS.has(explicit)
      ? (explicit as Exclude<ThinkingEffort, "none">)
      : DEFAULT_ANTHROPIC_ADAPTIVE_EFFORT;
  if (
    candidate === "xhigh" &&
    !XHIGH_CAPABLE_MODEL_BASES.has(stripModelProvider(modelId))
  ) {
    return "high";
  }
  return candidate;
}

/**
 * Typed `anthropic` provider options requesting adaptive thinking for models
 * that support it, or `undefined` otherwise.
 */
export function anthropicAdaptiveThinkingOptions(
  modelId: string,
  effort?: string,
): AnthropicAgentProviderOptions | undefined {
  if (!isAdaptiveThinkingAnthropicModel(modelId)) return undefined;
  // "none" is an explicit opt-out: request no thinking at all.
  if (effort === "none") return undefined;
  return {
    thinking: { type: "adaptive" },
    effort: resolveAdaptiveEffort(modelId, effort),
  } satisfies AnthropicProviderOptions as AnthropicAgentProviderOptions;
}

/**
 * Typed `anthropic` provider options enabling the API's server-side refusal
 * fallback for Fable 5, or `undefined` for other models. The provider adds
 * the server-side-fallback beta header automatically.
 */
export function anthropicFallbacksOptions(
  modelId: string,
): AnthropicAgentProviderOptions | undefined {
  if (!isAnthropicFable5Model(modelId)) return undefined;
  return {
    fallbacks: [{ model: ANTHROPIC_FABLE_5_FALLBACK_MODEL_ID }],
  } satisfies AnthropicProviderOptions as AnthropicAgentProviderOptions;
}
