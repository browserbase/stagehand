export interface ActionMappingOptions {
  toolCallName: string;
  toolResult: unknown;
  args: Record<string, unknown>;
  reasoning?: string;
}

/**
 * Model name substrings that indicate hybrid mode compatibility.
 * Used for auto-routing when the user doesn't specify a mode.
 */
export const HYBRID_CAPABLE_MODEL_PATTERNS = [
  "gemini-3",
  "claude",
  "gpt-5.4",
  "gpt-5.5",
] as const;
