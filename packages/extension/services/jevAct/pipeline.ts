import type { Protocol } from "devtools-protocol";
import type { ActResultData, Action, Variables } from "@browserbasehq/stagehand-protocol/types";
import { TimeoutError } from "../../errors.js";
import type { StagehandLogger } from "../../logger.js";
import { diffCombinedTrees } from "../../understudy/a11y/snapshot/index.js";
import { resolveLocatorWithHops } from "../../understudy/deepLocator.js";
import type { Page } from "../../understudy/page.js";
import { trimTrailingTextNode } from "../../utils.js";
import {
  fillValueCandidates,
  groundedSpan,
  isLoneVariable,
  isVariable,
  matchOption,
  parseKey,
  parsePercent,
  quotedStrings,
  redactor,
  substituteVariables,
} from "./args.js";
import { invokeTool, type JevToolDeps } from "./toolAct.js";
import { readToolDecision, toolQuestions } from "./tools.js";
import { blockingSignal, readPageState } from "./pageState.js";
import {
  NONE,
  annotate,
  ask,
  pickTarget,
  type AskContext,
  type Snapshot,
  type TargetResult,
  type TraceEntry,
} from "./pick.js";
import {
  buildView,
  insideEditable,
  isMainDocumentScroller,
  isNameless,
  markEditable,
  nativeSelectOptions,
  nearbyTwins,
  parseOutline,
  selectedNativeOptions,
  type OutlineNode,
} from "./tree.js";
import { choiceAnswer, noulAnswer, type JevConfig, type JevResponse } from "./typesafeClient.js";

export { fillValueCandidates, parseKey, parsePercent } from "./args.js";

/**
 * Experimental act pipeline that resolves an instruction through a decision
 * tree of Jev (TypeSafe System One) questions instead of one LLM call:
 *
 *   intent fan-out → family-specific candidate view (pruned in code) →
 *   best/strict pick → bounded arguments → deterministic action → checks
 *
 * Any low-confidence node returns `fallback` so actService runs the existing
 * LLM pipeline; the reason is logged so eval runs can attribute every miss.
 */

export type JevActConfig = JevConfig & {
  /** Minimum confidence before acting on a node's answer. */
  actConfidence?: number;
  /**
   * `"checks"` (default): deterministic checks only — fill read-back and the
   * native-select flag. `"full"` adds a logged-only Jev yes/no over the page
   * diff. `"off"` disables every check.
   */
  verify?: "off" | "checks" | "full";
  /** When false, a Jev abstention fails the act instead of running the LLM pipeline. */
  llmFallback?: boolean;
  /**
   * The argument-only LLM call for unquoted text. Independent of `llmFallback`:
   * turn both off for a run with no LLM at all. Default true.
   */
  argumentLlm?: boolean;
  /** Ask Jev what kind of page this is when no target is found. Default true. */
  pageState?: boolean;
  /** False keeps only the per-act instrumentation log (eval baselines). Default true. */
  enabled?: boolean;
  /**
   * Click the runner-up when an ambiguous click provably changed nothing. Off
   * by default: effects the outline cannot show (aria-pressed, copy, play)
   * look like "nothing", and a second click is a second side effect.
   */
  retryNoEffect?: boolean;
  /** Show the LLM fallback Jev's shortlist before the whole tree on huge pages. Default false. */
  focusFallback?: boolean;
  /** Check cached actions against the page before replaying them. Default false. */
  cacheCheck?: boolean;
  /**
   * extract() on Jev. `"judge"`: only the completion yes/no replaces the second
   * LLM call. `"pick"`: Jev picks the elements holding each field's value and
   * code copies their text; the LLM extracts only when that does not fit.
   * Both send page or extracted content to TypeSafe. Default `"off"`.
   */
  extract?: "off" | "judge" | "pick";
  /** Resolve observe() through Jev first. Default false. */
  observe?: boolean;
  /**
   * Let act() invoke a WebMCP tool the page registered when Jev is sure the
   * tool is the request. Sends tool names and descriptions to TypeSafe. Default false.
   */
  tools?: boolean;
};

export type JevActDeps = {
  page: Page;
  logger: StagehandLogger;
  instruction: string;
  variables?: Variables;
  snapshotOptions: Parameters<Page["captureSnapshot"]>[0];
  ensureTimeRemaining: () => void;
  /** Open tab count, so checks can see an action that opened a new tab. */
  openPageCount?: () => number;
  /**
   * Argument-only LLM call: returns the literal text the instruction wants
   * typed (or null). Jev still chooses the element.
   */
  extractText?: (instruction: string) => Promise<string | null>;
  takeAction: (action: Action) => Promise<ActResultData>;
  /**
   * Resolves when the DOM has settled. The intent request needs no page, so
   * it runs while this is pending; nothing reads or touches the page before it.
   */
  settled?: Promise<void>;
  /** Present when `tools` is on and the act is not scoped to a locator. */
  webmcp?: JevToolDeps;
};

export type JevActOutcome =
  | {
      kind: "done";
      result: ActResultData;
      /** Must not be written to the act cache. */ noCache?: boolean;
      /** The act was a WebMCP tool call; `argumentLlm` when its input came from the LLM. */
      viaTool?: { argumentLlm: boolean };
    }
  | {
      kind: "fallback";
      reason: string;
      /** Already ran and must be kept in the final result. */
      priorActions?: ActResultData["actions"];
      /** Jev's shortlist; the LLM fallback can look at these instead of the whole page. */
      focusIds?: string[];
    };

type Done = Extract<JevActOutcome, { kind: "done" }>;
type Fallback = Extract<JevActOutcome, { kind: "fallback" }>;

type PipelineContext = AskContext & {
  config: JevActConfig;
  deps: JevActDeps;
  /** Every action that already ran, so an error or abstention later never loses one. */
  performed: ActResultData["actions"];
};

const DEFAULT_ACT_CONFIDENCE = 0.7;
const NOT_AN_ACTION_CONFIDENCE = 0.9;
const DIFF_BUDGET = 6000;
const MODIFIER_CHORD = /\b(ctrl|control|cmd|command|shift|alt|option|meta)\b\s*[+-]\s*\S/i;
/** A target with one of these roles is itself the thing to choose, not a control to expand. */
const LEAF_CHOICE_ROLES =
  /\b(option|menuitem|menuitemradio|menuitemcheckbox|radio|checkbox|switch|tab|treeitem)\b/i;
