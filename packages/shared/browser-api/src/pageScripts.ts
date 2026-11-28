import { browserPlatform, type BrowserApiPlatform } from "./platform.js";
import { z } from "zod/v4";

export type InitScriptSource<Arg> =
  | string
  | { path?: string; content?: string }
  | ((arg: Arg) => unknown);

const NATIVE_FUNCTION_SOURCE_PATTERN =
  /^\s*(?:async\s+)?function(?:\s*\*)?(?:\s+[^()]*)?\([^)]*\)\s*\{\s*\[native code\]\s*\}\s*$/;
const IDENTIFIER_START_PATTERN = /^[$_\p{ID_Start}]/u;
const IDENTIFIER_CONTINUE_PATTERN = /^[$\u200c\u200d\p{ID_Continue}]/u;
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return",
  "throw",
  "case",
  "yield",
  "await",
  "typeof",
  "void",
  "delete",
  "in",
  "instanceof",
  "of",
  "new",
  "else",
  "do",
]);
const STATEMENT_HEADER_KEYWORDS = new Set(["if", "while", "for", "with"]);

export function normalizeEvaluationExpression<R, Arg>(
  expression: string | ((arg: Arg) => R | Promise<R>),
  arg?: Arg,
  caller = "page.evaluate",
): string {
  if (typeof expression === "string") return expression;

  const fnSource = normalizeFunctionSource(expression, caller);
  return `${wrapParenthesized(fnSource)}(${serializeInlineArgument(arg, caller)})`;
}

export function normalizeFunctionWaitExpression<R, Arg>(
  expression: string | ((arg: Arg) => R | Promise<R>),
  arg?: Arg,
  caller = "page.waitForFunction",
): string {
  if (typeof expression === "function") {
    const fnSource = normalizeFunctionSource(expression, caller);
    return `() => ${wrapParenthesized(fnSource)}(${parsedArgument(arg, caller)})`;
  }
  if (arg === undefined) return expression;

  return `((value) => typeof value === "function" ? () => value(${parsedArgument(arg, caller)}) : value)(${wrapParenthesized(expression)})`;
}

function parsedArgument(arg: unknown, caller: string): string {
  if (arg === undefined) return "undefined";
  return `JSON.parse(${JSON.stringify(serializeArgument(arg, caller))})`;
}

function serializeInlineArgument(arg: unknown, caller: string): string {
  if (arg === undefined) return "undefined";
  const serialized = serializeArgument(arg, caller);
  if (hasOwnProtoKey(arg)) {
    return `JSON.parse(${JSON.stringify(serialized)})`;
  }
  return serialized;
}

export async function normalizeInitScriptSource<Arg>(
  script: InitScriptSource<Arg>,
  arg?: Arg,
  caller = "page.addInitScript",
  platform: BrowserApiPlatform = browserPlatform,
): Promise<string> {
  if (typeof script === "function") {
    const fnSource = normalizeFunctionSource(script, caller);
    return `${wrapParenthesized(fnSource)}(${serializeInlineArgument(arg, caller)})`;
  }

  if (arg !== undefined) {
    throw new TypeError(`${caller}: 'arg' is only supported when passing a function.`);
  }

  if (typeof script === "string") return script;

  if (!script || typeof script !== "object" || Array.isArray(script)) {
    throw new TypeError(
      `${caller}: provide a string, function, or an object with exactly one of path or content.`,
    );
  }

  const hasContentProp = script.content !== undefined;
  const hasPathProp = script.path !== undefined;
  if (hasContentProp === hasPathProp) {
    throw new TypeError(`${caller}: provide an object with exactly one of path or content.`);
  }

  if (hasContentProp) {
    if (typeof script.content !== "string") {
      throw new TypeError(`${caller}: provide an object with exactly one of path or content.`);
    }
    return script.content;
  }

  if (typeof script.path !== "string" || script.path.trim().length === 0) {
    throw new TypeError(`${caller}: provide an object with exactly one of path or content.`);
  }

  const filePath = script.path;
  const source = await platform.readTextFile(filePath, caller);
  return `${source}\n//# sourceURL=${filePath.replace(/[\r\n\u2028\u2029]/g, "")}`;
}

