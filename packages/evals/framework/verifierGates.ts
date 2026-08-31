/**
 * Deterministic post-judge gates over a V3Evaluator verdict.
 *
 * The published v3 verifier (stagehand-v3 3.7.x, prompts/fusedJudgment) has
 * two scoring rules that leak into `outcomeSuccess`/`processScore`:
 *
 *   - "Uncontrollable Blockers → full credit": a criterion the agent could not
 *     attempt because of a bot wall / broken page is scored earned === max.
 *     Bot-walled runs therefore report processScore = 1.0, and the credit can
 *     carry the outcome verdict with it.
 *   - "evidenceInsufficient → full credit": a criterion with no evidence in
 *     either tier is credited rather than zeroed.
 *
 * A 65-row adversarial audit (2026-08-31) found passes with an empty final
 * answer and status=error, answers lifted from search-engine snippets that
 * were never verified on the target site, and perCriterion arrays shorter
 * than the rubric. None of that is visible to `--success outcome|process`.
 *
 * Everything in this module is pure and cheap: it reads the trajectory the
 * judge already saw and never calls a model. The judge's raw verdict is
 * always preserved alongside the gated one so Braintrust can filter either
 * way.
 */
import type { CriterionScore, EvaluationResult, Trajectory, TrajectoryStep } from "stagehand-v3";

export type OutcomeGate =
  | "no_final_answer"
  | "trajectory_error"
  | "no_browser_use"
  | "ungrounded_answer";

export type GroundingDatumKind = "currency" | "percent" | "time" | "decimal" | "integer" | "entity";

export interface GroundingDatum {
  /** The token as written in the final answer. */
  text: string;
  kind: GroundingDatumKind;
  /** Index of the first non-search-engine step whose output contains it. */
  groundedAtStep?: number;
  /** True when the datum only ever appeared in search-engine step outputs. */
  onlyInSearchEngine: boolean;
  /** Echoed from the task instruction; reported but never gates. */
  fromInstruction?: boolean;
}

export interface GroundingResult {
  checked: GroundingDatum[];
  /** Subset of `checked` that no non-search-engine step output contains. */
  ungrounded: GroundingDatum[];
  /**
   * Counts over datums of a kind allowed to gate the outcome (currency /
   * percent / time / decimal / integer with 4+ digits). Entity and
   * short-integer misses are advisory only.
   */
  groundedNumeric: number;
  ungroundedNumeric: number;
  /** True when the answer has numeric datums and none was verified off-search. */
  gatesOutcome: boolean;
}

export interface GatedCriterionScore extends CriterionScore {
  /**
   * Credited by the judge without evidence that the step happened — either
   * via the blocker rule or via evidenceInsufficient. Zeroed in the strict
   * process score.
   */
  blocked?: boolean;
}

export interface VerdictGates {
  /** Gated verdict: judge AND every deterministic gate. */
  outcomeSuccess: boolean;
  /** The judge's raw verdict, untouched. */
  judgeOutcomeSuccess: boolean;
  /** Gates that flipped a judge pass to a fail. Empty when nothing fired. */
  outcomeGates: OutcomeGate[];
  /** Same as `processScoreStrict`; the score `--success process` reads. */
  processScore: number | undefined;
  processScoreStrict: number | undefined;
  /** The judge's processScore, untouched. */
  processScoreLenient: number | undefined;
  perCriterion: GatedCriterionScore[] | undefined;
  /** Count of criteria zeroed in the strict score. */
  blockedCriteria: number;
  /** Undefined when grounding was not checked (no final answer / no datums). */
  grounding?: GroundingResult;
  /** Rubric has more items than the judge returned criterion scores for. */
  scoringIncomplete: boolean;
  rubricItemCount?: number;
}

