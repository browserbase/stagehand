import type { WebMCPToolDescriptor } from "@browserbasehq/stagehand-protocol/types";
import { ask, round, type AskContext, type TraceEntry } from "./pick.js";
import {
  choiceAnswer,
  noulAnswer,
  type JevQuestion,
  type JevResponse,
  type JsonValue,
} from "./typesafeClient.js";

/**
 * WebMCP tool selection on Jev. A page that registers tools has already said
 * what it can do, so "which tool fulfils this request" is a closed-set choice,
 * and most arguments are words of the instruction (a span Jev can point at) or
 * an enum/boolean. Anything else is left to the caller: an argument-only LLM
 * call for the chosen tool, or the ordinary element path.
 */

const NONE = "none_of_these";
const UNSET = "unset";
/** Set on 380 labelled requests over 166 live tools: 79% answered at 99% precision. */
const TOOL_MIN = 0.8;
const TOOL_NONE_MAX = 0.2;
/** Every parameter, including the ones judged "not stated": 69% filled at 98% precision. */
const ARGUMENT_MIN = 0.8;
/** One option is reserved for "unset". */
const MAX_SPANS = 250;
const MAX_TOOLS = 254;
const DESCRIPTION_CHARS = 600;
/**
 * Argument questions for the tools most likely to win ride in the same request
 * as the choice, so a confident tool call is one round trip, not two.
 */
const SPECULATIVE_TOOLS = 2;
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "to",
  "of",
  "in",
  "on",
  "for",
  "and",
  "my",
  "me",
  "it",
]);

type ToolInput = Record<string, JsonValue>;

export type ToolOutcome =
  /** `input` is absent when Jev chose the tool but could not fill its arguments with confidence. */
  | { kind: "tool"; tool: WebMCPToolDescriptor; input?: ToolInput }
  /** The request is not a tool call (or Jev is unsure): carry on with the element path. */
  | { kind: "skip"; reason: string };

type Property = { type?: JsonValue; enum?: JsonValue[]; description?: JsonValue };

function propertiesOf(tool: WebMCPToolDescriptor): Record<string, Property> {
  const properties = tool.inputSchema?.properties;
  return properties && typeof properties === "object" && !Array.isArray(properties)
    ? (properties as Record<string, Property>)
    : {};
}

function requiredOf(tool: WebMCPToolDescriptor): string[] {
  const required = tool.inputSchema?.required;
  return Array.isArray(required)
    ? required.filter((name): name is string => typeof name === "string")
    : [];
}

export type ToolQuestions = {
  offered: WebMCPToolDescriptor[];
  questions: Record<string, JevQuestion>;
  /** Tools whose argument questions are already in `questions`. */
  withArguments: WebMCPToolDescriptor[];
  /** Best lexical match when it needs an argument LLM whatever Jev says about spans. */
  needsArgumentLlm?: WebMCPToolDescriptor;
  spanIds: Map<string, string>;
};

/**
 * Questions to merge into a request that only needs the instruction (act's
 * intent fan-out). Undefined when there is nothing to ask.
 */
export function toolQuestions(
  instruction: string,
  tools: WebMCPToolDescriptor[],
): ToolQuestions | undefined {
  // Two frames may register the same name; the choice is keyed by name, so
  // only unambiguous names are offered.
  const counts = new Map<string, number>();
  for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  const offered = tools.filter((tool) => counts.get(tool.name) === 1 && tool.name !== NONE);
  if (offered.length === 0 || offered.length > MAX_TOOLS) return undefined;

  const criteria = Object.fromEntries(
    offered.map((tool) => {
      const takes = Object.keys(propertiesOf(tool));
      return [
        tool.name,
        {
          does: tool.description.slice(0, DESCRIPTION_CHARS),
          ...(takes.length > 0 ? { takes } : {}),
        },
      ];
    }),
  );
  const instructions = { task: "Which tool fulfils the user's request?", request: instruction };
  const questions: Record<string, JevQuestion> = {
    tool_best: { type: "choice", instructions, criteria },
    tool_strict: {
      type: "choice",
      instructions,
      criteria: {
        ...criteria,
        [NONE]:
          "No listed tool can do what the request asks; a different capability would be needed",
      },
    },
    // "click the Add to cart button" names a control. The user asked for a
    // click, so they get a click, even though add_to_cart would match.
    tool_names_control: {
      type: "noul",
      instructions: {
        question:
          "Does the request tell the agent to operate a specific on-page control (click, type into, select from, press, scroll, hover a named button, link, field, icon or menu) rather than state a goal?",
        request: instruction,
      },
    },
  };

  const spanIds = new Map(instructionSpans(instruction).map((span, index) => [`s${index}`, span]));
  const ranked = rankByWords(instruction, offered);
  const withArguments: WebMCPToolDescriptor[] = [];
  for (const { tool } of ranked.slice(0, SPECULATIVE_TOOLS)) {
    const own = argumentQuestions(tool, instruction, spanIds);
    if (!own || Object.keys(own).length === 0) continue;
    for (const [name, question] of Object.entries(own)) {
      questions[argumentKey(tool, name)] = question;
    }
    withArguments.push(tool);
  }
  // A clear lexical leader with a list, object or otherwise non-scalar
  // parameter will need the argument LLM if it wins; the caller may start it now.
  const [leader, runnerUp] = ranked;
  const needsArgumentLlm =
    leader &&
    leader.score > (runnerUp?.score ?? 0) &&
    Object.keys(propertiesOf(leader.tool)).length > 0 &&
    !argumentQuestions(leader.tool, "", spanIds)
      ? leader.tool
      : undefined;
  return {
    offered,
    questions,
    withArguments,
    spanIds,
    ...(needsArgumentLlm ? { needsArgumentLlm } : {}),
  };
}