function serializeArgument(arg: unknown, caller: string): string {
  if (arg === undefined) return "undefined";

  const parsed = z.json().safeParse(arg);
  if (!parsed.success) {
    throw new TypeError(`${caller}: 'arg' must be JSON-serializable.`);
  }

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(arg);
  } catch {
    throw new TypeError(`${caller}: 'arg' must be JSON-serializable.`);
  }
  if (serialized === undefined) {
    throw new TypeError(`${caller}: 'arg' must be JSON-serializable.`);
  }
  return serialized;
}

function hasOwnProtoKey(value: unknown, seen = new Set<unknown>()): boolean {
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => hasOwnProtoKey(item, seen));
  }

  if (Object.prototype.hasOwnProperty.call(value, "__proto__")) {
    return true;
  }

  for (const key of Object.keys(value)) {
    if (hasOwnProtoKey((value as Record<string, unknown>)[key], seen)) {
      return true;
    }
  }
  return false;
}

function normalizeFunctionSource(fn: (...args: never[]) => unknown, caller: string): string {
  const source = fn.toString();
  if (NATIVE_FUNCTION_SOURCE_PATTERN.test(source)) {
    throw new TypeError(`${caller}: function must be serializable JavaScript.`);
  }

  const start = skipTrivia(source, 0);
  if (start >= source.length) {
    throw new TypeError(`${caller}: function must be serializable JavaScript.`);
  }

  if (source[start] === "(") {
    return source;
  }

  const first = readIdentifier(source, start);
  if (first !== null) {
    if (first.text === "function") {
      return source;
    }

    const afterFirst = skipTrivia(source, first.end);
    if (first.text === "class") {
      if (source[afterFirst] === "(") {
        return `function${source.slice(afterFirst)}`;
      }
      throw new TypeError(`${caller}: function must be serializable JavaScript.`);
    }

    if (source.startsWith("=>", afterFirst)) {
      return source;
    }

    if (first.text === "async") {
      if (source[afterFirst] === "(") {
        const afterParams = skipBalanced(source, afterFirst, "(", ")");
        if (afterParams !== -1 && source.startsWith("=>", skipTrivia(source, afterParams))) {
          return source;
        }
        return `function${source.slice(afterFirst)}`;
      }

      const second = readIdentifier(source, afterFirst);
      if (second !== null) {
        if (second.text === "function") {
          return source;
        }
        if (source.startsWith("=>", skipTrivia(source, second.end))) {
          return source;
        }
      }

      return rewriteConciseMethod(source, afterFirst, true, caller);
    }
  }

  return rewriteConciseMethod(source, start, false, caller);
}

function rewriteConciseMethod(
  source: string,
  pos: number,
  isAsync: boolean,
  caller: string,
): string {
  let cursor = skipTrivia(source, pos);
  let isGenerator = false;

  if (source[cursor] === "*") {
    isGenerator = true;
    cursor = skipTrivia(source, cursor + 1);
  }

  if (!isAsync && !isGenerator) {
    const maybeAccessor = readIdentifier(source, cursor);
    if (maybeAccessor && (maybeAccessor.text === "get" || maybeAccessor.text === "set")) {
      const afterAccessor = skipTrivia(source, maybeAccessor.end);
      if (source[afterAccessor] !== "(") {
        cursor = afterAccessor;
      }
    }
  }

  const afterName = skipPropertyName(source, cursor);
  if (afterName === -1) {
    throw new TypeError(`${caller}: function must be serializable JavaScript.`);
  }

  const openParen = skipTrivia(source, afterName);
  if (source[openParen] !== "(") {
    throw new TypeError(`${caller}: function must be serializable JavaScript.`);
  }

  const prefix = `${isAsync ? "async " : ""}function${isGenerator ? "*" : ""}`;
  return `${prefix}${source.slice(openParen)}`;
}

function skipPropertyName(source: string, pos: number): number {
  const ch = source[pos];
  if (ch === undefined) return -1;
  if (ch === "[") return skipBalanced(source, pos, "[", "]");
  if (ch === '"' || ch === "'") return skipStringLiteral(source, pos);
  if (ch >= "0" && ch <= "9") return skipNumericLiteral(source, pos);
  const ident = readIdentifier(source, pos);
  return ident ? ident.end : -1;
}

function isLineTerminator(ch: string | undefined): boolean {
  return ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029";
}

