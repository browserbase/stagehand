import type { Variables, VariableValue } from "../../types/public/agent.js";

/**
 * Resolves a VariableValue to its primitive string value.
 * Handles both simple primitives ("secret") and rich objects ({ value: "secret", description: "..." }).
 */
export function resolveVariableValue(v: VariableValue): string {
  if (typeof v === "object" && v !== null && "value" in v) {
    return String(v.value);
  }
  return String(v);
}

/**
 * Extracts the optional description from a VariableValue.
 * Returns undefined for simple primitive values.
 */
export function getVariableDescription(v: VariableValue): string | undefined {
  if (typeof v === "object" && v !== null && "value" in v) {
    return v.description;
  }
  return undefined;
}

/**
 * Substitutes %variableName% tokens in text with resolved variable values.
 * Works with both simple and rich variable formats.
 */
export function substituteVariables(
  text: string,
  variables?: Variables,
): string {
  if (!variables) return text;
  let result = text;
  for (const [key, v] of Object.entries(variables)) {
    const token = `%${key}%`;
    result = result.split(token).join(resolveVariableValue(v));
  }
  return result;
}

/**
 * Flattens Variables to Record<string, string> for internal consumers
 * that only need key→value mappings (e.g., actHandler, cache replay).
 */
export function flattenVariables(
  variables?: Variables,
): Record<string, string> | undefined {
  if (!variables || Object.keys(variables).length === 0) return undefined;
  const result: Record<string, string> = {};
  for (const [key, v] of Object.entries(variables)) {
    result[key] = resolveVariableValue(v);
  }
  return result;
}
