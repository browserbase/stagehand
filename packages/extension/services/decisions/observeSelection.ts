import type { Action, Variables } from "@browserbasehq/stagehand-protocol/types";
import { settleAll } from "./concurrency.js";
import {
  choiceAnswer,
  decide,
  noulAnswer,
  type DecisionModelConfig,
  type DecisionQuestion,
} from "./client.js";
import { fillValueCandidates, quotedStrings, redactDeep, redactor } from "./args.js";
import {
  isInteractive,
  observationView,
  matchesObservationType,
  type ObservationCandidate,
  type ObservationSnapshot,
} from "./observeCandidates.js";
import { parseObservationSection, resolveObservationSection } from "./observeSection.js";

export type ObservationOutcome =
  | { kind: "done"; actions: Action[] }
  | { kind: "fallback"; reason: string };
const ACCEPT = 0.8;
const REJECT = 0.1;
const CONFIDENCE = 0.7;
const VERIFICATION_CONFIDENCE = 0.9;
const MAX_DISCOVERY_CANDIDATES = 400;
const MAX_SELECTION_CANDIDATES = 600;
const SELECTION_BATCH_SIZE = 120;
const CLEF_FLASH_INPUT_BYTES = 12000;

export type ObservationIntent =
  | { kind: "intent"; operation: string; cardinality: string; targetType: string }
  | { kind: "fallback"; reason: string };

export async function classifyObservation(
  config: DecisionModelConfig,
  instruction: string,
  variables?: Variables,
): Promise<ObservationIntent> {
  const questions: Record<string, DecisionQuestion> = {
    cardinality: {
      type: "choice",
      instructions: "How many matching elements does the user's observation request ask to return?",
      criteria: {
        one: "One specific target",
        all: "Several matching elements, each matching element, every match, or all matches",
      },
    },
    operation: {
      type: "choice",
      instructions:
        "Which method does the user explicitly ask to perform? Finding or locating elements alone uses default. Do not invent values or infer a click when merely finding fields.",
      criteria: {
        default: "Only find/locate targets; choose each target's normal method",
        click: "Explicit click or toggle",
        fill: "Explicit type/fill with literal supplied text",
        hover: "Explicit hover",
        doubleClick: "Explicit double click",
        unsupported:
          "Select an option, scroll, key press, drag, upload, or another operation needing other arguments",
      },
    },
    kind: {
      type: "choice",
      instructions: "What kind of target does the instruction seek?",
      criteria: {
        supported: "Controls, links, form fields, or headings",
        other: "Other readable text, paragraphs, sections, or unsupported page content",
      },
    },
  };

  questions.target_type = {
    type: "choice",
    instructions:
      "Which element kind does the request explicitly seek? Use any for mixed kinds, generic controls, or an unspecified kind.",
    criteria: {
      link: "Links or anchors, without specifying text or image representation",
      text_link: "Specifically visible text links or title links, excluding image-only links",
      button: "Only buttons, including submit buttons",
      field: "Only form input fields, textboxes, selectors, checkboxes or radio inputs",
      heading: "Only headings or headers",
      any: "Mixed kinds, generic interactive elements, containers, or unspecified kind",
    },
  };
  const redact = redactor(variables);
  const state = { instruction };
  const response = await decide(config, redact ? redactDeep(state, redact) : state, questions);
  const operation = choiceAnswer(response, "operation");
  const kind = choiceAnswer(response, "kind");
  const cardinality = choiceAnswer(response, "cardinality");
  const targetType = choiceAnswer(response, "target_type");
  if (
    operation.choice === "unsupported" ||
    operation.confidence < CONFIDENCE ||
    kind.choice !== "supported" ||
    kind.confidence < CONFIDENCE
  )
    return { kind: "fallback", reason: "unsupported_observation" };
  if (operation.choice === "fill" && fillValueCandidates(instruction, variables).length !== 1)
    return { kind: "fallback", reason: "unbounded_arguments" };
  if (cardinality.confidence < CONFIDENCE)
    return { kind: "fallback", reason: "uncertain_cardinality" };
  return {
    kind: "intent",
    operation: operation.choice,
    cardinality: cardinality.choice,
    targetType: targetType.confidence >= CONFIDENCE ? targetType.choice : "any",
  };
}

