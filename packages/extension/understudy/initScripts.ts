import type { InitScriptSource } from "../types/private/index.js";

const DEFAULT_CALLER = "context.addInitScript";

function normalizeFunctionExpression(rawSource: string): string {
  const source = rawSource.trim();
  if (
    /^(?:async\s+)?function(?:\s|\*|\()/.test(source) ||
    /^(?:async\s+)?\(/.test(source) ||
    /^(?:async\s+)?[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*\s*=>/u.test(source)
  ) {
    return rawSource;
  }

  let rest = source;
  let isAsync = false;
  let isGenerator = false;

  const asyncMatch = /^async\s+/.exec(rest);
  if (asyncMatch) {
    isAsync = true;
    rest = rest.slice(asyncMatch[0].length).trimStart();
  }
  if (rest.startsWith("*")) {
    isGenerator = true;
    rest = rest.slice(1).trimStart();
  }

  const paramsStart = findMethodParamsStart(rest);
  if (paramsStart === -1) return rawSource;

  const prefix = `${isAsync ? "async " : ""}function${isGenerator ? "*" : ""}`;
  return `${prefix}${rest.slice(paramsStart)}`;
}

function findMethodParamsStart(source: string): number {
  if (source.startsWith('"') || source.startsWith("'")) {
    const quote = source[0];
    let i = 1;
    while (i < source.length) {
      if (source[i] === "\\") {
        i += 2;
        continue;
      }
      if (source[i] === quote) {
        return source.indexOf("(", i + 1);
      }
      i += 1;
    }
    return -1;
  }
  if (source.startsWith("[")) {
    let depth = 0;
    let inString: string | null = null;
    for (let i = 0; i < source.length; i += 1) {
      const ch = source[i];
      if (inString) {
        if (ch === "\\") {
          i += 1;
        } else if (ch === inString) {
          inString = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
      } else if (ch === "[") {
        depth += 1;
      } else if (ch === "]") {
        depth -= 1;
        if (depth === 0) return source.indexOf("(", i + 1);
      }
    }
    return -1;
  }
  return source.indexOf("(");
}

export async function normalizeInitScriptSource<Arg>(
  script: InitScriptSource<Arg>,
  arg?: Arg,
  caller: string = DEFAULT_CALLER,
): Promise<string> {
  if (typeof script === "function") {
    const argString = Object.is(arg, undefined) ? "undefined" : JSON.stringify(arg);
    return `(${normalizeFunctionExpression(script.toString())})(${argString})`;
  }

  if (!Object.is(arg, undefined)) {
    throw new TypeError(`${caller}: 'arg' is only supported when passing a function.`);
  }

  if (typeof script === "string") {
    return script;
  }

  if (!script || typeof script !== "object") {
    throw new TypeError(`${caller}: provide a string, function, or an object with content.`);
  }

  if (typeof script.content === "string") {
    return script.content;
  }

  throw new TypeError(`${caller}: provide a string, function, or an object with content.`);
}
