import camelcaseKeys from "camelcase-keys";
import snakecaseKeys from "snakecase-keys";
import { z } from "zod/v4";

// Values under these keys are user-controlled maps or JSON, so casing conversion
// must rename the container but preserve every key inside it.
const defaultOpaqueKeys = new Set([
  "headers",
  "variables",
  "attributes",
  "body",
  "data",
  "userMetadata",
]);

export type WireCasingOptions = {
  /** API-side container keys whose nested, user-controlled keys must retain their casing. */
  readonly opaqueKeys?: readonly string[];
};

export function wireSchema<TSchema extends z.ZodType>(
  schema: TSchema,
  options: WireCasingOptions = {},
): z.ZodType<z.output<TSchema>, unknown> {
  return z.preprocess(
    (value) =>
      isCaseable(value)
        ? camelcaseKeys(preserveApiAcronyms(value, options.opaqueKeys), {
            deep: true,
            preserveConsecutiveUppercase: true,
            stopPaths: findOpaquePaths(value, options.opaqueKeys),
          })
        : value,
    schema,
  );
}

export function encodeWireValue(value: unknown, options: WireCasingOptions = {}) {
  const opaqueKeys = new Set([...defaultOpaqueKeys, ...(options.opaqueKeys ?? [])]);
  return z.json().parse(
    isCaseable(value)
      ? snakecaseKeys(value, {
          deep: true,
          shouldRecurse: (key) => !opaqueKeys.has(String(key)),
        })
      : value,
  );
}

export function toWireJsonSchema(
  value: unknown,
  preservedPropertyNames: ReadonlySet<string> = new Set(),
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => toWireJsonSchema(entry, preservedPropertyNames));
  }
  if (!isRecord(value)) return value;

  const renamed = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      toWireJsonSchema(entry, preservedPropertyNames),
    ]),
  );
  const properties = value.properties;

  if (isRecord(properties)) {
    renamed.properties = Object.fromEntries(
      Object.entries(properties).map(([key, entry]) => [
        preservedPropertyNames.has(key) ? key : toWirePropertyName(key),
        toWireJsonSchema(entry, preservedPropertyNames),
      ]),
    );
  }

  if (Array.isArray(value.required)) {
    renamed.required = value.required
      .filter((key): key is string => typeof key === "string")
      .map((key) => (preservedPropertyNames.has(key) ? key : toWirePropertyName(key)));
  }

  return renamed;
}

function toWirePropertyName(key: string): string {
  if (key.startsWith("$") || key.startsWith("_")) return key;
  return Object.keys(snakecaseKeys({ [key]: null }, { deep: false }))[0] ?? key;
}

function findOpaquePaths(value: unknown, additionalOpaqueKeys: readonly string[] = []): string[] {
  const paths: string[] = [];
  const opaqueKeys = new Set(
    Object.keys(
      snakecaseKeys(
        Object.fromEntries(
          [...defaultOpaqueKeys, ...additionalOpaqueKeys].map((key) => [key, null]),
        ),
      ),
    ),
  );

  function visit(entry: unknown, path: string): void {
    if (Array.isArray(entry)) {
      entry.forEach((item) => visit(item, path));
      return;
    }
    if (!isRecord(entry)) return;

    for (const [key, child] of Object.entries(entry)) {
      const childPath = path ? `${path}.${key}` : key;
      if (opaqueKeys.has(key)) {
        paths.push(childPath);
      } else {
        visit(child, childPath);
      }
    }
  }

  visit(value, "");
  return paths;
}

function preserveApiAcronyms(
  value: Record<string, unknown> | Record<string, unknown>[],
  additionalOpaqueKeys: readonly string[] = [],
): Record<string, unknown> | Record<string, unknown>[] {
  const opaqueKeys = new Set(
    Object.keys(
      snakecaseKeys(
        Object.fromEntries(
          [...defaultOpaqueKeys, ...additionalOpaqueKeys].map((key) => [key, null]),
        ),
      ),
    ),
  );

  function visit(entry: unknown): unknown {
    if (Array.isArray(entry)) return entry.map(visit);
    if (!isRecord(entry)) return entry;
    return Object.fromEntries(
      Object.entries(entry).map(([key, child]) => [
        key === "base_url" ? "base_URL" : key,
        opaqueKeys.has(key) ? child : visit(child),
      ]),
    );
  }

  return visit(value) as Record<string, unknown> | Record<string, unknown>[];
}

function isCaseable(value: unknown): value is Record<string, unknown> | Record<string, unknown>[] {
  return isRecord(value) || (Array.isArray(value) && value.every(isRecord));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
