import type { Variables } from "@browserbasehq/stagehand-protocol/types";
import { resolveVariableValue } from "../../handlers/handlerUtils/variables.js";

/**
 * Deterministic argument parsing for the Jev act pipeline. Jev cannot generate
 * text, so every argument is either parsed from the instruction here or chosen
 * by Jev from a closed set these helpers produce.
 */

const VARIABLE = /^%[^%\s]+%$/;

export function isVariable(value: string): boolean {
  return VARIABLE.test(value);
}

export function isLoneVariable(values: string[]): boolean {
  return values.length === 1 && isVariable(values[0]!);
}

/** Quoted strings and declared %variables%: the closed set a fill value can come from. */
export function fillValueCandidates(instruction: string, variables?: Variables): string[] {
  const values = new Set<string>();
  for (const match of instruction.matchAll(/%([^%\s]+)%/g)) {
    if (variables && match[1]! in variables) values.add(match[0]);
  }
  for (const quoted of quotedStrings(instruction)) values.add(quoted);
  return [...values];
}

export function quotedStrings(instruction: string): string[] {
  const values: string[] = [];
  // Single quotes must sit at word boundaries so "user's" is not an opening quote.
  for (const match of instruction.matchAll(
    /(?<![\w])'([^'\n]+)'(?![\w])|"([^"\n]+)"|“([^”\n]+)”|‘([^’\n]+)’/g,
  )) {
    values.push((match[1] ?? match[2] ?? match[3] ?? match[4])!);
  }
  return values;
}

export function parsePercent(instruction: string): string | undefined {
  const explicit = /(\d+(?:\.\d+)?)\s*%/.exec(instruction);
  if (explicit) return `${explicit[1]}%`;
  if (/\bhalf ?way\b|\bmiddle\b/i.test(instruction)) return "50%";
  if (/\bbottom\b/i.test(instruction)) return "100%";
  if (/\btop\b/i.test(instruction)) return "0%";
  return undefined;
}

const SPECIAL_KEYS: Record<string, string> = {
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  space: "Space",
  backspace: "Backspace",
  delete: "Delete",
};

export function parseKey(instruction: string): string | undefined {
  const match = /\bpress(?:\s+the)?\s+["']?([a-z0-9]+)["']?/i.exec(instruction);
  if (!match) return undefined;
  const key = match[1]!;
  return SPECIAL_KEYS[key.toLowerCase()] ?? (key.length === 1 ? key : undefined);
}

/**
 * Deterministic only when exactly one real option appears in the instruction.
 * A quoted string may name the dropdown, and placeholders often repeat that
 * name, so options equal to the control's own name never count.
 */
export function matchOption(
  options: string[],
  instruction: string,
  controlName: string,
): string | undefined {
  // Quoted only. Short options ("In", "All", "On") occur in instructions as
  // ordinary words; an unquoted mention goes to Jev instead.
  const quoted = quotedStrings(instruction).map((value) => value.trim().toLowerCase());
  const mentioned = options.filter(
    (option) =>
      option.toLowerCase() !== controlName.toLowerCase() &&
      quoted.includes(option.trim().toLowerCase()),
  );
  return mentioned.length === 1 ? mentioned[0] : undefined;
}

export function substituteVariables(value: string, variables?: Variables): string {
  if (!variables) return value;
  let output = value;
  for (const [key, variable] of Object.entries(variables)) {
    output = output.split(`%${key}%`).join(resolveVariableValue(variable));
  }
  return output;
}

/**
 * Guards text returned by the argument-only LLM call: it must be lifted from
 * the instruction (or be a declared variable), never invented.
 */
export function isGroundedText(text: string, instruction: string, variables?: Variables): boolean {
  return groundedSpan(text, instruction, variables) !== undefined;
}

/**
 * The instruction's OWN characters for the text the argument LLM returned.
 * The model may re-case or re-space what it copies ("abc123" for "AbC123");
 * what gets typed must be the user's literal input, so the match is located
 * loosely but the span is copied verbatim from the instruction.
 */
export function groundedSpan(
  text: string,
  instruction: string,
  variables?: Variables,
): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (isVariable(trimmed))
    return variables && trimmed.slice(1, -1) in variables ? trimmed : undefined;
  const exact = instruction.indexOf(trimmed);
  if (exact >= 0) return trimmed;
  const loose = new RegExp(
    trimmed
      .split(/\s+/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+"),
    "i",
  ).exec(instruction);
  return loose ? loose[0] : undefined;
}

/**
 * Replaces resolved %variable% values with their placeholder in anything that
 * leaves the process. After an earlier act typed a secret, later snapshots
 * contain it (as the field's text), and candidate descriptions would carry it.
 */
export function redactor(variables: Variables | undefined): ((text: string) => string) | undefined {
  const secrets = Object.entries(variables ?? {})
    .map(([name, value]) => [name, resolveVariableValue(value)] as const)
    .filter(([, value]) => value.length >= 3)
    .sort((a, b) => b[1].length - a[1].length);
  if (secrets.length === 0) return undefined;
  return (text) => {
    let output = text;
    for (const [name, value] of secrets) {
      for (const form of new Set([value, JSON.stringify(value).slice(1, -1)])) {
        output = output.split(form).join(`%${name}%`);
      }
    }
    return output;
  };
}