function skipTrivia(source: string, start: number): number {
  let pos = start;
  while (pos < source.length) {
    const ch = source[pos]!;
    if (/\s/.test(ch)) {
      pos += 1;
      continue;
    }
    if (ch === "/" && source[pos + 1] === "/") {
      pos += 2;
      while (pos < source.length && !isLineTerminator(source[pos])) {
        pos += 1;
      }
      continue;
    }
    if (ch === "/" && source[pos + 1] === "*") {
      pos += 2;
      while (pos < source.length && !(source[pos] === "*" && source[pos + 1] === "/")) {
        pos += 1;
      }
      pos = Math.min(source.length, pos + 2);
      continue;
    }
    break;
  }
  return pos;
}

function readIdentifier(source: string, start: number): { text: string; end: number } | null {
  let pos = start;
  const firstCp = source.codePointAt(pos);
  if (firstCp === undefined) return null;
  const firstChar = String.fromCodePoint(firstCp);
  if (!IDENTIFIER_START_PATTERN.test(firstChar) && firstChar !== "\\") {
    return null;
  }
  pos += firstChar.length;
  while (pos < source.length) {
    const cp = source.codePointAt(pos)!;
    const ch = String.fromCodePoint(cp);
    if (!IDENTIFIER_CONTINUE_PATTERN.test(ch) && ch !== "\\") {
      break;
    }
    pos += ch.length;
  }
  return { text: source.slice(start, pos), end: pos };
}

function skipStringLiteral(source: string, start: number): number {
  const quote = source[start];
  let pos = start + 1;
  while (pos < source.length) {
    const ch = source[pos];
    if (ch === "\\") {
      pos += 2;
      continue;
    }
    if (ch === quote) {
      return pos + 1;
    }
    pos += 1;
  }
  return -1;
}

function skipTemplateLiteral(source: string, start: number): number {
  let pos = start + 1;
  while (pos < source.length) {
    const ch = source[pos];
    if (ch === "\\") {
      pos += 2;
      continue;
    }
    if (ch === "`") {
      return pos + 1;
    }
    if (ch === "$" && source[pos + 1] === "{") {
      const end = skipBalanced(source, pos + 1, "{", "}");
      if (end === -1) return -1;
      pos = end;
      continue;
    }
    pos += 1;
  }
  return -1;
}

function skipNumericLiteral(source: string, start: number): number {
  let pos = start;
  while (pos < source.length && /[0-9a-fA-FxXoObBeE._n]/.test(source[pos]!)) {
    if (
      (source[pos] === "e" || source[pos] === "E") &&
      (source[pos + 1] === "+" || source[pos + 1] === "-")
    ) {
      pos += 2;
      continue;
    }
    pos += 1;
  }
  return pos;
}

function skipRegexLiteral(source: string, start: number): number {
  let pos = start + 1;
  let inClass = false;
  while (pos < source.length) {
    const ch = source[pos]!;
    if (ch === "\\") {
      if (pos + 1 >= source.length || isLineTerminator(source[pos + 1])) {
        return -1;
      }
      pos += 2;
      continue;
    }
    if (ch === "[") {
      inClass = true;
    } else if (ch === "]") {
      inClass = false;
    } else if (ch === "/" && !inClass) {
      pos += 1;
      while (pos < source.length && /[a-z]/i.test(source[pos]!)) {
        pos += 1;
      }
      return pos;
    } else if (isLineTerminator(ch)) {
      return -1;
    }
    pos += 1;
  }
  return -1;
}

