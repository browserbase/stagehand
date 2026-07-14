import camelcaseKeys from "camelcase-keys";
import snakecaseKeys from "snakecase-keys";
import { z } from "zod/v4";

// Values under these keys are user-controlled maps or JSON, so casing conversion
// must rename the container but preserve every key inside it.
const defaultOpaqueKeys = new Set(["headers", "variables", "attributes", "body", "data"]);

export type WireCasingOptions = {
  readonly opaqueKeys?: readonly string[];
};

export function wireSchema<TSchema extends z.ZodType>(
  schema: TSchema,
  options: WireCasingOptions = {},
): z.ZodType<z.output<TSchema>, unknown> {
  return z.preprocess(
    (value) =>
      isCaseable(value)
        ? camelcaseKeys(value, {
            deep: true,
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

export function renameJsonSchemaProperties(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(renameJsonSchemaProperties);
  if (!isRecord(value)) return value;

  const renamed = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, renameJsonSchemaProperties(entry)]),
  );
  const properties = value.properties;

  if (isRecord(properties)) {
    renamed.properties = snakecaseKeys(
      Object.fromEntries(
        Object.entries(properties).map(([key, entry]) => [key, renameJsonSchemaProperties(entry)]),
      ),
    );
  }

  if (Array.isArray(value.required)) {
    const required = Object.fromEntries(
      value.required
        .filter((key): key is string => typeof key === "string")
        .map((key) => [key, null]),
    );
    renamed.required = Object.keys(snakecaseKeys(required));
  }

  return renamed;
}

function findOpaquePaths(value: unknown, additionalOpaqueKeys: readonly string[] = []): string[] {
  const paths: string[] = [];
  const opaqueKeys = new Set([...defaultOpaqueKeys, ...additionalOpaqueKeys]);

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

function isCaseable(value: unknown): value is Record<string, unknown> | Record<string, unknown>[] {
  return isRecord(value) || (Array.isArray(value) && value.every(isRecord));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