export interface ApplyVerdictGatesInput {
  evaluation: EvaluationResult;
  trajectory: Pick<Trajectory, "steps" | "status" | "finalAnswer"> & {
    task?: { instruction?: string };
  };
  /** Matcher for mounted-browser (facade) tool names; enables `no_browser_use`. */
  isFacadeTool?: (name: string) => boolean;
  /** Whether an ungrounded numeric datum in the answer fails the outcome. */
  requireGrounding: boolean;
  /** `task_data.precomputed_rubric.items.length`; enables `scoringIncomplete`. */
  rubricItemCount?: number;
}

const BLOCKER_EXPLANATION = /uncontrollable|blocker|could not be attempted|blocked/i;

const SEARCH_ENGINE_HOST = /(^|\.)(google|bing|duckduckgo|yahoo|scribd|reddit)\./i;

/** Datasets whose rubrics are precomputed and whose answers are factual lookups. */
const GROUNDED_DATASETS = /hardbench|webtailbench/i;

export function applyVerdictGates({
  evaluation,
  trajectory,
  isFacadeTool,
  requireGrounding,
  rubricItemCount,
}: ApplyVerdictGatesInput): VerdictGates {
  const judgeOutcomeSuccess = evaluation.outcomeSuccess === true;
  const finalAnswer = (trajectory.finalAnswer ?? "").trim();
  const outcomeGates: OutcomeGate[] = [];

  if (!finalAnswer) outcomeGates.push("no_final_answer");
  if (trajectory.status === "error") outcomeGates.push("trajectory_error");
  if (isFacadeTool && !trajectory.steps.some((step) => isFacadeTool(step.actionName))) {
    outcomeGates.push("no_browser_use");
  }

  const grounding = finalAnswer
    ? checkAnswerGrounding(finalAnswer, trajectory.steps, trajectory.task?.instruction ?? "")
    : undefined;
  if (requireGrounding && grounding?.gatesOutcome) {
    outcomeGates.push("ungrounded_answer");
  }

  const { perCriterion, strict, blockedCriteria } = strictProcessScore(evaluation);

  const scoringIncomplete =
    typeof rubricItemCount === "number" &&
    rubricItemCount > 0 &&
    rubricItemCount > (evaluation.perCriterion?.length ?? 0);

  return {
    // Gates only ever flip a pass to a fail; a judge fail stays a fail even
    // when no gate fires, so the gate list is only meaningful on a judge pass.
    outcomeSuccess: judgeOutcomeSuccess && outcomeGates.length === 0,
    judgeOutcomeSuccess,
    outcomeGates: judgeOutcomeSuccess ? outcomeGates : [],
    processScore: strict,
    processScoreStrict: strict,
    processScoreLenient: evaluation.processScore,
    perCriterion,
    blockedCriteria,
    ...(grounding && { grounding }),
    scoringIncomplete,
    ...(rubricItemCount !== undefined && { rubricItemCount }),
  };
}

/**
 * Resolve EVAL_REQUIRE_GROUNDING. Defaults on for datasets whose tasks ship
 * precomputed rubrics (factual lookups where a snippet-lifted number is the
 * dominant false positive) and off elsewhere.
 */
export function resolveRequireGrounding(
  dataset: string,
  hasPrecomputedRubric: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.EVAL_REQUIRE_GROUNDING?.trim();
  if (raw === "1" || raw?.toLowerCase() === "true") return true;
  if (raw === "0" || raw?.toLowerCase() === "false") return false;
  return hasPrecomputedRubric || GROUNDED_DATASETS.test(dataset);
}

/**
 * Recompute the process score with blocker- and evidenceInsufficient-credited
 * criteria zeroed. Blocked criteria stay in the denominator: dropping them
 * would score a fully bot-walled run 0/0 and, with any fallback, let it pass
 * `--success process` again — exactly the leak this exists to close.
 * Not-applicable criteria (earnedPoints === null) are excluded, as the judge
 * does.
 */
