import { z } from "zod/v4";
import type { ExecuteStagehandSnippetInput } from "./types.js";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>;

const RESERVED_BINDINGS = new Set(["page", "context", "stagehand", "z", "console"]);
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export async function executeStagehandSnippet(
  input: ExecuteStagehandSnippetInput,
): Promise<unknown> {
  const bindings = Object.entries(input.bindings ?? {});
  for (const [name] of bindings) {
    if (!isAsyncFunctionParameter(name)) {
      throw new TypeError(`Code-mode binding "${name}" is not a valid JavaScript identifier.`);
    }
    if (RESERVED_BINDINGS.has(name)) {
      throw new TypeError(`Code-mode binding "${name}" is reserved.`);
    }
  }

  const parameters: Array<[string, unknown]> = [
    ["page", input.page],
    ["context", input.context],
    ...(input.stagehand
      ? ([
          ["stagehand", input.stagehand],
          ["z", z],
        ] as Array<[string, unknown]>)
      : []),
    ...bindings,
    ["console", input.console ?? console],
  ];
  const fn = new AsyncFunction(...parameters.map(([name]) => name), input.code);
  return await fn(...parameters.map(([, value]) => value));
}

function isAsyncFunctionParameter(name: string): boolean {
  if (!IDENTIFIER.test(name)) return false;
  try {
    new AsyncFunction(name, "");
    return true;
  } catch {
    return false;
  }
}
