import type { ActResultData } from "@browserbasehq/stagehand-protocol/types";
import { TimeoutError } from "../../../errors.js";
import { fillValueCandidates, isLoneVariable, isVariable, redactor } from "../args.js";
import { choiceAnswer } from "../client.js";
import type { DecisionsConfig } from "../config.js";
import { ask, NONE, type TraceEntry } from "../pick.js";
import { invokeTool } from "../toolAct.js";
import { readToolDecision, toolQuestions } from "../tools.js";
import { runDrag } from "./families/drag.js";
import { runFill } from "./families/fill.js";
import { runPointer } from "./families/pointer.js";
import { runPress } from "./families/press.js";
import { runScroll } from "./families/scroll.js";
import { runSelect } from "./families/select.js";
import { failure, fallback } from "./outcomes.js";
import { capture } from "./page.js";
import type { DecisionsActDeps, DecisionsActOutcome, PipelineContext } from "./types.js";
import { FAMILIES, KEYS, POINTER_METHODS, resolveFamily, SCROLL_METHODS } from "./vocabulary.js";

/**
 * Experimental act pipeline that resolves an instruction through a decision
 * tree of decision-model questions instead of one LLM call:
 *
 *   intent fan-out → family-specific candidate view (pruned in code) →
 *   best/strict pick → bounded arguments → deterministic action → checks
 *
 * Any low-confidence node returns `fallback`, which the act driver reports as an abstention;
 * the reason is logged so eval runs can attribute every miss.
 */

const DEFAULT_ACT_CONFIDENCE = 0.7;

const NOT_AN_ACTION_CONFIDENCE = 0.9;

const MODIFIER_CHORD = /\b(ctrl|control|cmd|command|shift|alt|option|meta)\b\s*[+-]\s*\S/i;

export async function runDecisionsAct(
  config: DecisionsConfig,
  deps: DecisionsActDeps,
): Promise<DecisionsActOutcome> {
  const trace: TraceEntry[] = [];
  const performed: ActResultData["actions"] = [];
  try {
    const outcome = await decideAndAct(config, deps, trace, performed);
    // Whatever the decision model already did stays in the final result when it hands off.
    if (outcome.kind === "fallback" && !outcome.priorActions && performed.length > 0) {
      outcome.priorActions = [...performed];
    }
    deps.logger.info("Decisions act pipeline finished", {
      category: "decisions",
      instruction: deps.instruction,
      outcome: outcome.kind,
      reason: outcome.kind === "fallback" ? outcome.reason : "",
      trace: JSON.stringify(trace),
    });
    return outcome;
  } catch (error) {
    deps.logger.info("Decisions act pipeline errored", {
      category: "decisions",
      instruction: deps.instruction,
      outcome: "error",
      error: error instanceof Error ? error.message : String(error),
      trace: JSON.stringify(trace),
    });
    // A decision-model error after an action already ran must not drop that action from
    // the final result (and from the cache entry built out of it).
    if (performed.length > 0 && !(error instanceof TimeoutError)) {
      // Error text can quote selectors or typed values: same redaction as requests.
      const raw = error instanceof Error ? error.message : String(error);
      const message = (redactor(deps.variables) ?? ((text: string) => text))(raw).slice(0, 200);
      return fallback(`decision_error:${message}`, performed);
    }
    throw error;
  }
}

async function decideAndAct(
  config: DecisionsConfig,
  deps: DecisionsActDeps,
  trace: TraceEntry[],
  performed: ActResultData["actions"],
): Promise<DecisionsActOutcome> {
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
  if (config.targetReadiness && deps.settled) {
    ctx.earlySnapshot = capture(deps, trace);
    ctx.earlySnapshot.catch(() => {});
  }

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
        // A tool runs page code: not before the document has settled.
        await deps.settled;
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

export type { DecisionsActDeps, DecisionsActOutcome } from "./types.js";
