import type { Variables } from "@browserbasehq/stagehand-protocol/types";
import { resolveVariableValue } from "../../handlers/handlerUtils/variables.js";

const VARIABLE = /^%[^%\s]+%$/;

export function isVariable(value: string): boolean {
  return VARIABLE.test(value);
}

export function isLoneVariable(values: string[]): boolean {
  return values.length === 1 && isVariable(values[0]!);
}

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
  const fraction = /(?<![\d.\w])(0?\.\d+|1\.0+)(?![\d.%\w])/.exec(instruction);
  if (fraction && /\b(scroll|down|up|to)\b/i.test(instruction)) {
    return `${Math.round(parseFloat(fraction[1]!) * 100)}%`;
  }
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

export function matchOption(
  options: string[],
  instruction: string,
  controlName: string,
): string | undefined {
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

export function isGroundedText(text: string, instruction: string, variables?: Variables): boolean {
  return groundedSpan(text, instruction, variables) !== undefined;
}

export function groundedSpan(
  text: string,
  instruction: string,
  variables?: Variables,
): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (isVariable(trimmed))
    return variables && Object.hasOwn(variables, trimmed.slice(1, -1)) ? trimmed : undefined;
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
