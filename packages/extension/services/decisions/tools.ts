import type { WebMCPToolDescriptor } from "@browserbasehq/stagehand-protocol/types";
import { ask, round, type AskContext, type TraceEntry } from "./pick.js";
import {
  choiceAnswer,
  noulAnswer,
  type DecisionQuestion,
  type DecisionResponse,
  type JsonValue,
} from "./client.js";

const NONE = "none_of_these";
const UNSET = "unset";
const TOOL_MIN = 0.8;
const TOOL_NONE_MAX = 0.2;
const ARGUMENT_MIN = 0.8;
const MAX_SPANS = 250;
const MAX_TOOLS = 254;
const DESCRIPTION_CHARS = 600;
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
  | { kind: "tool"; tool: WebMCPToolDescriptor; input?: ToolInput }
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
  questions: Record<string, DecisionQuestion>;
  withArguments: WebMCPToolDescriptor[];
  needsArgumentLlm?: WebMCPToolDescriptor;
  spanIds: Map<string, string>;
};

export function toolQuestions(
  instruction: string,
  tools: WebMCPToolDescriptor[],
): ToolQuestions | undefined {
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
  const questions: Record<string, DecisionQuestion> = {
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

export async function readToolDecision(
  ctx: AskContext,
  response: DecisionResponse,
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
    if (requiredOf(tool).length === 0) input = {};
  } else if (asked.withArguments.includes(tool)) {
    input = readArguments(response, tool, asked.spanIds, (name) => argumentKey(tool, name), entry);
  } else {
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
  return `tool_arg:${tool.name.replace(/[%:]/g, (char) => encodeURIComponent(char))}:${name}`;
}

function words(text: string): string[] {
  const found: string[] = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return found.filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

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

function argumentQuestions(
  tool: WebMCPToolDescriptor,
  instruction: string,
  spanIds: Map<string, string>,
): Record<string, DecisionQuestion> | undefined {
  const properties = propertiesOf(tool);
  const unset = "The request does not state a value for this parameter";
  const questions: Record<string, DecisionQuestion> = {};
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

function readArguments(
  response: DecisionResponse,
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
        const numbers = span.replaceAll(",", "").match(/-?\d+(?:\.\d+)?/g);
        if (numbers?.length !== 1) return undefined;
        const number = numbers[0]!;
        if (property.type === "integer" && number.includes(".")) return undefined;
        input[name] = Number(number);
      }
    }
  }
  Object.assign(entry, { arguments_weakest: round(weakest), arguments_filled: Object.keys(input) });
  if (weakest < ARGUMENT_MIN) return undefined;
  const spans = Object.entries(input)
    .filter(([name]) => !properties[name]?.enum && properties[name]?.type !== "boolean")
    .map(([, value]) => (typeof value === "string" ? value : JSON.stringify(value)));
  if (new Set(spans).size < spans.length) return undefined;
  if (requiredOf(tool).some((name) => !(name in input))) return undefined;
  return input;
}
