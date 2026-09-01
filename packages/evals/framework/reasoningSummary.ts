/**
 * OpenAI Responses-style models only return reasoning text when a summary is
 * requested explicitly (`reasoning: { summary }`); without it every harness
 * reports reasoning tokens but an empty step.reasoning. The request is on by
 * default and shared across harnesses so a run can be compared step for step.
 */
export const REASONING_SUMMARY_ENV = "EVAL_REASONING_SUMMARY";

export type ReasoningSummaryMode = "auto" | "concise" | "detailed";

export const DEFAULT_REASONING_SUMMARY: ReasoningSummaryMode = "detailed";

const MODES = new Set<string>(["auto", "concise", "detailed"]);

/** Requested summary mode, or undefined when `EVAL_REASONING_SUMMARY=off`. */
export function readReasoningSummary(
  env: NodeJS.ProcessEnv = process.env,
): ReasoningSummaryMode | undefined {
  const raw = env[REASONING_SUMMARY_ENV]?.trim().toLowerCase();
  if (!raw) return DEFAULT_REASONING_SUMMARY;
  if (raw === "off" || raw === "none" || raw === "false" || raw === "0") return undefined;
  return MODES.has(raw) ? (raw as ReasoningSummaryMode) : DEFAULT_REASONING_SUMMARY;
}

export function isOpenAiModel(model: string): boolean {
  return !model.includes("/") || model.startsWith("openai/");
}

/**
 * AI SDK `providerOptions` that make the OpenAI provider request reasoning
 * summaries. Empty for other providers, whose reasoning text (Anthropic
 * thinking) streams without being asked.
 */
export function openAiReasoningProviderOptions(
  model: string,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, Record<string, unknown>> | undefined {
  const summary = readReasoningSummary(env);
  if (!summary || !isOpenAiModel(model)) return undefined;
  return { openai: { reasoningSummary: summary } };
}