const CHECKABLE_ROLES = /\b(checkbox|switch|radio|menuitemcheckbox|menuitemradio)\b/i;
const EDITABLE_ROLES = /\b(textbox|searchbox|combobox|spinbutton|textarea)\b/i;
/** A runner-up at least this likely makes a no-effect click worth retrying on it. */
const RETRY_RUNNER_UP = 0.2;
const MERGED_FAMILY_MASS = 0.85;
const PAGE_STATE_NONE = 0.5;
const APPEAR_POLLS = 3;
const APPEAR_POLL_MS = 450;
/** Clicking one of these IS the choice; nothing is expected to open afterwards. */
const SELF_CONTAINED_CHOICE = /\b(gridcell|cell|link|image|img|listitem)\b/i;
const OPTION_LIKE = /\b(option|menuitem|menuitemradio|menuitemcheckbox|listitem|treeitem)\b/i;
const MAX_DOM_HINTS = 25;
const MAX_NATIVE_OPTIONS = 254;

export const FAMILIES: Record<string, string> = {
  click:
    "Click or tap an element: a button, link, checkbox, radio button, tab, menu item, calendar day, or a control that expands something. Includes opening, going to, or following something through a link or button on the page",
  double_click: "Explicitly double-click an element",
  hover: "Hover the mouse over an element without clicking",
  fill: "Type or fill text into an input field, search box, or text area",
  select: "Choose an option from a dropdown, combobox, or select menu",
  press: "Press a keyboard key such as Enter, Tab, or Escape",
  scroll: "Scroll the page or a container to a position or percentage",
  next_chunk: "Scroll down by one screen to the next chunk of the page",
  prev_chunk: "Scroll up by one screen to the previous chunk of the page",
  drag: "Drag one element and drop it onto another element",
  not_an_action:
    "Not a request to interact with the page at all: a general knowledge question, chit-chat, or nonsense",
  unsupported:
    "A browser task outside the other kinds: reading or extracting information, loading a typed URL in the address bar, or uploading a file",
};

export const KEYS = [
  "Enter",
  "Tab",
  "Escape",
  "Space",
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
];

export const POINTER_METHODS: Record<string, string> = {
  click: "click",
  double_click: "doubleClick",
  hover: "hover",
};

export const SCROLL_METHODS: Record<string, string> = {
  scroll: "scrollTo",
  next_chunk: "nextChunk",
  prev_chunk: "prevChunk",
};

export async function runJevActPipeline(
  config: JevActConfig,
  deps: JevActDeps,
): Promise<JevActOutcome> {
  const trace: TraceEntry[] = [];
  const performed: ActResultData["actions"] = [];
  try {
    const outcome = await decideAndAct(config, deps, trace, performed);
    // Whatever Jev already did stays in the final result when it hands off.
    if (outcome.kind === "fallback" && !outcome.priorActions && performed.length > 0) {
      outcome.priorActions = [...performed];
    }
    deps.logger.info("Jev act pipeline finished", {
      category: "jev",
      instruction: deps.instruction,
      outcome: outcome.kind,
      reason: outcome.kind === "fallback" ? outcome.reason : "",
      trace: JSON.stringify(trace),
    });
    return outcome;
  } catch (error) {
    deps.logger.info("Jev act pipeline errored", {
      category: "jev",
      instruction: deps.instruction,
      outcome: "error",
      error: error instanceof Error ? error.message : String(error),
      trace: JSON.stringify(trace),
    });
    // A Jev error after an action already ran must not drop that action from
    // the final result (and from the cache entry built out of it).
    if (performed.length > 0 && !(error instanceof TimeoutError)) {
      // Error text can quote selectors or typed values: same redaction as requests.
      const raw = error instanceof Error ? error.message : String(error);
      const message = (redactor(deps.variables) ?? ((text: string) => text))(raw).slice(0, 200);
      return fallback(`jev_error:${message}`, performed);
    }
    throw error;
  }
}

