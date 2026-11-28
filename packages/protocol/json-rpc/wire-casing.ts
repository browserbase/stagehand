import camelcaseKeys from "camelcase-keys";
import snakecaseKeys from "snakecase-keys";
import { z } from "zod/v4";

const defaultOpaqueKeys = new Set([
  "headers",
  "variables",
  "attributes",
  "body",
  "data",
  "userMetadata",
]);

const apiAcronymWireKeys: Readonly<Record<string, string>> = {
  base_url: "base_URL",
  ignore_https_errors: "ignore_HTTPS_errors",
  prefer_css_page_size: "prefer_CSS_page_size",
};

export type WireCasingOptions = {
  /** API-side container keys whose nested, user-controlled keys must retain their casing. */
  readonly opaqueKeys?: readonly string[];
  /**
   * API-side container keys whose nested fields use normal protocol casing,
   * even when the key is opaque by default.
   */
  readonly transformKeys?: readonly string[];
};

export function wireSchema<TSchema extends z.ZodType>(
  schema: TSchema,
  options: WireCasingOptions = {},
): z.ZodType<z.output<TSchema>, unknown> {
  const wireOpaqueKeys = resolveWireOpaqueKeys(options);
  return z.preprocess((value) => fromWireTree(value, wireOpaqueKeys), schema);
}

export function encodeWireValue(value: unknown, options: WireCasingOptions = {}) {
  const opaqueKeys = resolveOpaqueKeys(options);
  return z.json().parse(toWireTree(value, opaqueKeys));
}

export function toWireJsonSchema(
  value: unknown,
  preservedPropertyNames: ReadonlySet<string> = new Set(),
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => toWireJsonSchema(entry, preservedPropertyNames));
  }
  if (!isPlainRecord(value)) return value;

  const renamed = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      toWireJsonSchema(entry, preservedPropertyNames),
    ]),
  );
  const properties = value.properties;

  if (isPlainRecord(properties)) {
    renamed.properties = Object.fromEntries(
      Object.entries(properties).map(([key, entry]) => [
        preservedPropertyNames.has(key) ? key : toWireKey(key),
        toWireJsonSchema(entry, preservedPropertyNames),
      ]),
    );
  }

  if (Array.isArray(value.required)) {
    renamed.required = value.required
      .filter((key): key is string => typeof key === "string")
      .map((key) => (preservedPropertyNames.has(key) ? key : toWireKey(key)));
  }

  if (isPlainRecord(value.dependentRequired)) {
    renamed.dependentRequired = Object.fromEntries(
      Object.entries(value.dependentRequired).map(([key, dependencies]) => [
        preservedPropertyNames.has(key) ? key : toWireKey(key),
        Array.isArray(dependencies)
          ? dependencies
              .filter((dependency): dependency is string => typeof dependency === "string")
              .map((dependency) =>
                preservedPropertyNames.has(dependency) ? dependency : toWireKey(dependency),
              )
          : toWireJsonSchema(dependencies, preservedPropertyNames),
      ]),
    );
  }

  return renamed;
}

function toWireKey(key: string): string {
  if (key.startsWith("$") || key.startsWith("_") || key === "constructor") return key;
  return Object.keys(snakecaseKeys({ [key]: null }, { deep: false }))[0] ?? key;
}

function fromWireKey(key: string): string {
  if (key.startsWith("$") || key.startsWith("_") || key === "constructor") return key;
  const mapped = Object.hasOwn(apiAcronymWireKeys, key) ? apiAcronymWireKeys[key]! : key;
  return (
    Object.keys(
      camelcaseKeys({ [mapped]: null }, { deep: false, preserveConsecutiveUppercase: true }),
    )[0] ?? mapped
  );
}

function toWireTree(value: unknown, opaqueKeys: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => toWireTree(entry, opaqueKeys));
  }
  if (!isPlainRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      toWireKey(key),
      opaqueKeys.has(key) ? child : toWireTree(child, opaqueKeys),
    ]),
  );
}

function fromWireTree(value: unknown, wireOpaqueKeys: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => fromWireTree(entry, wireOpaqueKeys));
  }
  if (!isPlainRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      fromWireKey(key),
      wireOpaqueKeys.has(key) ? child : fromWireTree(child, wireOpaqueKeys),
    ]),
  );
}

function resolveOpaqueKeys(options: WireCasingOptions): Set<string> {
  const opaqueKeys = new Set([...defaultOpaqueKeys, ...(options.opaqueKeys ?? [])]);
  for (const key of options.transformKeys ?? []) {
    opaqueKeys.delete(key);
  }
  return opaqueKeys;
}

function resolveWireOpaqueKeys(options: WireCasingOptions): Set<string> {
  const wireOpaqueKeys = new Set<string>();
  for (const key of resolveOpaqueKeys(options)) {
    wireOpaqueKeys.add(toWireKey(key));
    wireOpaqueKeys.add(key);
  }
  return wireOpaqueKeys;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