/** Reads the tool decision out of the response the questions rode in. */
export async function readToolDecision(
  ctx: AskContext,
  response: JevResponse,
  asked: ToolQuestions,
  entry: TraceEntry,
): Promise<ToolOutcome> {
  const best = choiceAnswer(response, "tool_best");
  const none = choiceAnswer(response, "tool_strict").probabilities[NONE] ?? 0;
  const namesControl = noulAnswer(response, "tool_names_control").noul;
  Object.assign(entry, {
    tool: best.choice,
    tool_best: round(best.confidence),
    tool_none: round(none),
    names_control: round(namesControl),
    tools: asked.offered.length,
  });

  if (namesControl >= 0.5) return { kind: "skip", reason: "names_a_control" };
  if (none > TOOL_NONE_MAX) return { kind: "skip", reason: "no_tool_fits" };
  if (best.confidence < TOOL_MIN) return { kind: "skip", reason: "tool_ambiguous" };
  const tool = asked.offered.find((candidate) => candidate.name === best.choice);
  if (!tool) return { kind: "skip", reason: "tool_ambiguous" };

  const names = Object.keys(propertiesOf(tool));
  let input: ToolInput | undefined;
  if (names.length === 0) {
    input = {};
  } else if (asked.withArguments.includes(tool)) {
    input = readArguments(response, tool, asked.spanIds, (name) => argumentKey(tool, name), entry);
  } else {
    // The winner was not among the lexical favourites: one more request.
    const questions = argumentQuestions(tool, ctx.instruction, asked.spanIds);
    if (questions) {
      const second = await ask(ctx, "tool_arguments", { request: ctx.instruction }, questions);
      input = readArguments(
        second,
        tool,
        asked.spanIds,
        (name) => name,
        ctx.trace[ctx.trace.length - 1]!,
      );
    }
  }
  return { kind: "tool", tool, ...(input ? { input } : {}) };
}

function argumentKey(tool: WebMCPToolDescriptor, name: string): string {
  return `tool_arg:${tool.name}:${name}`;
}