async function decideAndAct(
  config: JevActConfig,
  deps: JevActDeps,
  trace: TraceEntry[],
  performed: ActResultData["actions"],
): Promise<JevActOutcome> {
  // Chords and modifier clicks have no representation in the tree yet.
  if (MODIFIER_CHORD.test(deps.instruction)) return fallback("modifier_chord");

  const ctx: PipelineContext = {
    config,
    deps,
    trace,
    instruction: deps.instruction,
    threshold: config.actConfidence ?? DEFAULT_ACT_CONFIDENCE,
    logger: deps.logger,
    ensureTimeRemaining: deps.ensureTimeRemaining,
    performed,
    redact: redactor(deps.variables),
  };

  // Intent fan-out: every question that only needs the instruction rides in
  // one request, so press / not-an-action / whole-page scroll finish here.
  const fillValues = fillValueCandidates(deps.instruction, deps.variables);
  // Tool choice only needs the instruction too, so it costs no round trip of
  // its own, and a page without tools adds no question at all.
  const tools = deps.webmcp ? await deps.webmcp.tools.catch(() => []) : [];
  const asked = tools.length > 0 ? toolQuestions(deps.instruction, tools) : undefined;
  // Known from the schema alone: if this tool wins, only the LLM can fill it.
  const speculative = asked?.needsArgumentLlm;
  const speculativeInput =
    speculative && deps.webmcp?.fillArguments && config.argumentLlm !== false
      ? deps.webmcp.fillArguments(speculative).catch(() => null)
      : undefined;
  const intent = await ask(
    ctx,
    "intent",
    { instruction: deps.instruction, variables: Object.keys(deps.variables ?? {}) },
    {
      ...(fillValues.length > 0 && !isLoneVariable(fillValues)
        ? {
            // Always asked, even for a lone candidate: the only quoted string
            // in "type John into the 'Name' field" is the field's label.
            fill_value: {
              type: "choice" as const,
              instructions:
                "Which of these is the literal text the instruction wants typed into the field? A quoted field name or label is NOT the text to type. A %variable% placeholder stands for the text to type.",
              criteria: {
                ...Object.fromEntries(
                  fillValues.map((value, index) => [
                    `value_${index}`,
                    isVariable(value) ? { variable_placeholder: value } : { quoted_text: value },
                  ]),
                ),
                [NONE]: "None of these is the text to type; the text to type is not among them",
              },
            },
          }
        : {}),
      family: {
        type: "choice",
        instructions: "Which kind of browser action does the instruction ask for?",
        criteria: FAMILIES,
      },
      mouse_button: {
        type: "choice",
        instructions: "If the instruction is a click, which mouse button does it ask for?",
        criteria: {
          left: "A normal click, or no button mentioned, or not a click",
          right: "A right click or context-menu click",
          middle: "A middle click",
        },
      },
      toggle_state: {
        type: "choice",
        instructions:
          "If the instruction is about a checkbox, switch, or toggle, which END STATE does it ask for?",
        criteria: {
          on: "It must end up checked, enabled, selected, or turned on",
          off: "It must end up unchecked, disabled, deselected, or turned off",
          unspecified:
            "It only says to click or toggle it, or the instruction is not about a checkbox or switch",
        },
      },
      after_typing: {
        type: "choice",
        instructions: "If the instruction types text, what else does it ask for after typing?",
        criteria: {
          nothing: "Only typing the text, or the instruction does not type anything",
          pick_suggestion:
            "It also asks to choose one of the suggestions or autocomplete options that appear while typing",
        },
      },
      scroll_scope: {
        type: "choice",
        instructions: "If the instruction asks to scroll, what should be scrolled?",
        criteria: {
          whole_page: "The page itself, with no specific container, panel, modal, or iframe named",
          container:
            "A specific scrollable area inside the page, such as a modal, list, panel, or iframe",
          not_scroll: "The instruction is not about scrolling",
        },
      },
      key: {
        type: "choice",
        instructions: "If the instruction asks to press a keyboard key, which key?",
        criteria: {
          ...Object.fromEntries(KEYS.map((key) => [key, `The ${key} key`])),
          other: "Some other key, or the instruction is not a key press",
        },
      },
      ...asked?.questions,
    },
  );
  const intentEntry = trace[trace.length - 1]!;
  if (asked && deps.webmcp) {
    const decision = await readToolDecision(ctx, intent, asked, intentEntry);
    if (decision.kind === "tool") {
      let input = decision.input;
      let argumentLlm = false;
      if (!input && deps.webmcp.fillArguments && config.argumentLlm !== false) {
        argumentLlm = true;
        const started = performance.now();
        input =
          (await (decision.tool === speculative && speculativeInput
            ? speculativeInput
            : deps.webmcp.fillArguments(decision.tool).catch(() => null))) ?? undefined;
        trace.push({
          node: "tool_arguments_llm",
          ms: Math.round(performance.now() - started),
          speculative: decision.tool === speculative,
        });
      }
      if (input) {
        deps.ensureTimeRemaining();
        const result = await invokeTool(
          deps.webmcp,
          deps.instruction,
          deps.variables,
          decision.tool,
          input,
          trace,
        );
        // Replay only knows element actions.
        return { kind: "done", result, noCache: true, viaTool: { argumentLlm } };
      }
      intentEntry.tool_skip = "arguments_not_filled";
    } else {
      intentEntry.tool_skip = decision.reason;
    }
  }
  const family = resolveFamily(choiceAnswer(intent, "family"), ctx.threshold);
  Object.assign(intentEntry, {
    choice: family.choice,
    confidence: family.confidence,
    top: family.top,
  });
  if (family.confidence < ctx.threshold) return fallback(`intent_low_confidence:${family.top}`);

  if (family.choice === "not_an_action") {
    // Matches the LLM pipeline's null-action result without spending a call on it.
    if (family.confidence < NOT_AN_ACTION_CONFIDENCE) return fallback("not_an_action_unsure");
    return failure(deps.instruction, "Failed to perform act: No action found");
  }

  if (family.choice === "press") return await runPress(ctx, intent);
  if (family.choice in POINTER_METHODS) {
    return await runPointer(ctx, POINTER_METHODS[family.choice]!, intent);
  }
  if (family.choice in SCROLL_METHODS) {
    return await runScroll(ctx, SCROLL_METHODS[family.choice]!, intent);
  }
  if (family.choice === "fill") return await runFill(ctx, intent, fillValues);
  if (family.choice === "select") return await runSelect(ctx);
  if (family.choice === "drag") return await runDrag(ctx);
  return fallback(`unsupported_family:${family.choice}`);
}

/**
 * "Pick the Chicory suggestion" splits Jev between click and select, and
 * "open the folder" between click and double-click. Those pairs lead to the
 * same first step, so their combined weight decides, not the split.
 */
export function resolveFamily(
  answer: ReturnType<typeof choiceAnswer>,
  threshold: number,
): { choice: string; confidence: number; top: string } {
  const ranked = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
  const top = ranked
    .slice(0, 3)
    .map(([name, p]) => `${name}=${Math.round(p * 100) / 100}`)
    .join(",");
  if (answer.confidence >= threshold)
    return { choice: answer.choice, confidence: answer.confidence, top };

  const p = (name: string) => answer.probabilities[name] ?? 0;
  for (const [a, b, winner] of [
    ["click", "select", undefined],
    ["click", "double_click", "click"],
    // "Run the search": a button click and Enter do the same thing.
    ["click", "press", "click"],
  ] as const) {
    const combined = p(a) + p(b);
    if (combined >= MERGED_FAMILY_MASS && ranked[0] && [a, b].includes(ranked[0][0] as typeof a)) {
      return { choice: winner ?? (p(a) >= p(b) ? a : b), confidence: combined, top };
    }
  }
  return { choice: answer.choice, confidence: answer.confidence, top };
}

async function runPress(ctx: PipelineContext, intent: JevResponse): Promise<JevActOutcome> {
  const keyAnswer = choiceAnswer(intent, "key");
  const key =
    keyAnswer.choice !== "other" && keyAnswer.confidence >= ctx.threshold
      ? keyAnswer.choice
      : parseKey(ctx.instruction);
  if (!key) return fallback("press_no_key");

  return await act(ctx, {
    selector: "xpath=/html",
    description: `press ${key}`,
    method: "press",
    arguments: [key],
  });
}

