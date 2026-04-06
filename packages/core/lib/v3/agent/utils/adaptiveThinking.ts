/**
 * Anthropic models that support adaptive thinking (thinking.type: "adaptive").
 *
 * These models dynamically determine when and how much to use extended thinking
 * based on the complexity of each request. When adaptive thinking is active the
 * custom "think" tool should be omitted because the model's native reasoning
 * replaces it.
 *
 * @see https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
 */
const ADAPTIVE_THINKING_MODEL_PATTERNS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
];

/**
 * Returns `true` when the given model identifier refers to an Anthropic model
 * that supports adaptive thinking (Claude Opus 4.6, Sonnet 4.6 and their
 * dated variants).
 */
export function supportsAdaptiveThinking(
  modelId: string | undefined,
): boolean {
  if (!modelId) return false;

  // Strip the provider prefix (e.g. "anthropic/claude-sonnet-4-6" → "claude-sonnet-4-6")
  const baseModel = modelId.includes("/")
    ? modelId.split("/").slice(1).join("/")
    : modelId;

  return ADAPTIVE_THINKING_MODEL_PATTERNS.some(
    (pattern) =>
      baseModel === pattern || baseModel.startsWith(`${pattern}-`),
  );
}
