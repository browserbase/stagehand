/**
 * Unwrap Anthropic's $PARAMETER_NAME wrapper from tool responses.
 *
 * Some Anthropic models wrap tool_use output in a `{ $PARAMETER_NAME: { ... } }`
 * envelope. This helper detects and strips that wrapper so downstream Zod
 * validation sees the expected flat structure.
 */
export function unwrapToolResponse<T>(data: T): T {
  if (
    data !== null &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    Object.keys(data as Record<string, unknown>).length === 1
  ) {
    const key = Object.keys(data as Record<string, unknown>)[0];
    if (key.startsWith("$")) {
      return (data as Record<string, unknown>)[key] as T;
    }
  }
  return data;
}