async function runPointer(
  ctx: PipelineContext,
  method: string,
  intent: JevResponse,
): Promise<JevActOutcome> {
  const button = choiceAnswer(intent, "mouse_button");
  if (button.confidence < ctx.threshold) return fallback(`mouse_button_unsure:${button.choice}`);
  const buttonArgs = method === "click" && button.choice !== "left" ? [button.choice] : [];

  const snap = await snapshot(ctx.deps);
  // DOM hints cost a CDP round trip per nameless control: only when Jev is
  // actually about to be asked about them.
  ctx.prepare = () => addDomHints(ctx, snap);
  const picked = await pickTarget(
    ctx,
    "target",
    snap,
    ["pointer", "broad"],
    `Which element should receive the ${method} to carry out the instruction?`,
  );
  if (!picked.target) return await rejected(ctx, snap, "target_rejected", picked);
  const target = await preferVisibleTwin(ctx, snap, picked.target);

  // "Make sure X is checked" on a checked box: a click would undo it.
  const desired = choiceAnswer(intent, "toggle_state");
  if (
    method === "click" &&
    CHECKABLE_ROLES.test(target.role) &&
    desired.choice !== "unspecified" &&
    desired.confidence >= ctx.threshold
  ) {
    const isOn = target.flags.includes("checked") || target.flags.includes("selected");
    ctx.trace.push({
      node: "toggle_state",
      ms: 0,
      desired: desired.choice,
      current: isOn ? "on" : "off",
    });
    if (isOn === (desired.choice === "on")) {
      return {
        kind: "done",
        result: {
          success: true,
          message: `No action needed: ${describeLine(target)} is already ${desired.choice}`,
          actionDescription: describeLine(target),
          actions: [],
        },
      };
    }
  }

  const selector = selectorFor(snap, target);
  if (!selector) return fallback(`target_missing_xpath:${target.id}`);
  const action = { selector, description: describeLine(target), method, arguments: buttonArgs };

  if (method !== "click" || !ctx.config.retryNoEffect || ctx.config.verify === "off") {
    return await act(ctx, action, { before: snap });
  }

  // Opt-in (retryNoEffect): when the click provably changed nothing and Jev had
  // a credible second choice, try that one. Jev's pre-visibility pick is a copy
  // of the same control, never a "runner-up".
  const runnerUp = picked.ranked.find(
    (entry) =>
      entry.id !== target.id && entry.id !== picked.target!.id && entry.p >= RETRY_RUNNER_UP,
  );
  if (!runnerUp) return await act(ctx, action, { before: snap });

  const probe = beginEffectProbe(ctx);
  const first = await act(ctx, action, { before: snap });
  if (first.kind === "fallback") return first;
  const after = await probe.unchanged(snap);
  if (!after) return first;

  // Re-resolve the runner-up in the fresh snapshot: a positional XPath from
  // before the click may now point at a different element.
  const before = snap.nodes.find((node) => node.id === runnerUp.id);
  const retryNode = after.nodes.find((node) => node.id === runnerUp.id);
  const retrySelector = retryNode ? selectorFor(after, retryNode) : undefined;
  if (
    !before ||
    !retryNode ||
    !retrySelector ||
    retryNode.role !== before.role ||
    retryNode.name !== before.name
  ) {
    return first;
  }
  ctx.trace.push({ node: "retry_runner_up", ms: 0, choice: retryNode.id, p: runnerUp.p });
  const second = await act(ctx, {
    selector: retrySelector,
    description: describeLine(retryNode),
    method,
    arguments: buttonArgs,
  });
  // The first click provably did nothing and the retry failed: hand off with
  // the first action on record rather than report (and cache) a no-op.
  if (second.kind === "fallback") return second;
  // Two clicks for one instruction is a recovery, not a recipe to replay.
  return { ...merge(first, second), noCache: true };
}

async function runScroll(
  ctx: PipelineContext,
  method: string,
  intent: JevResponse,
): Promise<JevActOutcome> {
  let args: string[] = [];
  if (method === "scrollTo") {
    const percent = parsePercent(ctx.instruction);
    if (!percent) return fallback("scroll_no_percent");
    args = [percent];
  }

  const snap = await snapshot(ctx.deps);
  // "Scroll the page" names no element, so asking Jev to match one only
  // produces hedged answers; the scope decides the main document in code.
  const scope = choiceAnswer(intent, "scroll_scope");
  let target =
    scope.choice === "whole_page" && scope.confidence >= ctx.threshold
      ? buildView(snap.nodes, "scroll").find((node) => isMainDocumentScroller(snap.nodes, node))
      : undefined;
  ctx.trace.push({
    node: "scroll_scope",
    ms: 0,
    choice: scope.choice,
    confidence: scope.confidence,
    resolved: target?.id ?? null,
  });
  if (!target) {
    const picked = await pickTarget(
      ctx,
      "target",
      snap,
      ["scroll"],
      "Which page or scrollable container should be scrolled to carry out the instruction?",
    );
    if (!picked.target) return await rejected(ctx, snap, "scroll_target_rejected", picked);
    target = picked.target;
  }

  const selector = selectorFor(snap, target);
  if (!selector) return fallback(`target_missing_xpath:${target.id}`);
  return await act(ctx, {
    selector,
    description: `${method} ${describeLine(target)}`,
    method,
    arguments: args,
  });
}

