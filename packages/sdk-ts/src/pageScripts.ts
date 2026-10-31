import { z } from "zod/v4";

export type InitScriptSource<Arg> =
  | string
  | { path?: string; content?: string }
  | ((arg: Arg) => unknown);

export function normalizeEvaluationExpression<R, Arg>(
  expression: string | ((arg: Arg) => R | Promise<R>),
  arg?: Arg,
  caller = "page.evaluate",
): string {
  if (typeof expression === "string") return expression;

  return `(${expression.toString()})(${parsedArgument(arg, caller)})`;
}

export function normalizeFunctionWaitExpression<R, Arg>(
  expression: string | ((arg: Arg) => R | Promise<R>),
  arg?: Arg,
  caller = "page.waitForFunction",
): string {
  // The browser invokes an expression that evaluates to a function exactly once per poll, so
  // callbacks and bound function strings become thunks and their own results are never invoked.
  if (typeof expression === "function") {
    return `() => (${expression.toString()})(${parsedArgument(arg, caller)})`;
  }
  if (arg === undefined) return expression;

  // Like Playwright, a string that evaluates to a function receives arg; other expressions ignore it.
  return `((value) => typeof value === "function" ? () => value(${parsedArgument(arg, caller)}) : value)((${expression}))`;
}

// JSON.parse keeps own "__proto__" keys that an object literal would treat as a prototype.
function parsedArgument(arg: unknown, caller: string): string {
  if (arg === undefined) return "undefined";
  return `JSON.parse(${JSON.stringify(serializeArgument(arg, caller))})`;
}

export async function normalizeInitScriptSource<Arg>(
  script: InitScriptSource<Arg>,
  arg?: Arg,
  caller = "page.addInitScript",
): Promise<string> {
  if (typeof script === "function") {
    return `(${script.toString()})(${parsedArgument(arg, caller)})`;
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
  const moduleName = "node:" + "fs/promises";
  const { readFile } = (await import(
    /* @vite-ignore */ moduleName
  )) as typeof import("node:fs/promises");
  const source = await readFile(filePath, "utf8");
  return `${source}\n//# sourceURL=${filePath.replace(/\n/g, "")}`;
}

function serializeArgument(arg: unknown, caller: string): string {
  if (arg === undefined) return "undefined";

  const parsed = z.json().safeParse(arg);
  if (!parsed.success) {
    throw new TypeError(`${caller}: 'arg' must be JSON-serializable.`);
  }

  // Serialize the validated input itself: zod's parsed copy drops own "__proto__" keys.
  const serialized = JSON.stringify(arg);
  if (serialized === undefined) {
    throw new TypeError(`${caller}: 'arg' must be JSON-serializable.`);
  }
  return serialized;
}
