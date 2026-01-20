import type { Variables } from "../../types/public/agent.js";

/**
 * Substitutes %variableName% tokens in text with variable values.
 */
export function substituteVariables(
  text: string,
  variables?: Variables,
): string {
  if (!variables) return text;
  let result = text;
  for (const [key, v] of Object.entries(variables)) {
    const token = `%${key}%`;
    result = result.split(token).join(String(v.value));
  }
  return result;
}

/**
 * Converts agent Variables (with descriptions) to the act variables format (Record<string, string>).
 */
export function toActVariables(
  variables?: Variables,
): Record<string, string> | undefined {
  if (!variables || Object.keys(variables).length === 0) return undefined;
  const result: Record<string, string> = {};
  for (const [key, v] of Object.entries(variables)) {
    result[key] = String(v.value);
  }
  return result;
}