async function runFill(
  ctx: PipelineContext,
  intent: JevResponse,
  values: string[],
): Promise<JevActOutcome> {
  // The text to type: a lone declared %variable% (never a label), else Jev's
  // choice among quoted strings, else an argument-only LLM call for unquoted text.
  let value: string | undefined;
  if (isLoneVariable(values)) {
    value = values[0];
  } else if (values.length > 0) {
    const answer = choiceAnswer(intent, "fill_value");
    ctx.trace.push({
      node: "fill_value",
      ms: 0,
      choice: answer.choice,
      confidence: answer.confidence,
    });
    if (answer.choice !== NONE && answer.confidence >= ctx.threshold) {
      value = values[Number(answer.choice.slice("value_".length))];
    } else if (answer.choice !== NONE) {
      return fallback(`fill_value_unsure:${answer.choice}@${answer.confidence}`);
    }
  }
  const extracting = value === undefined ? extractText(ctx) : undefined;
  if (value === undefined && !extracting) return fallback("fill_no_value");

  const snap = await snapshot(ctx.deps);
  const [picked, extracted] = await Promise.all([
    pickTarget(
      ctx,
      "target",
      snap,
      ["input", "broad"],
      "Which field should the text be entered into?",
      {
        quotedTargets: quotedStrings(ctx.instruction).filter((quoted) => quoted !== value),
      },
    ),
    extracting,
  ]);
  value ??= extracted ?? undefined;
  if (value === undefined) return fallback("fill_value_not_extracted");
  if (!picked.target) return await rejected(ctx, snap, "target_rejected", picked);
  const target = picked.target;

  const selector = selectorFor(snap, target);
  if (!selector) return fallback(`target_missing_xpath:${target.id}`);
  const expectedValue = substituteVariables(value, ctx.deps.variables);
  let filled = await act(
    ctx,
    { selector, description: describeLine(target), method: "fill", arguments: [value] },
    { expectedValue },
  );
  // Search boxes that swap themselves for a richer widget on focus leave the
  // picked node detached; the same question over a fresh snapshot finds the new one.
  if (isDetached(filled)) {
    const fresh = await snapshot(ctx.deps);
    const again = await pickTarget(
      ctx,
      "target_reacquired",
      fresh,
      ["input", "broad"],
      "Which field should the text be entered into?",
      {
        quotedTargets: quotedStrings(ctx.instruction).filter((quoted) => quoted !== value),
      },
    );
    const freshSelector = again.target ? selectorFor(fresh, again.target) : undefined;
    if (again.target && freshSelector) {
      filled = await act(
        ctx,
        {
          selector: freshSelector,
          description: describeLine(again.target),
          method: "fill",
          arguments: [value],
        },
        { expectedValue },
      );
    }
  }
  if (filled.kind === "fallback") return filled;

  // "…and pick the suggestion": choose among what the typing made appear.
  const afterTyping = choiceAnswer(intent, "after_typing");
  if (afterTyping.choice !== "pick_suggestion" || afterTyping.confidence < ctx.threshold)
    return filled;
  const chosen = await chooseFromAppeared(
    ctx,
    snap,
    target.id,
    "suggestion",
    "Which suggestion or autocomplete option does the instruction ask to choose?",
    "wait",
  );
  // The instruction asked for a suggestion and none was chosen: that is not a
  // success to report. The LLM path gets the page as it now is.
  if (chosen.kind === "nothing_appeared")
    return fallback("suggestion_none_appeared", filled.result.actions);
  if (chosen.kind === "fallback")
    return fallback(chosen.reason, filled.result.actions, chosen.focusIds);
  return merge(filled, chosen);
}

async function runSelect(ctx: PipelineContext): Promise<JevActOutcome> {
  const snap = await snapshot(ctx.deps);
  const picked = await pickTarget(
    ctx,
    "target",
    snap,
    ["select", "broad"],
    "Which dropdown, combobox, or select control does the instruction refer to?",
  );
  if (!picked.target) return await rejected(ctx, snap, "target_rejected", picked);
  const target = picked.target;
  const selector = selectorFor(snap, target);
  if (!selector) return fallback(`target_missing_xpath:${target.id}`);

  // Native select: the role decides this deterministically, replacing the
  // prompt's CASE 1 / CASE 2 dropdown rules.
  const options = nativeSelectOptions(snap.nodes, target);
  if (options.length > 0) {
    let option = matchOption(options, ctx.instruction, target.name);
    if (!option) {
      if (options.length > MAX_NATIVE_OPTIONS) return fallback("select_too_many_options");
      const response = await ask(
        ctx,
        "argument",
        { instruction: ctx.instruction },
        {
          option: {
            type: "choice",
            instructions:
              "Which option does the instruction ask to choose? A quoted dropdown name or placeholder is NOT the option to choose.",
            criteria: {
              ...Object.fromEntries(
                options.map((candidate, index) => [`option_${index}`, candidate]),
              ),
              [NONE]: "None of these options matches the instruction",
            },
          },
        },
      );
      const answer = choiceAnswer(response, "option");
      annotate(ctx.trace, { choice: answer.choice, confidence: answer.confidence });
      if (answer.choice === NONE || answer.confidence < ctx.threshold) {
        return fallback(`select_option_low_confidence:${answer.choice}@${answer.confidence}`);
      }
      option = options[Number(answer.choice.slice("option_".length))]!;
    }
    const selected = await act(
      ctx,
      {
        selector,
        description: describeLine(target),
        method: "selectOptionFromDropdown",
        arguments: [option],
      },
      { before: snap },
    );
    if (selected.kind === "fallback" || ctx.config.verify === "off") return selected;

    // selectOption reports success even when nothing matched; the [selected]
    // flag in a fresh snapshot is the read-back.
    const after = await snapshot(ctx.deps);
    const refreshed = after.nodes.find((node) => node.id === target.id);
    const matched = refreshed
      ? selectedNativeOptions(after.nodes, refreshed).includes(option)
      : undefined;
    ctx.trace.push({ node: "verify_select", ms: 0, match: matched ?? null });
    return matched === false ? fallback("select_readback_mismatch") : selected;
  }

  // The "dropdown" Jev matched is already the thing to choose (a radio, a
  // menu item, an open listbox option): one click, no expand step.
  if (LEAF_CHOICE_ROLES.test(target.role)) {
    return await act(
      ctx,
      { selector, description: describeLine(target), method: "click", arguments: [] },
      { before: snap },
    );
  }

  // Custom dropdown: expand, then choose among what appeared.
  const expand = await act(ctx, {
    selector,
    description: describeLine(target),
    method: "click",
    arguments: [],
  });
  if (expand.kind === "fallback") return expand;

  const question = "Which element is the option the instruction asks to choose?";
  // Anything that may open a list gets the polling; a calendar day or a link does not.
  const selfContained = SELF_CONTAINED_CHOICE.test(target.role);
  const patience = selfContained ? "once" : "wait";
  let chosen = await chooseFromAppeared(ctx, snap, target.id, "option", question, patience);
  let done: Done = expand;

  // An editable combobox that shows nothing on click filters as you type.
  if (chosen.kind === "nothing_appeared" && EDITABLE_ROLES.test(target.role)) {
    const text = await optionText(ctx, target);
    if (text) {
      const typed = await act(ctx, {
        selector,
        description: describeLine(target),
        method: "fill",
        arguments: [text],
      });
      if (typed.kind === "fallback") return fallback(typed.reason, expand.result.actions);
      done = merge(expand, typed);
      chosen = await chooseFromAppeared(ctx, snap, target.id, "option", question, "wait");
    }
  }

  // The earlier actions already happened: hand them to the LLM path so the
  // final result (and the cache entry built from it) still contains every step.
  // Nothing opened. For a calendar day or a link the click was the whole
  // action. For anything that should have opened a list, the option was NOT
  // chosen: options already in the tree before the click never count as
  // "appeared", and the LLM path's second step looks at the whole page then.
  if (chosen.kind === "nothing_appeared") {
    return selfContained ? done : fallback("option_none_appeared", done.result.actions);
  }
  if (chosen.kind === "fallback")
    return fallback(chosen.reason, done.result.actions, chosen.focusIds);
  return merge(done, chosen);
}

