import { existsSync, statSync } from "fs";
import path from "path";
import type { Variables } from "../../types/public/agent.js";
import type { Action } from "../../types/public/methods.js";
import { StagehandInvalidArgumentError } from "../../types/public/sdkErrors.js";
import {
  flattenVariables,
  substituteVariables,
} from "../../agent/utils/variables.js";

const FILE_UPLOAD_VERB_RE = /\b(?:upload|attach)\b/i;
const FILE_INPUT_TARGET_RE = /\b(?:field|input|picker|dropzone|drop zone)\b/i;
const VARIABLE_TOKEN_RE = /%([\w.]+)%/g;
const UNRESOLVED_VARIABLE_RE = /%[^%]+%/;
const RELATIVE_PATH_WITH_EXTENSION_RE =
  /(?:^|[/\\])[^/\\]+\.[a-zA-Z0-9]{1,10}$/;

function fileUploadActDisambiguationError(
  candidateCount: number,
  tiedCount?: number,
): string {
  if (tiedCount && tiedCount > 1) {
    return `act(): observe() returned ${candidateCount} "setInputFiles" actions and ${tiedCount} tied as the best match. Name the target field more specifically in the instruction.`;
  }
  return `act(): observe() returned ${candidateCount} "setInputFiles" actions and the instruction could not disambiguate which file input to use. Name the target field more specifically in the instruction.`;
}

/**
 * Returns true when act() must resolve and execute a file upload locally
 * (Browserbase remote act cannot read the developer machine's filesystem).
 */
export function shouldResolveFileUploadLocally(
  instruction: string,
  variables?: Variables,
): boolean {
  const flat = flattenVariables(variables);
  if (!flat) return false;

  if (!FILE_UPLOAD_VERB_RE.test(instruction)) return false;

  const fileVarEntries = Object.entries(flat).filter(([, value]) =>
    looksLikeFilePath(value),
  );
  if (fileVarEntries.length === 0) return false;

  const tokens = extractVariableTokens(instruction);
  if (
    tokens.some((name) => name in flat && looksLikeFilePath(flat[name] ?? ""))
  ) {
    return true;
  }

  if (!FILE_INPUT_TARGET_RE.test(instruction)) return false;

  return fileVarEntries.some(([key]) =>
    instructionMentionsVariableKey(instruction, key),
  );
}

/** Match %key% tokens or whole-word variable names (not substrings like cv in archive). */
export function instructionMentionsVariableKey(
  text: string,
  key: string,
): boolean {
  if (extractVariableTokens(text).includes(key)) return true;
  const pattern = new RegExp(
    `(?:^|[^\\w.])${escapeRegExp(key)}(?:[^\\w.]|$)`,
    "i",
  );
  return pattern.test(text.replace(VARIABLE_TOKEN_RE, " "));
}

export function extractVariableTokens(instruction: string): string[] {
  const tokens: string[] = [];
  for (const match of instruction.matchAll(VARIABLE_TOKEN_RE)) {
    const name = match[1];
    if (name) tokens.push(name);
  }
  return tokens;
}

export function looksLikeFilePath(
  value: string,
  opts: { baseDir?: string } = {},
): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) return false;
  if (path.isAbsolute(trimmed)) return true;
  if (RELATIVE_PATH_WITH_EXTENSION_RE.test(trimmed)) return true;
  return isExistingLocalFile(trimmed, opts.baseDir);
}

function isExistingLocalFile(value: string, baseDir = process.cwd()): boolean {
  try {
    const absolute = path.isAbsolute(value)
      ? value
      : path.resolve(baseDir, value);
    if (!existsSync(absolute)) return false;
    return statSync(absolute).isFile();
  } catch {
    return false;
  }
}