function skipBalanced(source: string, start: number, open: string, close: string): number {
  if (source[start] !== open) return -1;
  let depth = 1;
  let pos = start + 1;
  let expectRegex = true;
  let prevWasDot = false;
  let nextParenIsStatementHeader = false;
  const parenStack: boolean[] = [];

  while (pos < source.length && depth > 0) {
    const ch = source[pos]!;
    if (/\s/.test(ch)) {
      pos += 1;
      continue;
    }
    if (ch === "/" && source[pos + 1] === "/") {
      pos += 2;
      while (pos < source.length && !isLineTerminator(source[pos])) pos += 1;
      continue;
    }
    if (ch === "/" && source[pos + 1] === "*") {
      pos += 2;
      while (pos < source.length && !(source[pos] === "*" && source[pos + 1] === "/")) pos += 1;
      pos = Math.min(source.length, pos + 2);
      continue;
    }
    if (ch === "'" || ch === '"') {
      pos = skipStringLiteral(source, pos);
      if (pos === -1) return -1;
      expectRegex = false;
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      continue;
    }
    if (ch === "`") {
      pos = skipTemplateLiteral(source, pos);
      if (pos === -1) return -1;
      expectRegex = false;
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      continue;
    }
    if (ch === "/") {
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      if (expectRegex) {
        pos = skipRegexLiteral(source, pos);
        if (pos === -1) return -1;
        expectRegex = false;
        continue;
      }
      pos += source[pos + 1] === "=" ? 2 : 1;
      expectRegex = true;
      continue;
    }
    if (ch === open) {
      depth += 1;
      if (ch === "(") {
        parenStack.push(nextParenIsStatementHeader);
      }
      expectRegex = true;
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      pos += 1;
      continue;
    }
    if (ch === close) {
      depth -= 1;
      if (ch === ")") {
        expectRegex = parenStack.pop() ?? false;
      } else if (ch === "}") {
        expectRegex = true;
      } else {
        expectRegex = false;
      }
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      pos += 1;
      continue;
    }
    if (ch === "(") {
      parenStack.push(nextParenIsStatementHeader);
      expectRegex = true;
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      pos += 1;
      continue;
    }
    if (ch === ")") {
      expectRegex = parenStack.pop() ?? false;
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      pos += 1;
      continue;
    }
    if (ch === "{" || ch === "}") {
      expectRegex = true;
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      pos += 1;
      continue;
    }
    if (ch === "=" && source[pos + 1] === ">") {
      pos += 2;
      expectRegex = true;
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      continue;
    }
    if ((ch === "+" && source[pos + 1] === "+") || (ch === "-" && source[pos + 1] === "-")) {
      pos += 2;
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      continue;
    }
    if (ch === "." && source[pos + 1] === "." && source[pos + 2] === ".") {
      pos += 3;
      expectRegex = true;
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      continue;
    }
    if (ch === "?" && source[pos + 1] === ".") {
      const afterOpt = source[pos + 2];
      if (afterOpt === undefined || afterOpt < "0" || afterOpt > "9") {
        pos += 2;
        expectRegex = false;
        prevWasDot = true;
        nextParenIsStatementHeader = false;
        continue;
      }
    }
    if (ch === ".") {
      const next = source[pos + 1];
      if (next !== undefined && next >= "0" && next <= "9") {
        pos = skipNumericLiteral(source, pos);
        expectRegex = false;
        prevWasDot = false;
        nextParenIsStatementHeader = false;
        continue;
      }
      pos += 1;
      expectRegex = false;
      prevWasDot = true;
      nextParenIsStatementHeader = false;
      continue;
    }
    const ident = readIdentifier(source, pos);
    if (ident !== null) {
      pos = ident.end;
      if (prevWasDot) {
        expectRegex = false;
        nextParenIsStatementHeader = false;
      } else {
        expectRegex = REGEX_PRECEDING_KEYWORDS.has(ident.text);
        nextParenIsStatementHeader = STATEMENT_HEADER_KEYWORDS.has(ident.text);
      }
      prevWasDot = false;
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      pos = skipNumericLiteral(source, pos);
      expectRegex = false;
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      continue;
    }
    expectRegex = "([,;:=?!&|^~+*%<>".includes(ch) || ch === "-";
    prevWasDot = false;
    nextParenIsStatementHeader = false;
    pos += 1;
  }
  return depth === 0 ? pos : -1;
}

function wrapParenthesized(expression: string): string {
  return endsWithLineComment(expression) ? `(${expression}\n)` : `(${expression})`;
}

