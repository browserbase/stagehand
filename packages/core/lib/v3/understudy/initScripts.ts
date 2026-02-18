import { promises as fs } from "fs";
import { InitScriptSource } from "../types/private/index.js";
import { StagehandInvalidArgumentError } from "../types/public/sdkErrors.js";

const DEFAULT_CALLER = "context.addInitScript";

function appendSourceURL(source: string, filePath: string): string {
  const sanitized = filePath.replace(/\n/g, "");
  return `${source}\n//# sourceURL=${sanitized}`;
}

export async function normalizeInitScriptSource<Arg>(
  script: InitScriptSource<Arg>,
  arg?: Arg,
  caller: string = DEFAULT_CALLER,
): Promise<string> {
  if (typeof script === "function") {
    const argString = Object.is(arg, undefined)
      ? "undefined"
      : JSON.stringify(arg);
    return `(${script.toString()})(${argString})`;
  }

  if (!Object.is(arg, undefined)) {
    throw new StagehandInvalidArgumentError(
      `${caller}: 'arg' is only supported when passing a function.`,
    );
  }

  if (typeof script === "string") {
    return script;
  }

  if (!script || typeof script !== "object") {
    throw new StagehandInvalidArgumentError(
      `${caller}: provide a string, function, or an object with path/content.`,
    );
  }

  if (typeof script.content === "string") {
    return script.content;
  }

  if (typeof script.path === "string" && script.path.trim()) {
    const raw = await fs.readFile(script.path, "utf8");
    return appendSourceURL(raw, script.path);
  }

  throw new StagehandInvalidArgumentError(
    `${caller}: provide a string, function, or an object with path/content.`,
  );
}
