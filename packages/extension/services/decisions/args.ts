import type { Variables } from "@browserbasehq/stagehand-protocol/types";
import { resolveVariableValue } from "../../handlers/handlerUtils/variables.js";

/**
 * Deterministic argument parsing for the Decisions act pipeline. The decision model cannot generate
 * text, so every argument is either parsed from the instruction here or chosen
 * by the decision model from a closed set these helpers produce.
 */

/** Quoted strings and declared %variables%: the closed set a fill value can come from. */
export function fillValueCandidates(instruction: string, variables?: Variables): string[] {
  const values = new Set<string>();
  for (const match of instruction.matchAll(/%([^%\s]+)%/g)) {
    if (variables && Object.hasOwn(variables, match[1]!)) values.add(match[0]);
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

export function substituteVariables(value: string, variables?: Variables): string {
  if (!variables) return value;
  let output = value;
  for (const [key, variable] of Object.entries(variables)) {
    output = output.split(`%${key}%`).join(resolveVariableValue(variable));
  }
  return output;
}

/**
 * Replaces resolved %variable% values with their placeholder in anything that
 * leaves the process. After an earlier act typed a secret, later snapshots
 * contain it (as the field's text), and candidate descriptions would carry it.
 */
export function redactor(variables: Variables | undefined): ((text: string) => string) | undefined {
  // Redacting very short values would erase common page words. The public
  // reference documents this limit; length does not determine sensitivity.
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

/**
 * Redacts every string value inside a JSON-shaped value, leaving structure and
 * keys alone. Redacting the serialised text instead would let a value that ends
 * in a quote, or that equals a key name, corrupt the JSON.
 */
export function redactDeep<T>(value: T, redact: (text: string) => string): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, redact)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        redactDeep(item, redact),
      ]),
    ) as T;
  }
  return value;
}