function words(text: string): string[] {
  const found: string[] = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return found.filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

/** Cheap guess at the likely winners; only decides whose argument questions ride along. */
function rankByWords(
  instruction: string,
  tools: WebMCPToolDescriptor[],
): Array<{ tool: WebMCPToolDescriptor; score: number }> {
  const wanted = new Set(words(instruction));
  const score = (tool: WebMCPToolDescriptor): number =>
    3 *
      new Set(words(tool.name.replace(/([a-z])([A-Z])/g, "$1 $2")).filter((w) => wanted.has(w)))
        .size +
    new Set(words(tool.description).filter((w) => wanted.has(w))).size;
  return tools
    .map((tool) => ({ tool, score: score(tool) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** Quoted strings first, then every run of one to four words, punctuation and possessives stripped. */
export function instructionSpans(instruction: string): string[] {
  const spans: string[] = [];
  const add = (span: string): void => {
    if (span && !spans.includes(span)) spans.push(span);
  };
  for (const match of instruction.matchAll(/"([^"\n]+)"|“([^”\n]+)”|(?<!\w)'([^'\n]+)'(?!\w)/g)) {
    add((match[1] ?? match[2] ?? match[3])!);
  }
  const words = (instruction.match(/\S+/g) ?? []).map((word) =>
    word.replace(/^[("'“‘]+|[)"'”’.,;:!?]+$/g, "").replace(/['’]s$/, ""),
  );
  for (let size = 1; size <= 4; size++) {
    for (let start = 0; start + size <= words.length; start++) {
      add(
        words
          .slice(start, start + size)
          .join(" ")
          .trim(),
      );
    }
  }
  return spans.slice(0, MAX_SPANS);
}

/**
 * Undefined when a parameter is not a scalar. Values the instruction only
 * implies ("July 15th" for an ISO date, lists, nested objects) are not spans,
 * and guessing them is how a tool gets called with the wrong input.
 */
function argumentQuestions(
  tool: WebMCPToolDescriptor,
  instruction: string,
  spanIds: Map<string, string>,
): Record<string, JevQuestion> | undefined {
  const properties = propertiesOf(tool);
  const unset = "The request does not state a value for this parameter";
  const questions: Record<string, JevQuestion> = {};
  for (const [name, property] of Object.entries(properties)) {
    const instructions = {
      task: `What value does the request give for the parameter '${name}' of the tool '${tool.name}'?`,
      parameter: {
        name,
        ...(property.description === undefined ? {} : { description: property.description }),
        ...(property.type === undefined ? {} : { type: property.type }),
      },
      request: instruction,
    };
    if (Array.isArray(property.enum) && property.enum.length > 0) {
      questions[name] = {
        type: "choice",
        instructions,
        criteria: {
          ...Object.fromEntries(
            property.enum.map((value, index) => [
              `e${index}`,
              `the request means ${JSON.stringify(value)}`,
            ]),
          ),
          [UNSET]: unset,
        },
      };
    } else if (property.type === "boolean") {
      questions[name] = {
        type: "choice",
        instructions,
        criteria: {
          true: "the request wants this on / yes",
          false: "the request wants this off / no",
          [UNSET]: unset,
        },
      };
    } else if (
      property.type === "string" ||
      property.type === "number" ||
      property.type === "integer"
    ) {
      questions[name] = {
        type: "choice",
        instructions,
        criteria: {
          ...Object.fromEntries([...spanIds].map(([id, span]) => [id, `the exact words: ${span}`])),
          [UNSET]: unset,
        },
      };
    } else {
      return undefined;
    }
  }
  return questions;
}

/** Undefined unless Jev is sure about every parameter, stated or not, and none required is missing. */
function readArguments(
  response: JevResponse,
  tool: WebMCPToolDescriptor,
  spanIds: Map<string, string>,
  keyOf: (name: string) => string,
  entry: TraceEntry,
): ToolInput | undefined {
  const properties = propertiesOf(tool);
  const input: ToolInput = {};
  let weakest = 1;
  for (const [name, property] of Object.entries(properties)) {
    const answer = choiceAnswer(response, keyOf(name));
    weakest = Math.min(weakest, answer.confidence);
    if (answer.choice === UNSET) continue;
    if (Array.isArray(property.enum) && property.enum.length > 0) {
      input[name] = property.enum[Number(answer.choice.slice(1))]!;
    } else if (property.type === "boolean") {
      input[name] = answer.choice === "true";
    } else {
      const span = spanIds.get(answer.choice);
      if (span === undefined) return undefined;
      if (property.type === "string") {
        input[name] = span;
      } else {
        const number = /-?\d+(?:\.\d+)?/.exec(span.replaceAll(",", ""));
        if (!number || (property.type === "integer" && number[0].includes("."))) return undefined;
        input[name] = Number(number[0]);
      }
    }
  }
  Object.assign(entry, { arguments_weakest: round(weakest), arguments_filled: Object.keys(input) });
  if (weakest < ARGUMENT_MIN) return undefined;
  // "search the store for mugs" put "mugs" into both query and category, each
  // with high confidence. One span is one value; which parameter is a judgement call.
  const spans = Object.entries(input)
    .filter(([name]) => !properties[name]?.enum && properties[name]?.type !== "boolean")
    .map(([, value]) => (typeof value === "string" ? value : JSON.stringify(value)));
  if (new Set(spans).size < spans.length) return undefined;
  if (requiredOf(tool).some((name) => !(name in input))) return undefined;
  return input;
}
