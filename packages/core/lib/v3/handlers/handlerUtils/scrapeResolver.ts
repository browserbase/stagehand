import type { ScrapeElementReference } from "../../types/public";
import type { StagehandZodSchema } from "../../zodCompat";
import { Page } from "../../understudy/page";
import { LLMClient } from "../../llm/LLMClient";
import { LogLine } from "../../types/public/logs";
import { toJsonSchema } from "../../zodCompat";
import { generateScrapeRegex } from "../../../inference";
import type { ScrapeRegexRule } from "../../types/private";

export async function resolveScrapeReferences(
  result: unknown,
  page: Page,
  schema?: StagehandZodSchema,
  llmClient?: LLMClient,
  logger?: (message: LogLine) => void,
  initialRules?: ScrapeRegexRule[],
  skipRegexCleanup?: boolean,
  onRulesApplied?: (rules: ScrapeRegexRule[]) => void,
): Promise<unknown> {
  let resolved = await resolveNode(result, page);

  if (initialRules && initialRules.length > 0) {
    resolved = applyRegexRules(resolved, initialRules);
  }

  resolved = coerceJsonPrimitives(resolved);

  const shouldSkipRegexCleanup = Boolean(skipRegexCleanup);

  if (!schema) {
    return resolved;
  }

  const schemaJson = JSON.stringify(toJsonSchema(schema), null, 2);

  try {
    const parsed = schema.parse(resolved);

    if (!llmClient || !logger || shouldSkipRegexCleanup) {
      return parsed;
    }

    const regexResult = await requestRegexCleanup({
      schemaJson,
      sample: resolved,
      errorMessage:
        "Schema validation succeeded, but attempt additional cleanup if needed.",
      llmClient,
      logger,
    });

    if (!regexResult) {
      return parsed;
    }

    const cleanedValue = coerceJsonPrimitives(regexResult.cleanedValue);

    try {
      const sanitized = schema.parse(cleanedValue);
      onRulesApplied?.(regexResult.rules);
      return sanitized;
    } catch {
      return parsed;
    }
  } catch (err) {
    if (shouldSkipRegexCleanup) {
      throw err;
    }

    if (!llmClient || !logger) {
      throw err;
    }

    const errorMessage = err instanceof Error ? err.message : String(err);
    const regexResult = await requestRegexCleanup({
      schemaJson,
      sample: resolved,
      errorMessage,
      llmClient,
      logger,
    });

    if (!regexResult) {
      throw err;
    }

    const cleanedValue = coerceJsonPrimitives(regexResult.cleanedValue);

    let finalValue: unknown;
    try {
      finalValue = schema.parse(cleanedValue);
    } catch {
      finalValue = cleanedValue;
    }

    onRulesApplied?.(regexResult.rules);
    return finalValue;
  }
}

function coerceJsonPrimitives(value: unknown): unknown {
  if (typeof value === "string") {
    const parsed = tryParseJsonPrimitive(value);
    return parsed !== null ? parsed : value;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      value[i] = coerceJsonPrimitives(value[i]);
    }
    return value;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string | number, unknown>;
    for (const key of Object.keys(record)) {
      record[key] = coerceJsonPrimitives(record[key]);
    }
    return value;
  }

  return value;
}

function tryParseJsonPrimitive(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (
    trimmed === "true" ||
    trimmed === "false" ||
    trimmed === "null" ||
    /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed)
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  return null;
}

async function requestRegexCleanup(params: {
  schemaJson: string;
  sample: unknown;
  errorMessage: string;
  llmClient: LLMClient;
  logger: (message: LogLine) => void;
}): Promise<{ cleanedValue: unknown; rules: ScrapeRegexRule[] } | null> {
  const { schemaJson, sample, errorMessage, llmClient, logger } = params;
  const sampleJson = JSON.stringify(sample, null, 2);

  const regexResponse = await generateScrapeRegex({
    schema: schemaJson,
    sample: sampleJson,
    error: errorMessage,
    llmClient,
    logger,
  });

  if (!regexResponse?.rules || regexResponse.rules.length === 0) {
    return null;
  }

  const newRules: ScrapeRegexRule[] = regexResponse.rules.map((rule) => ({
    path: rule.path,
    regex: rule.regex,
    replacement: rule.replacement,
    flags: rule.flags,
  }));

  return {
    cleanedValue: applyRegexRules(sample, newRules),
    rules: newRules,
  };
}

async function resolveNode(value: unknown, page: Page): Promise<unknown> {
  if (value === null || typeof value === "undefined") {
    return value;
  }

  if (Array.isArray(value)) {
    const resolved = [] as unknown[];
    for (const item of value) {
      resolved.push(await resolveNode(item, page));
    }
    return resolved;
  }

  if (typeof value === "object") {
    const ref = value as ScrapeElementReference;
    if (typeof ref.id === "string" && ref.xpath) {
      const locator = page.deepLocator(`xpath=${ref.xpath}`);
      try {
        return await locator.textContent();
      } catch (err) {
        throw new Error(
          `Failed to resolve scrape reference at ${ref.xpath}: ${err}`,
        );
      }
    }

    const entries = Object.entries(value as Record<string, unknown>);
    const resultObj: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      resultObj[key] = await resolveNode(val, page);
    }
    return resultObj;
  }

  return value;
}

function applyRegexRules(value: unknown, rules: ScrapeRegexRule[]): unknown {
  return rules.reduce(
    (current, rule) =>
      applyRegexAtPath(
        current,
        rule.path.split("."),
        rule.regex,
        rule.replacement ?? "",
        rule.flags ?? "g",
      ),
    value,
  );
}

function applyRegexAtPath(
  value: unknown,
  segments: string[],
  pattern: string,
  replacement: string,
  flags: string,
): unknown {
  if (segments.length === 0) {
    return applyRegexToValue(value, pattern, replacement, flags);
  }

  const [segment, ...rest] = segments;

  if (segment === "*") {
    if (Array.isArray(value)) {
      return value.map((item) =>
        applyRegexAtPath(item, rest, pattern, replacement, flags),
      );
    }
    if (value && typeof value === "object") {
      const record = value as Record<string | number, unknown>;
      const resultObj: Record<string | number, unknown> = {};
      for (const [key, val] of Object.entries(record)) {
        resultObj[key] = applyRegexAtPath(
          val,
          rest,
          pattern,
          replacement,
          flags,
        );
      }
      return resultObj;
    }
    return value;
  }

  const index = Number(segment);
  if (!Number.isNaN(index) && Array.isArray(value)) {
    const clone = [...value];
    clone[index] = applyRegexAtPath(
      clone[index],
      rest,
      pattern,
      replacement,
      flags,
    );
    return clone;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string | number, unknown>;
    const resultObj: Record<string | number, unknown> = { ...record };
    resultObj[segment] = applyRegexAtPath(
      record[segment],
      rest,
      pattern,
      replacement,
      flags,
    );
    return resultObj;
  }

  return value;
}

function applyRegexToValue(
  value: unknown,
  pattern: string,
  replacement = "",
  flags = "g",
): unknown {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch {
    return value;
  }

  if (typeof value === "string") {
    return value.replace(regex, replacement);
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      applyRegexToValue(item, pattern, replacement, flags),
    );
  }

  if (value && typeof value === "object") {
    const record = value as Record<string | number, unknown>;
    const resultObj: Record<string | number, unknown> = {};
    for (const [key, val] of Object.entries(record)) {
      resultObj[key] = applyRegexToValue(val, pattern, replacement, flags);
    }
    return resultObj;
  }

  return value;
}
