import { readFile } from "node:fs/promises";
import { z } from "zod/v4";

export type InitScriptSource<Arg> =
  | string
  | { path?: string; content?: string }
  | ((arg: Arg) => unknown);

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
    throw new TypeError(
      `${caller}: provide a string, function, or an object with exactly one of path or content.`,
    );
  }

  const hasContent = typeof script.content === "string";
  const hasPath = typeof script.path === "string" && script.path.trim().length > 0;
  if (hasContent === hasPath) {
    throw new TypeError(`${caller}: provide an object with exactly one of path or content.`);
  }

  if (hasContent) return script.content as string;

  const filePath = script.path as string;
  const source = await readFile(filePath, "utf8");
  return `${source}\n//# sourceURL=${filePath.replace(/\n/g, "")}`;
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