function endsWithLineComment(source: string): boolean {
  let pos = 0;
  let expectRegex = true;
  let prevWasDot = false;
  let nextParenIsStatementHeader = false;
  const parenStack: boolean[] = [];
  const templateBraceDepths: number[] = [];

  while (pos < source.length) {
    const ch = source[pos]!;
    if (/\s/.test(ch)) {
      pos += 1;
      continue;
    }
    if (ch === "/" && source[pos + 1] === "/") {
      pos += 2;
      while (pos < source.length && !isLineTerminator(source[pos])) {
        pos += 1;
      }
      if (pos >= source.length) {
        return true;
      }
      pos += 1;
      continue;
    }
    if (ch === "/" && source[pos + 1] === "*") {
      pos += 2;
      while (pos < source.length && !(source[pos] === "*" && source[pos + 1] === "/")) {
        pos += 1;
      }
      pos = Math.min(source.length, pos + 2);
      continue;
    }
    if (ch === "'" || ch === '"') {
      const next = skipStringLiteral(source, pos);
      pos = next === -1 ? source.length : next;
      expectRegex = false;
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      continue;
    }
    if (ch === "`") {
      pos += 1;
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      while (pos < source.length) {
        const tch = source[pos];
        if (tch === "\\") {
          pos += 2;
          continue;
        }
        if (tch === "`") {
          pos += 1;
          expectRegex = false;
          break;
        }
        if (tch === "$" && source[pos + 1] === "{") {
          templateBraceDepths.push(0);
          pos += 2;
          expectRegex = true;
          break;
        }
        pos += 1;
      }
      continue;
    }
    if (ch === "/") {
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      if (expectRegex) {
        const next = skipRegexLiteral(source, pos);
        pos = next === -1 ? pos + 1 : next;
        expectRegex = false;
        continue;
      }
      pos += source[pos + 1] === "=" ? 2 : 1;
      expectRegex = true;
      continue;
    }
    if (ch === "(") {
      parenStack.push(nextParenIsStatementHeader);
      pos += 1;
      expectRegex = true;
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      continue;
    }
    if (ch === ")") {
      expectRegex = parenStack.pop() ?? false;
      pos += 1;
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      continue;
    }
    if (ch === "{") {
      if (templateBraceDepths.length > 0) {
        templateBraceDepths[templateBraceDepths.length - 1]! += 1;
      }
      pos += 1;
      expectRegex = true;
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      continue;
    }
    if (ch === "}") {
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      if (templateBraceDepths.length > 0) {
        const top = templateBraceDepths[templateBraceDepths.length - 1]!;
        if (top === 0) {
          templateBraceDepths.pop();
          pos += 1;
          while (pos < source.length) {
            const tch = source[pos];
            if (tch === "\\") {
              pos += 2;
              continue;
            }
            if (tch === "`") {
              pos += 1;
              expectRegex = false;
              break;
            }
            if (tch === "$" && source[pos + 1] === "{") {
              templateBraceDepths.push(0);
              pos += 2;
              expectRegex = true;
              break;
            }
            pos += 1;
          }
          continue;
        }
        templateBraceDepths[templateBraceDepths.length - 1] = top - 1;
      }
      pos += 1;
      expectRegex = true;
      continue;
    }
    if (ch === "=" && source[pos + 1] === ">") {
      pos += 2;
      expectRegex = true;
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      continue;
    }
    if ((ch === "+" && source[pos + 1] === "+") || (ch === "-" && source[pos + 1] === "-")) {
      pos += 2;
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      continue;
    }
    if (ch === "." && source[pos + 1] === "." && source[pos + 2] === ".") {
      pos += 3;
      expectRegex = true;
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      continue;
    }
    if (ch === "?" && source[pos + 1] === ".") {
      const afterOpt = source[pos + 2];
      if (afterOpt === undefined || afterOpt < "0" || afterOpt > "9") {
        pos += 2;
        expectRegex = false;
        prevWasDot = true;
        nextParenIsStatementHeader = false;
        continue;
      }
    }
    if (ch === ".") {
      const next = source[pos + 1];
      if (next !== undefined && next >= "0" && next <= "9") {
        pos = skipNumericLiteral(source, pos);
        expectRegex = false;
        prevWasDot = false;
        nextParenIsStatementHeader = false;
        continue;
      }
      pos += 1;
      expectRegex = false;
      prevWasDot = true;
      nextParenIsStatementHeader = false;
      continue;
    }
    const ident = readIdentifier(source, pos);
    if (ident !== null) {
      pos = ident.end;
      if (prevWasDot) {
        expectRegex = false;
        nextParenIsStatementHeader = false;
      } else {
        expectRegex = REGEX_PRECEDING_KEYWORDS.has(ident.text);
        nextParenIsStatementHeader = STATEMENT_HEADER_KEYWORDS.has(ident.text);
      }
      prevWasDot = false;
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      pos = skipNumericLiteral(source, pos);
      expectRegex = false;
      prevWasDot = false;
      nextParenIsStatementHeader = false;
      continue;
    }
    expectRegex = "([,;:=?!&|^~+*%<>".includes(ch) || ch === "-";
    prevWasDot = false;
    nextParenIsStatementHeader = false;
    pos += 1;
  }

  return false;
}
