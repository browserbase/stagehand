import { z } from "zod/v4";

export type InitScriptSource<Arg> = string | { content: string } | ((arg: Arg) => unknown);

export function normalizeEvaluationExpression<R, Arg>(
  expression: string | ((arg: Arg) => R | Promise<R>),
  arg?: Arg,
): string {
  if (typeof expression === "string") return expression;

  return `(${expression.toString()})(${serializeArgument(arg, "page.evaluate")})`;
}

export async function normalizeInitScriptSource<Arg>(
  script: InitScriptSource<Arg>,
  arg?: Arg,
  caller = "page.addInitScript",
): Promise<string> {
  if (typeof script === "function") {
    return `(${script.toString()})(${serializeArgument(arg, caller)})`;
  }

  if (arg !== undefined) {
    throw new TypeError(`${caller}: 'arg' is only supported when passing a function.`);
  }

  if (typeof script === "string") return script;

  if (!script || typeof script !== "object") {
    throw new TypeError(`${caller}: provide a string, function, or an object with content.`);
  }

  if (typeof script.content !== "string") {
    throw new TypeError(`${caller}: provide an object with content.`);
  }

  return script.content;
}

function serializeArgument(arg: unknown, caller: string): string {
  if (arg === undefined) return "undefined";

  const parsed = z.json().safeParse(arg);
  if (!parsed.success) {
    throw new TypeError(`${caller}: 'arg' must be JSON-serializable.`);
  }

  const serialized = JSON.stringify(parsed.data);
  if (serialized === undefined) {
    throw new TypeError(`${caller}: 'arg' must be JSON-serializable.`);
  }
  return serialized;
}