async function runDrag(ctx: PipelineContext): Promise<JevActOutcome> {
  const snap = await snapshot(ctx.deps);
  await addDomHints(ctx, snap);
  // Source and destination are independent questions over the same page.
  const [source, destination] = await Promise.all([
    pickTarget(
      ctx,
      "drag_source",
      snap,
      ["broad", "pointer"],
      "Which element does the instruction ask to drag?",
      {
        quotedTargets: [],
      },
    ),
    pickTarget(
      ctx,
      "drag_destination",
      snap,
      ["broad", "pointer"],
      "Onto which element does the instruction ask to drop the dragged element?",
      { quotedTargets: [] },
    ),
  ]);
  if (!source.target) return await rejected(ctx, snap, "drag_source_rejected", source);
  if (!destination.target)
    return await rejected(ctx, snap, "drag_destination_rejected", destination);
  if (source.target.id === destination.target.id) return fallback("drag_same_element");

  const from = selectorFor(snap, source.target);
  const to = selectorFor(snap, destination.target);
  if (!from || !to) return fallback("target_missing_xpath:drag");
  return await act(
    ctx,
    {
      selector: from,
      description: `drag ${describeLine(source.target)} onto ${describeLine(destination.target)}`,
      method: "dragAndDrop",
      arguments: [to],
    },
    { before: snap },
  );
}

/**
 * Second step of two-step widgets: re-snapshot, keep only what the previous
 * action made appear, and let Jev choose among that.
 */
async function chooseFromAppeared(
  ctx: PipelineContext,
  before: Snapshot,
  triggerId: string,
  label: string,
  question: string,
  patience: "wait" | "once",
): Promise<Done | Fallback | { kind: "nothing_appeared" }> {
  // Suggestion lists are usually fetched after the keystrokes; an immediate
  // snapshot sees only the changed input. Poll briefly when one is expected.
  const startedAt = Date.now();
  let after = await snapshot(ctx.deps);
  let filter = appearedFilter(before, after, triggerId);
  // Keep polling until real choices show up: the first thing to "appear" is
  // often just the field's own changed state or a loading row.
  const ready = () =>
    buildView(after.nodes, "option").some((node) => filter(node) && OPTION_LIKE.test(node.role));
  for (let attempt = 0; patience === "wait" && attempt < APPEAR_POLLS && !ready(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, APPEAR_POLL_MS));
    after = await snapshot(ctx.deps);
    filter = appearedFilter(before, after, triggerId);
  }
  if (!hasAppeared(after, filter)) {
    ctx.trace.push({ node: `${label}_target`, ms: Date.now() - startedAt, options: 0 });
    return { kind: "nothing_appeared" };
  }

  const picked = await pickTarget(ctx, `${label}_target`, after, ["option", "broad"], question, {
    filter,
    quotedTargets: quotedStrings(ctx.instruction),
  });
  if (!picked.target)
    return fallback(`${label}_rejected:${picked.reason}`, undefined, focusIds(picked));
  const selector = selectorFor(after, picked.target);
  if (!selector) return fallback(`target_missing_xpath:${picked.target.id}`);
  return await act(
    ctx,
    { selector, description: describeLine(picked.target), method: "click", arguments: [] },
    { before: after },
  );
}

function appearedFilter(before: Snapshot, after: Snapshot, triggerId: string) {
  const appeared = new Set(
    parseOutline(diffCombinedTrees(before.tree, after.tree)).map((node) => node.id),
  );
  const trigger = before.nodes.find((node) => node.id === triggerId);
  // The typed-into field shows up as "changed" (and some sites swap it for a
  // new node); it is never one of the choices it opened.
  return (node: OutlineNode) =>
    node.id !== triggerId &&
    appeared.has(node.id) &&
    !(EDITABLE_ROLES.test(node.role) && (!trigger || node.name === trigger.name)) &&
    // The field's own echoed text is not a suggestion either.
    !insideEditable(after.nodes, node);
}

function hasAppeared(after: Snapshot, filter: (node: OutlineNode) => boolean): boolean {
  return (
    buildView(after.nodes, "option").some(filter) || buildView(after.nodes, "broad").some(filter)
  );
}

/** Text to type into a filter-as-you-type combobox: the quoted option, else an argument-only LLM call. */
async function optionText(ctx: PipelineContext, control: OutlineNode): Promise<string | undefined> {
  const quoted = quotedStrings(ctx.instruction).filter(
    (value) => value.toLowerCase() !== control.name.toLowerCase(),
  );
  if (quoted.length === 1) return quoted[0];
  return (await extractText(ctx)) ?? undefined;
}