export async function selectObservation(
  config: DecisionModelConfig,
  snapshot: ObservationSnapshot,
  instruction: string | undefined,
  variables?: Variables,
  classified?: ObservationIntent,
): Promise<ObservationOutcome> {
  const view = observationView(snapshot);
  const { candidates, unresolved } = view;
  const fallback = (reason: string): ObservationOutcome => ({ kind: "fallback", reason });
  if (instruction !== undefined && !instruction.trim()) return fallback("empty_instruction");
  if (unresolved.length) return fallback(`unrepresented_candidates:${unresolved.length}`);
  const toAction = (candidate: ObservationCandidate, operation: string): Action => {
    const method =
      operation === "default"
        ? candidate.fact.tag === "select"
          ? "selectOptionFromDropdown"
          : candidate.fact.editable
            ? "fill"
            : "click"
        : operation;
    const values =
      method === "fill" && instruction ? fillValueCandidates(instruction, variables) : [];
    return {
      selector: candidate.selector,
      description: candidate.node.name
        ? `${candidate.node.role}: ${candidate.node.name}`
        : candidate.node.role,
      method,
      arguments: values.length === 1 ? values : [],
    };
  };
  if (!instruction) {
    if (candidates.length > MAX_DISCOVERY_CANDIDATES) return fallback("discovery_budget");
    return {
      kind: "done",
      actions: candidates.filter(isInteractive).map((c) => toAction(c, "default")),
    };
  }
  const section = parseObservationSection(instruction);
  if (section) {
    const links = resolveObservationSection(snapshot, section, view);
    if (!links) return fallback("unproven_section_scope");
    if (links.length > MAX_SELECTION_CANDIDATES)
      return fallback(`candidate_budget:${links.length}`);
    return { kind: "done", actions: links.map((link) => toAction(link, "click")) };
  }
  if (!candidates.length) return fallback("candidate_budget:0");
  const intent = classified ?? (await classifyObservation(config, instruction, variables));
  if (intent.kind === "fallback") return intent;
  const narrowed = candidates.filter((candidate) =>
    matchesObservationType(candidate, intent.targetType),
  );
  const eligible = narrowed.length ? narrowed : candidates;
  if (eligible.length > MAX_SELECTION_CANDIDATES)
    return fallback(`candidate_budget:${eligible.length}`);
  const quoted = quotedStrings(instruction);
  const normalize = (text: string) =>
    text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  const exact =
    intent.cardinality === "one" &&
    intent.operation !== "fill" &&
    quoted.length === 1 &&
    Boolean(quoted[0]!.trim())
      ? eligible.filter((candidate) =>
          [candidate.node.name, candidate.fact.title ?? ""].some(
            (name) => normalize(name) === normalize(quoted[0]!),
          ),
        )
      : [];
  // A literal label can restrict positive selection, but cannot prove the target is absent.
  const selection = exact.length ? exact : eligible;
  const batches = Array.from(
    { length: Math.ceil(selection.length / SELECTION_BATCH_SIZE) },
    (_, index) => selection.slice(index * SELECTION_BATCH_SIZE, (index + 1) * SELECTION_BATCH_SIZE),
  );
  // Each membership question needs its own evidence, not every competing candidate in shared state.
  const redact = redactor(variables);
  const context = {
    instruction,
    membership_rules:
      "For each match_ question, satisfy every requested kind, name, section and scope. A similar control or a wrapper around the target does not count. Match the requested semantic and visual element kind, not merely a shared accessible name. A requested link must itself have role link or tag a. Headings containing links are not links. When text links are requested, require visible link_text; an image-only link is not a text link.",
  };
  const state = redact ? redactDeep(context, redact) : context;
  const ask = async (input: Record<string, DecisionQuestion>) => {
    const safe = redact ? redactDeep(input, redact) : input;
    // Hosted Clef Flash truncates beyond 24k tokens. Reserve room for its prompt.
    if (
      config.provider === "cloudflare" &&
      config.model?.endsWith("clef-flash") &&
      new TextEncoder().encode(JSON.stringify({ state, questions: safe })).byteLength >
        CLEF_FLASH_INPUT_BYTES
    )
      return undefined;
    return decide(config, state, safe);
  };
  const targetQuestion = (batch: ObservationCandidate[]): DecisionQuestion => ({
    type: "choice",
    instructions:
      "Which single element best matches the entire request? Return none_match when no listed element satisfies the target and context. When links share a destination, prefer a visible text link unless the request asks for an image.",
    criteria: {
      ...Object.fromEntries(batch.map((c) => [c.node.id, c.evidence])),
      none_match: "No listed element satisfies the request",
    },
  });
  const existsQuestion = (batch: ObservationCandidate[]): DecisionQuestion => ({
    type: "noul",
    instructions: {
      question:
        "Does at least one listed candidate satisfy every constraint of the user's requested target? A related or similar element is not enough.",
      candidates: Object.fromEntries(batch.map((c) => [c.node.id, c.evidence])),
    },
  });
  const results = await settleAll(
    batches.map(async (batch) => {
      const questions: Record<string, DecisionQuestion> = { exists: existsQuestion(batch) };
      if (intent.cardinality === "one") questions.target = targetQuestion(batch);
      else
        for (const candidate of batch)
          questions[`match_${candidate.node.id}`] = {
            type: "noul",
            instructions: {
              question:
                "Does this candidate belong in the user's requested result set under membership_rules?",
              candidate: candidate.evidence,
            },
          };
      return ask(questions);
    }),
  );
  if (results.some((response) => !response)) return fallback("provider_context_budget");
  const selected: ObservationCandidate[] = [];
  for (const [index, batch] of batches.entries()) {
    const response = results[index]!;
    const exists = noulAnswer(response, "exists").noul;
    if (intent.cardinality === "one") {
      const answer = choiceAnswer(response, "target");
      if (answer.choice === "none_match" && answer.confidence >= CONFIDENCE && exists <= REJECT)
        continue;
      if (answer.choice === "none_match" || answer.confidence < CONFIDENCE || exists < CONFIDENCE)
        return fallback("target_uncertain");
      const candidate = batch.find((c) => c.node.id === answer.choice);
      if (!candidate) return fallback("unknown_target");
      selected.push(candidate);
    } else {
      const scored = batch.map((candidate) => ({
        candidate,
        p: noulAnswer(response, `match_${candidate.node.id}`).noul,
      }));
      const uncertain = scored.filter((x) => x.p > REJECT && x.p < ACCEPT);
      if (uncertain.length) {
        const verification = await ask(
          Object.fromEntries(
            uncertain.map(({ candidate }) => [
              `verify_${candidate.node.id}`,
              {
                type: "choice" as const,
                instructions: {
                  question:
                    "Does the candidate itself satisfy every constraint of the requested result set? Check its own element kind, name, section and scope. Shared words or a related navigation link do not suffice.",
                  candidate: candidate.evidence,
                },
                criteria: {
                  match: "The candidate itself satisfies every requested constraint",
                  none_match: "The candidate fails at least one requested constraint",
                },
              },
            ]),
          ),
        );
        if (!verification) return fallback("provider_context_budget");
        for (const member of uncertain) {
          const answer = choiceAnswer(verification, `verify_${member.candidate.node.id}`);
          if (answer.confidence < VERIFICATION_CONFIDENCE) return fallback("uncertain_set_member");
          member.p = answer.choice === "match" ? ACCEPT : REJECT;
        }
      }
      const matches = scored.filter((x) => x.p >= ACCEPT);
      if (matches.length ? exists < CONFIDENCE : exists > REJECT)
        return fallback("set_existence_disagrees");
      selected.push(...matches.map((x) => x.candidate));
    }
  }
  if (intent.cardinality === "one" && selected.length > 1) {
    // Compare all shard winners without dropping an unexamined part of the page.
    const final = await ask({ target: targetQuestion(selected) });
    if (!final) return fallback("provider_context_budget");
    const answer = choiceAnswer(final, "target");
    if (answer.choice === "none_match" || answer.confidence < CONFIDENCE)
      return fallback("target_uncertain");
    const winner = selected.find((c) => c.node.id === answer.choice);
    if (!winner) return fallback("unknown_target");
    return { kind: "done", actions: [toAction(winner, intent.operation)] };
  }
  if (exact.length && !selected.length) return fallback("quoted_target_uncertain");
  // A role-specific view can find a target, but absence must also check the broader view.
  if (!selected.length && eligible.length < candidates.length)
    return selectObservation(config, snapshot, instruction, variables, {
      ...intent,
      targetType: "any",
    });
  return { kind: "done", actions: selected.map((c) => toAction(c, intent.operation)) };
}