export function selectFileUploadAction(
  actions: Action[],
  instruction: string,
  variables?: Variables,
): Action | undefined {
  const candidates = actions.filter(
    (action) => action.method === "setInputFiles",
  );
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  const instructionWords = tokenizeForMatch(instruction);
  let best: { action: Action; score: number } | undefined;

  for (const action of candidates) {
    const score = scoreFileUploadAction(action, instructionWords, variables);
    if (!best || score > best.score) {
      best = { action, score };
    }
  }

  if (best && best.score > 0) {
    const tied = candidates.filter(
      (action) =>
        scoreFileUploadAction(action, instructionWords, variables) ===
        best!.score,
    );
    if (tied.length > 1) {
      throw new StagehandInvalidArgumentError(
        fileUploadActDisambiguationError(candidates.length, tied.length),
      );
    }
    return best.action;
  }

  throw new StagehandInvalidArgumentError(
    fileUploadActDisambiguationError(candidates.length),
  );
}

export function resolveSetInputFilesArguments(
  action: Action,
  variables?: Variables,
  instruction?: string,
): string[] {
  let args =
    variables && Array.isArray(action.arguments)
      ? action.arguments.map((arg) => substituteVariables(arg, variables))
      : [...(action.arguments ?? [])];

  if (args.length === 0 || args.every((arg) => arg.trim().length === 0)) {
    args = inferFilePathsFromVariables(action, variables, instruction);
  }

  assertResolvedFileArguments(args);
  return args;
}

function inferFilePathsFromVariables(
  action: Action,
  variables?: Variables,
  instruction?: string,
): string[] {
  const flat = flattenVariables(variables);
  if (!flat) return [];

  const fileEntries = Object.entries(flat).filter(([, value]) =>
    looksLikeFilePath(value),
  );
  if (fileEntries.length === 0) return [];

  const instructionMentions = instruction
    ? fileEntries.filter(([key]) =>
        instructionMentionsVariableKey(instruction, key),
      )
    : [];
  const description = action.description ?? "";

  if (instructionMentions.length === 1) {
    return [instructionMentions[0]![1]];
  }
  if (instructionMentions.length > 1) {
    const descriptionScoped = instructionMentions.filter(([key]) =>
      instructionMentionsVariableKey(description, key),
    );
    if (descriptionScoped.length > 0) {
      return descriptionScoped.map(([, value]) => value);
    }
    return instructionMentions.map(([, value]) => value);
  }

  const descriptionMentions = fileEntries.filter(([key]) =>
    instructionMentionsVariableKey(description, key),
  );
  if (descriptionMentions.length === 1) {
    return [descriptionMentions[0]![1]];
  }
  if (descriptionMentions.length > 1) {
    return descriptionMentions.map(([, value]) => value);
  }

  if (fileEntries.length === 1) {
    return [fileEntries[0]![1]];
  }

  return [];
}

function assertResolvedFileArguments(args: string[]): void {
  const unresolved = args.filter((arg) => UNRESOLVED_VARIABLE_RE.test(arg));
  if (unresolved.length > 0) {
    throw new StagehandInvalidArgumentError(
      `setInputFiles(): variable placeholder(s) ${unresolved.join(", ")} were not provided in act() options.variables`,
    );
  }

  if (args.length === 0 || args.some((arg) => arg.trim().length === 0)) {
    throw new StagehandInvalidArgumentError(
      "setInputFiles(): requires at least one non-empty file path. Provide paths through act() options.variables or include %variableName% placeholders in the instruction.",
    );
  }
}

function scoreFileUploadAction(
  action: Action,
  instructionWords: string[],
  variables?: Variables,
): number {
  const haystack = [
    action.description ?? "",
    ...(action.arguments ?? []),
    ...extractVariableTokens(action.description ?? ""),
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;
  for (const word of instructionWords) {
    if (haystack.includes(word)) score += 1;
  }

  const flat = flattenVariables(variables);
  if (flat) {
    for (const [key, value] of Object.entries(flat)) {
      if (!looksLikeFilePath(value)) continue;
      if (instructionMentionsVariableKey(haystack, key)) score += 2;
      if ((action.arguments ?? []).includes(`%${key}%`)) score += 3;
    }
  }

  return score;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenizeForMatch(instruction: string): string[] {
  return instruction
    .toLowerCase()
    .replace(/%[\w.]+%/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
}