function extractText(ctx: PipelineContext): Promise<string | null> | undefined {
  const extract = ctx.config.argumentLlm === false ? undefined : ctx.deps.extractText;
  if (!extract) return undefined;
  const startedAt = Date.now();
  return extract(ctx.instruction)
    .then((text) => {
      const span =
        text === null ? undefined : groundedSpan(text, ctx.instruction, ctx.deps.variables);
      ctx.trace.push({
        node: "extract_text_llm",
        ms: Date.now() - startedAt,
        found: text !== null,
        grounded: span !== undefined,
        recased: span !== undefined && span !== text?.trim(),
      });
      return span ?? null;
    })
    .catch((error: unknown) => {
      ctx.trace.push({
        node: "extract_text_llm",
        ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
}

/**
 * No target was accepted. Before paying for the LLM, ask what kind of page
 * this is: on a bot wall nobody will find the element.
 */
async function rejected(
  ctx: PipelineContext,
  snap: Snapshot,
  label: string,
  picked: TargetResult,
): Promise<JevActOutcome> {
  let suffix = "";
  // Only when Jev leaned toward "not on this page". A split between plausible
  // candidates is not a page problem, and the LLM should not wait for this.
  if (ctx.config.pageState !== false && picked.none >= PAGE_STATE_NONE) {
    try {
      const state = await readPageState(ctx, snap.nodes, withoutQuery(ctx.deps.page.url()));
      const blocked = blockingSignal(state);
      if (blocked) {
        return failure(
          ctx.instruction,
          `Failed to perform act: the page is blocked (${blocked.replace("_", " ")}), so the element cannot be reached`,
        );
      }
      const notable = Object.entries(state)
        .filter(([, score]) => score >= 0.7)
        .map(([signal]) => signal);
      if (notable.length > 0) suffix = `|page=${notable.join("+")}`;
    } catch (error) {
      ctx.trace.push({
        node: "page_state",
        ms: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return fallback(`${label}:${picked.reason}${suffix}`, undefined, focusIds(picked));
}

/** Only a shortlist Jev actually believed in; a flat guess would just mislead the LLM. */
function isDetached(outcome: Done | Fallback): boolean {
  return (
    outcome.kind === "fallback" &&
    /notconnected|not connected|detached|no node (with|found)|stale|could not find an element/i.test(
      outcome.reason,
    )
  );
}

function focusIds(picked: TargetResult): string[] | undefined {
  return picked.credible ? picked.ranked.map((entry) => entry.id) : undefined;
}

async function act(
  ctx: PipelineContext,
  action: Action,
  options: { before?: Snapshot; expectedValue?: string } = {},
): Promise<Done | Fallback> {
  // Press and whole-page scroll get here without ever taking a snapshot.
  await ctx.deps.settled;
  const urlBefore = ctx.deps.page.url();
  const pagesBefore = ctx.deps.openPageCount?.();
  ctx.deps.ensureTimeRemaining();
  const startedAt = Date.now();
  const result = await ctx.deps.takeAction(action);
  ctx.trace.push({
    node: "act",
    ms: Date.now() - startedAt,
    method: action.method ?? "",
    success: result.success,
  });
  if (!result.success) {
    return fallback(`action_failed:${(ctx.redact ?? ((text: string) => text))(result.message)}`);
  }
  ctx.performed.push(...result.actions);
  if (ctx.config.verify === "off") return { kind: "done", result };

  if (options.expectedValue !== undefined) {
    const readback = await readInputValue(ctx.deps, action.selector);
    ctx.trace.push({ node: "verify_readback", ms: 0, match: readback === options.expectedValue });
    if (readback !== undefined && readback !== options.expectedValue) {
      return fallback("fill_readback_mismatch");
    }
    return { kind: "done", result };
  }

  // Scroll position never shows up in the accessibility tree diff.
  const scrolls = Object.values(SCROLL_METHODS).includes(action.method ?? "");
  if (ctx.config.verify === "full" && options.before && !scrolls) {
    await verifyByDiff(ctx, options.before, action, urlBefore, pagesBefore);
  }
  return { kind: "done", result };
}

/**
 * Deterministic "nothing happened": same URL, same tab count, and an outline
 * identical in both directions (diffCombinedTrees alone only sees additions,
 * so a closed modal or a deleted row would look like no effect).
 */
function beginEffectProbe(ctx: PipelineContext) {
  const urlBefore = ctx.deps.page.url();
  const pagesBefore = ctx.deps.openPageCount?.();
  return {
    /** The fresh snapshot when nothing changed, else undefined. */
    async unchanged(before: Snapshot): Promise<Snapshot | undefined> {
      try {
        if (ctx.deps.page.url() !== urlBefore) return undefined;
        if (pagesBefore !== undefined && ctx.deps.openPageCount?.() !== pagesBefore)
          return undefined;
        const after = await snapshot(ctx.deps);
        const same = normalizeTree(before.tree) === normalizeTree(after.tree);
        ctx.trace.push({ node: "effect_probe", ms: 0, changed: !same });
        return same ? after : undefined;
      } catch {
        // Out of time or the page went away: the action stands.
        return undefined;
      }
    },
  };
}

function normalizeTree(tree: string): string {
  return tree
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Logged only (verify: "full"): records the Noul so runs can measure its
 * calibration against the eval's own outcome, without changing the act result.
 */
async function verifyByDiff(
  ctx: PipelineContext,
  before: Snapshot,
  action: Action,
  urlBefore: string,
  pagesBefore: number | undefined,
): Promise<void> {
  try {
    // The action already succeeded; running out of time here must not undo that.
    try {
      ctx.deps.ensureTimeRemaining();
    } catch {
      ctx.trace.push({ node: "verify", ms: 0, skipped: "no_time_remaining" });
      return;
    }
    const after = await ctx.deps.page.captureSnapshot(ctx.deps.snapshotOptions);
    const changes = diffCombinedTrees(before.tree, after.combinedTree).slice(0, DIFF_BUDGET);
    const response = await ask(
      ctx,
      "verify",
      {
        instruction: ctx.instruction,
        action: `${action.method} ${action.description}`,
        url_before: urlBefore,
        url_after: ctx.deps.page.url(),
        new_tabs_opened:
          pagesBefore === undefined
            ? null
            : Math.max(0, (ctx.deps.openPageCount?.() ?? 0) - pagesBefore),
        page_changes: changes.trim() ? changes : "(no accessibility tree changes)",
      },
      {
        succeeded: {
          type: "noul",
          instructions:
            "After the action was performed, did the page change in the way the instruction intended?",
        },
      },
    );
    annotate(ctx.trace, { noul: noulAnswer(response, "succeeded").noul });
  } catch (error) {
    ctx.trace.push({
      node: "verify",
      ms: 0,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Icon-only controls reach the outline with a role and nothing else. Their
 * DOM attributes (aria-label, title, class, icon href…) are the only handle.
 */
async function addDomHints(ctx: PipelineContext, snap: Snapshot): Promise<void> {
  const nameless = buildView(snap.nodes, "pointer")
    .filter((node) => isNameless(snap.nodes, node))
    .slice(0, MAX_DOM_HINTS);
  if (nameless.length === 0) return;

  const startedAt = Date.now();
  const hints = new Map<string, string>();
  await Promise.all(
    nameless.map(async (node) => {
      const selector = selectorFor(snap, node);
      const hint = selector ? await readDomHint(ctx.deps, selector) : undefined;
      if (hint) hints.set(node.id, hint);
    }),
  );
  ctx.domHints = hints;
  ctx.trace.push({
    node: "dom_hints",
    ms: Date.now() - startedAt,
    nameless: nameless.length,
    found: hints.size,
  });
}

function domHintOf(this: Element): string {
  const parts: string[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value && value.trim()) parts.push(`${label}=${value.trim().slice(0, 60)}`);
  };
  push("aria-label", this.getAttribute("aria-label"));
  push("title", this.getAttribute("title"));
  push("id", this.id);
  push("class", typeof this.className === "string" ? this.className : "");
  push("data-testid", this.getAttribute("data-testid") ?? this.getAttribute("data-test"));
  push("href", this.getAttribute("href"));
  const icon = this.querySelector("svg use, img, i, svg title");
  if (icon) {
    push(
      "icon",
      icon.getAttribute("href") ??
        icon.getAttribute("xlink:href") ??
        icon.getAttribute("alt") ??
        icon.getAttribute("src"),
    );
    push("icon-class", icon.getAttribute("class"));
    if (icon.tagName.toLowerCase() === "title") push("icon-title", icon.textContent);
  }
  return parts.join(" ");
}

/**
 * Pages render the same control twice (desktop and mobile navs, hover
 * overlays) and only one copy is really there for the user. Jev cannot tell
 * identical descriptions apart, so the DOM decides.
 */
async function preferVisibleTwin(
  ctx: PipelineContext,
  snap: Snapshot,
  target: OutlineNode,
): Promise<OutlineNode> {
  // Same item only. Identical-looking controls elsewhere on the page belong
  // to other items, and swapping to one of those changes WHAT gets acted on.
  const twins = nearbyTwins(snap.nodes, target);
  if (twins.length < 2) return target;

  const own = selectorFor(snap, target);
  if (own && (await isShown(ctx.deps, own))) return target;
  for (const twin of twins) {
    if (twin.id === target.id) continue;
    const selector = selectorFor(snap, twin);
    if (selector && (await isShown(ctx.deps, selector))) {
      ctx.trace.push({ node: "visible_twin", ms: 0, from: target.id, choice: twin.id });
      return twin;
    }
  }
  return target;
}

function shownInPage(this: Element): boolean {
  const rect = this.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  // oxlint-disable-next-line typescript/no-this-alias -- runs in the page with the element as `this`
  for (let element: Element | null = this; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      parseFloat(style.opacity) === 0
    ) {
      return false;
    }
    // Hover overlays park their content outside a clipping ancestor: the
    // control has a size, but none of it falls inside what that ancestor shows.
    // Only hard clipping: a scroll container merely has the control scrolled
    // out of view, and the click scrolls it back in.
    const hard = (value: string) => value === "hidden" || value === "clip";
    const clips = hard(style.overflowX) || hard(style.overflowY);
    if (
      element !== this &&
      clips &&
      element !== document.documentElement &&
      element !== document.body
    ) {
      const box = element.getBoundingClientRect();
      const overlapX = Math.min(rect.right, box.right) - Math.max(rect.left, box.left);
      const overlapY = Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top);
      if (overlapX <= 0 || overlapY <= 0) return false;
    }
  }
  return true;
}

async function isShown(deps: JevActDeps, selector: string): Promise<boolean> {
  try {
    const locator = await resolveLocatorWithHops(deps.page, deps.page.mainFrame(), selector);
    const session = locator.getFrame().session;
    const { objectId } = await locator.resolveNode();
    try {
      const response = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        { objectId, functionDeclaration: shownInPage.toString(), returnByValue: true },
      );
      return Boolean(response.result.value);
    } finally {
      await session.send<never>("Runtime.releaseObject", { objectId }).catch(() => {});
    }
  } catch {
    // Unknown is not hidden: keep Jev's pick.
    return true;
  }
}

async function readDomHint(deps: JevActDeps, selector: string): Promise<string | undefined> {
  try {
    const locator = await resolveLocatorWithHops(deps.page, deps.page.mainFrame(), selector);
    const session = locator.getFrame().session;
    const { objectId } = await locator.resolveNode();
    try {
      const response = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        { objectId, functionDeclaration: domHintOf.toString(), returnByValue: true },
      );
      const hint = String(response.result.value ?? "").trim();
      return hint || undefined;
    } finally {
      await session.send<never>("Runtime.releaseObject", { objectId }).catch(() => {});
    }
  } catch {
    return undefined;
  }
}

async function readInputValue(deps: JevActDeps, selector: string): Promise<string | undefined> {
  try {
    const locator = await resolveLocatorWithHops(deps.page, deps.page.mainFrame(), selector);
    return await locator.inputValue();
  } catch {
    return undefined;
  }
}

async function snapshot(deps: JevActDeps): Promise<Snapshot> {
  await deps.settled;
  deps.ensureTimeRemaining();
  const { combinedTree, combinedXpathMap, combinedEditableIds } = await deps.page.captureSnapshot(
    deps.snapshotOptions,
  );
  const nodes = parseOutline(combinedTree);
  markEditable(nodes, combinedEditableIds);
  return { tree: combinedTree, xpathMap: combinedXpathMap as Record<string, string>, nodes };
}

/** Query strings and fragments carry tokens; page-state questions only need where we are. */
function withoutQuery(url: string): string {
  return url.replace(/[?#].*$/, "");
}

function selectorFor(snap: Snapshot, node: OutlineNode): string | undefined {
  const xpath = trimTrailingTextNode(snap.xpathMap[node.id]);
  return xpath ? `xpath=${xpath}` : undefined;
}

function describeLine(node: OutlineNode): string {
  return node.name ? `${node.role}: ${node.name}` : node.role;
}

function merge(first: Done, second: Done): Done {
  return {
    kind: "done",
    result: {
      success: first.result.success && second.result.success,
      message: `${first.result.message} → ${second.result.message}`,
      actionDescription: first.result.actionDescription,
      actions: [...first.result.actions, ...second.result.actions],
    },
  };
}

function failure(instruction: string, message: string): Done {
  return {
    kind: "done",
    result: { success: false, message, actionDescription: instruction, actions: [] },
  };
}

function fallback(
  reason: string,
  priorActions?: ActResultData["actions"],
  focus?: string[],
): Fallback {
  return {
    kind: "fallback",
    reason,
    ...(priorActions?.length ? { priorActions } : {}),
    ...(focus?.length ? { focusIds: focus } : {}),
  };
}
