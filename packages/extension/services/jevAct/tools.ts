import type { WebMCPToolDescriptor } from "@browserbasehq/stagehand-protocol/types";
import { annotate, ask, round, type AskContext } from "./pick.js";
import { choiceAnswer, noulAnswer, type JevQuestion, type JsonValue } from "./typesafeClient.js";

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

export async function selectTool(
  ctx: AskContext,
  tools: WebMCPToolDescriptor[],
): Promise<ToolOutcome> {
  // Two frames may register the same name; the choice is keyed by name, so
  // only unambiguous names are offered.
  const counts = new Map<string, number>();
  for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  const offered = tools.filter((tool) => counts.get(tool.name) === 1 && tool.name !== NONE);
  if (offered.length === 0) return { kind: "skip", reason: "no_tools" };
  if (offered.length > MAX_TOOLS) return { kind: "skip", reason: "too_many_tools" };

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
  const instructions = {
    task: "Which tool fulfils the user's request?",
    request: ctx.instruction,
  };
  const response = await ask(
    ctx,
    "tool",
    {},
    {
      best: { type: "choice", instructions, criteria },
      strict: {
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
      names_control: {
        type: "noul",
        instructions: {
          question:
            "Does the request tell the agent to operate a specific on-page control (click, type into, select from, press, scroll, hover a named button, link, field, icon or menu) rather than state a goal?",
          request: ctx.instruction,
        },
      },
    },
  );
  const best = choiceAnswer(response, "best");
  const none = choiceAnswer(response, "strict").probabilities[NONE] ?? 0;
  const namesControl = noulAnswer(response, "names_control").noul;
  annotate(ctx.trace, {
    choice: best.choice,
    best: round(best.confidence),
    none: round(none),
    names_control: round(namesControl),
    options: offered.length,
  });

  if (namesControl >= 0.5) return { kind: "skip", reason: "names_a_control" };
  if (none > TOOL_NONE_MAX) return { kind: "skip", reason: "no_tool_fits" };
  if (best.confidence < TOOL_MIN) return { kind: "skip", reason: "tool_ambiguous" };
  const tool = offered.find((candidate) => candidate.name === best.choice);
  if (!tool) return { kind: "skip", reason: "tool_ambiguous" };

  const input = await fillArguments(ctx, tool);
  return { kind: "tool", tool, ...(input ? { input } : {}) };
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
 * Undefined unless every parameter is a scalar Jev is sure about, stated or
 * not. Values the instruction only implies ("July 15th" for an ISO date, lists,
 * nested objects) are not spans, and guessing them is how a tool gets called
 * with the wrong input.
 */
async function fillArguments(
  ctx: AskContext,
  tool: WebMCPToolDescriptor,
): Promise<ToolInput | undefined> {
  const properties = propertiesOf(tool);
  const names = Object.keys(properties);
  if (names.length === 0) return {};

  const spans = instructionSpans(ctx.instruction);
  const spanIds = new Map(spans.map((span, index) => [`s${index}`, span]));
  const unset = "The request does not state a value for this parameter";
  const questions: Record<string, JevQuestion> = {};
  for (const name of names) {
    const property = properties[name]!;
    const instructions = {
      task: `What value does the request give for the parameter '${name}' of the tool '${tool.name}'?`,
      parameter: {
        name,
        ...(property.description === undefined ? {} : { description: property.description }),
        ...(property.type === undefined ? {} : { type: property.type }),
      },
      request: ctx.instruction,
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

  const response = await ask(ctx, "tool_arguments", { request: ctx.instruction }, questions);
  const input: ToolInput = {};
  let weakest = 1;
  for (const name of names) {
    const property = properties[name]!;
    const answer = choiceAnswer(response, name);
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
  annotate(ctx.trace, { weakest: round(weakest), filled: Object.keys(input) });
  if (weakest < ARGUMENT_MIN) return undefined;
  if (requiredOf(tool).some((name) => !(name in input))) return undefined;
  return input;
}
