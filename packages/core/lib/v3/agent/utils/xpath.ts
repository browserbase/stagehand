/**
 * Utility functions for XPath handling in agent tools.
 */

/**
 * Ensures a value is properly formatted as an XPath selector.
 * Returns null if the value is not a valid string.
 *
 * @param value - The value to normalize as an XPath
 * @returns The normalized XPath string prefixed with "xpath=" or null
 */
export function ensureXPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("xpath=") ? trimmed : `xpath=${trimmed}`;
}