export function strictProcessScore(
  evaluation: Pick<EvaluationResult, "perCriterion" | "evidenceInsufficient" | "processScore">,
): {
  perCriterion: GatedCriterionScore[] | undefined;
  strict: number | undefined;
  blockedCriteria: number;
} {
  const source = evaluation.perCriterion;
  // Without a per-criterion breakdown there is nothing to zero; the judge's
  // aggregate is the best available strict score.
  if (!source)
    return { perCriterion: undefined, strict: evaluation.processScore, blockedCriteria: 0 };

  const insufficient = new Set(evaluation.evidenceInsufficient ?? []);
  let earned = 0;
  let max = 0;
  let blockedCriteria = 0;
  const perCriterion = source.map((criterion): GatedCriterionScore => {
    if (criterion.earnedPoints === null) return { ...criterion };
    const fullCredit = criterion.earnedPoints >= criterion.maxPoints;
    const blocked =
      criterion.evidenceInsufficient === true ||
      insufficient.has(criterion.criterion) ||
      (fullCredit && BLOCKER_EXPLANATION.test(criterion.explanation ?? ""));
    max += criterion.maxPoints;
    if (blocked) blockedCriteria += 1;
    else earned += criterion.earnedPoints;
    return blocked ? { ...criterion, blocked: true } : { ...criterion };
  });

  return {
    perCriterion,
    strict: max > 0 ? earned / max : undefined,
    blockedCriteria,
  };
}

// ---------------------------------------------------------------------------
// Grounding
// ---------------------------------------------------------------------------

