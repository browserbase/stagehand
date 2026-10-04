import type { DecisionModelConfig } from "./client.js";

/**
 * Everything that configures the decision model for act(), observe() and extract(). The
 * protocol's `experimentalDecisions` init param is assignable to this type.
 */

export type DecisionsConfig = DecisionModelConfig & {
  /** Minimum confidence before acting on a node's answer. */
  actConfidence?: number;
  /**
   * `"checks"` (default): deterministic checks only — fill read-back and the
   * native-select flag. `"full"` adds a logged-only decision-model yes/no over the page
   * diff. `"off"` disables every check.
   */
  verify?: "off" | "checks" | "full";
  /** When false, a decision-model abstention fails the act instead of running the LLM pipeline. */
  llmFallback?: boolean;
  /**
   * The argument-only LLM call for unquoted text. Independent of `llmFallback`:
   * turn both off for a run with no LLM at all. Default true.
   */
  argumentLlm?: boolean;
  /** Ask the decision model what kind of page this is when no target is found. Default true. */
  pageState?: boolean;
  /**
   * Click the runner-up when an ambiguous click provably changed nothing. Off
   * by default: effects the outline cannot show (aria-pressed, copy, play)
   * look like "nothing", and a second click is a second side effect.
   */
  retryNoEffect?: boolean;
  /** Show the LLM fallback the decision model's shortlist before the whole tree on huge pages. Default false. */
  focusFallback?: boolean;
  /** Check cached actions against the page before replaying them. Default false. */
  cacheCheck?: boolean;
  /**
   * How extract() uses the decision model. `"pick"` (default): it picks the elements holding
   * each field's value and code copies their text; the LLM extracts only when that does not
   * fit. `"judge"`: the LLM extracts and only the completion yes/no is the decision model's.
   * Both send page or extracted content to the decision provider.
   */
  extract?: "judge" | "pick";
  /**
   * Act as soon as the target is there instead of waiting out the DOM-settle
   * heuristic: pick on an early snapshot, and go when the decision model finds the target,
   * does not think the page is still loading, and the target is unchanged a
   * moment later. The settle wait remains the upper bound. Default false.
   */
  targetReadiness?: boolean;
  /**
   * Let act() invoke a WebMCP tool the page registered when the decision model is sure the
   * tool is the request. Sends tool names and descriptions, and for the likely
   * tools their parameter names, descriptions, types and enum values, to
   * the decision provider. Default false.
   */
  tools?: boolean;
};