const CURRENCY_CODES = "SGD|USD|MYR|EUR|GBP|AUD|CAD|INR|JPY|CNY|HKD|NZD|CHF|THB|IDR|PHP|KRW";
const CURRENCY_PREFIX = new RegExp(
  `(?:(${CURRENCY_CODES}|S\\$|US\\$|A\\$|C\\$|\\$|€|£|¥)\\s?)`,
  "i",
);
const TIME_TOKEN = /\b\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?\b/g;
const YEAR_TOKEN = /^(?:1[89]|20)\d{2}$/;
const NUMBER_TOKEN = new RegExp(
  `${CURRENCY_PREFIX.source}?(\\d[\\d,]*(?:\\.\\d+)?)(?:\\s?(${CURRENCY_CODES}|%|\\$))?`,
  "gi",
);
// Two or more Capitalised words, allowing a lowercase joiner in between.
const ENTITY_TOKEN =
  /\b[A-Z][\w’'&-]*(?:\s+(?:of|the|and|de|for|&)\s+|\s+)(?:[A-Z][\w’'&-]*)(?:\s+(?:[A-Z][\w’'&-]*))*/g;

const CURRENCY_ALIASES: Record<string, string[]> = {
  $: ["$", "usd", "us$"],
  usd: ["usd", "us$", "$"],
  us$: ["us$", "usd", "$"],
  sgd: ["sgd", "s$"],
  s$: ["s$", "sgd"],
  aud: ["aud", "a$"],
  a$: ["a$", "aud"],
  cad: ["cad", "c$"],
  c$: ["c$", "cad"],
  "€": ["€", "eur"],
  eur: ["eur", "€"],
  "£": ["£", "gbp"],
  gbp: ["gbp", "£"],
  "¥": ["¥", "jpy", "cny"],
  jpy: ["jpy", "¥"],
  cny: ["cny", "¥", "rmb"],
};

interface ParsedDatum {
  text: string;
  kind: GroundingDatumKind;
  /** Matchers tried against a normalized step text; any hit grounds the datum. */
  patterns: RegExp[];
  /** Whether an ungrounded miss may gate the outcome. */
  gates: boolean;
  /** Echoed verbatim from the task instruction — task context, not a finding. */
  fromInstruction?: boolean;
}

/**
 * Lowercase, drop thousands separators, collapse whitespace to one space. Space
 * is kept (not removed) so digit boundaries survive: "1:27:02.624 2 Pits" must
 * not read as "...6242".
 */
export function normalizeForGrounding(text: string): string {
  return text.toLowerCase().replace(/,/g, "").replace(/\s+/g, " ").trim();
}

/** Regex source matching `text` with any run of whitespace between its tokens. */
function spaceTolerant(text: string): string {
  return normalizeForGrounding(text).split(" ").map(escapeRegExp).join("\\s*");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract the datums worth grounding from a final answer. Datums that also
 * appear in the task instruction (dates, budgets, quantities the task set) are
 * kept for reporting but never gate: the agent did not find them anywhere.
 */
export function extractGroundingDatums(finalAnswer: string, instruction = ""): ParsedDatum[] {
  const datums: ParsedDatum[] = [];
  const seen = new Set<string>();
  const normalizedInstruction = normalizeForGrounding(instruction);
  const push = (datum: ParsedDatum) => {
    const normalized = normalizeForGrounding(datum.text);
    const key = `${datum.kind}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    const fromInstruction =
      normalizedInstruction.length > 0 && normalizedInstruction.includes(normalized);
    datums.push(fromInstruction ? { ...datum, gates: false, fromInstruction } : datum);
  };

  let remaining = finalAnswer;
  for (const match of finalAnswer.matchAll(TIME_TOKEN)) {
    const text = match[0];
    push({
      text,
      kind: "time",
      patterns: [new RegExp(`(?<![\\d:.])${escapeRegExp(text)}(?!\\d)`)],
      gates: true,
    });
    remaining = remaining.split(text).join(" ");
  }

  for (const match of remaining.matchAll(NUMBER_TOKEN)) {
    const prefix = match[1]?.toLowerCase();
    const core = match[2].replace(/,/g, "");
    const suffix = match[3]?.toLowerCase();
    const digits = core.replace(/\D/g, "");
    if (!digits) continue;
    const hasDecimal = core.includes(".");
    const coreRe = escapeRegExp(core);
    // A bare core hit only counts when the number is specific enough that a
    // coincidental match on the page is unlikely.
    const specific = hasDecimal || digits.length >= 3;
    const barePattern = new RegExp(`(?<![\\d.])${coreRe}(?!\\d|\\.\\d)`);
    const text = match[0].trim().replace(/[,.]+$/, "");

    if (suffix === "%") {
      push({
        text,
        kind: "percent",
        patterns: [new RegExp(`(?<![\\d.])${coreRe}\\s?%`)],
        gates: true,
      });
      continue;
    }
    const currency = prefix ?? suffix;
    if (currency) {
      const aliases = CURRENCY_ALIASES[currency] ?? [currency];
      const patterns = aliases.flatMap((alias) => {
        const a = escapeRegExp(alias);
        // "sgd5", "sgd 5.00", "5sgd", "5.00 sgd"
        return [
          new RegExp(`${a}\\s?${coreRe}(?:\\.0+)?(?!\\d)`),
          new RegExp(`(?<![\\d.])${coreRe}(?:\\.0+)?\\s?${a}`),
        ];
      });
      if (specific) patterns.push(barePattern);
      push({ text, kind: "currency", patterns, gates: true });
      continue;
    }
    if (hasDecimal) {
      push({ text, kind: "decimal", patterns: [barePattern], gates: true });
      continue;
    }
    push({
      text,
      kind: "integer",
      patterns: [barePattern],
      // Short integers ("1)", "50+", "2.4 miles" → "4") are too ambiguous to
      // fail a run on, and years are almost always task context rather than a
      // finding; only long ones (zip codes, ids, populations) gate.
      gates: digits.length >= 4 && !YEAR_TOKEN.test(core),
    });
  }

  for (const match of finalAnswer.matchAll(ENTITY_TOKEN)) {
    const text = match[0].trim();
    if (text.split(/\s+/).length < 2) continue;
    push({
      text,
      kind: "entity",
      patterns: [new RegExp(spaceTolerant(text))],
      gates: false,
    });
  }

  return datums;
}

/** Best-effort page URL for a step, carried forward from earlier steps when absent. */
export function stepUrlHint(step: TrajectoryStep): string | undefined {
  const probeUrl = step.probeEvidence?.url;
  if (typeof probeUrl === "string" && probeUrl) return probeUrl;
  const fromArgs = firstUrl(safeStringify(step.actionArgs));
  if (fromArgs) return fromArgs;
  return firstUrl(toolOutputText(step));
}

function firstUrl(text: string): string | undefined {
  const match = /https?:\/\/[^\s"'\\)\]}>,]+/i.exec(text);
  return match?.[0];
}

export function isSearchEngineUrl(url: string | undefined): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    const match = /^https?:\/\/([^/?#]+)/i.exec(url);
    host = match?.[1] ?? url;
  }
  return SEARCH_ENGINE_HOST.test(host);
}

function safeStringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function toolOutputText(step: TrajectoryStep): string {
  const parts = [safeStringify(step.toolOutput?.result), step.toolOutput?.error ?? ""];
  for (const modality of step.agentEvidence?.modalities ?? []) {
    if (modality.type === "text") parts.push(modality.content);
    else if (modality.type === "json") parts.push(safeStringify(modality.content));
  }
  return parts.join("\n");
}

/**
 * Check that every key datum in the final answer appears in at least one step
 * output whose page was not a search engine. A number that only shows up in
 * Google/Bing snippets (or nowhere) was never verified on the target site.
 */
export function checkAnswerGrounding(
  finalAnswer: string,
  steps: TrajectoryStep[],
  instruction = "",
): GroundingResult | undefined {
  const datums = extractGroundingDatums(finalAnswer, instruction);
  if (datums.length === 0) return undefined;

  // Steps with no URL hint (a snapshot after navigation) inherit the page of
  // the step before them.
  const stepTexts: Array<{ text: string; searchEngine: boolean }> = [];
  let currentUrl: string | undefined;
  for (const step of steps) {
    const hint = stepUrlHint(step);
    if (hint) currentUrl = hint;
    stepTexts.push({
      text: normalizeForGrounding(toolOutputText(step)),
      searchEngine: isSearchEngineUrl(currentUrl),
    });
  }

  const checked: GroundingDatum[] = datums.map((datum) => {
    let groundedAtStep: number | undefined;
    let seenInSearch = false;
    for (let index = 0; index < stepTexts.length; index += 1) {
      const { text, searchEngine } = stepTexts[index];
      if (!datum.patterns.some((pattern) => pattern.test(text))) continue;
      if (searchEngine) {
        seenInSearch = true;
        continue;
      }
      groundedAtStep = index;
      break;
    }
    return {
      text: datum.text,
      kind: datum.kind,
      ...(groundedAtStep !== undefined && { groundedAtStep }),
      onlyInSearchEngine: groundedAtStep === undefined && seenInSearch,
      ...(datum.fromInstruction && { fromInstruction: true }),
    };
  });

  const ungrounded = checked.filter((datum) => datum.groundedAtStep === undefined);
  const gating = new Set(datums.filter((d) => d.gates).map((d) => `${d.kind}:${d.text}`));
  const isGating = (d: GroundingDatum) => gating.has(`${d.kind}:${d.text}`);
  const groundedNumeric = checked.filter(
    (d) => isGating(d) && d.groundedAtStep !== undefined,
  ).length;
  const ungroundedNumeric = ungrounded.filter(isGating).length;
  return {
    checked,
    ungrounded,
    groundedNumeric,
    ungroundedNumeric,
    // Secondary numbers (a comparison price read off a screenshot, a figure
    // paraphrased from a snippet) must not sink a row whose headline datum was
    // verified on the target site, so the gate needs every numeric datum to be
    // ungrounded. Tightening this to "any" flips ~1 in 5 legitimate passes.
    gatesOutcome: ungroundedNumeric > 0 && groundedNumeric === 0,
  };
}
