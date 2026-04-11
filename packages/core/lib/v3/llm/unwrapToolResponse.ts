/**
 * Unwrap tool parameter name wrapping from LLM responses.
 *
 * Some providers (notably Anthropic) may wrap tool_use responses in the tool's
 * parameter name key. For example, when the AI SDK uses an internal "json" tool
 * for structured output, the response may come back as:
 *
 *   { "$PARAMETER_NAME": { "elementId": "11-811", ... } }
 *
 * instead of the expected flat object:
 *
 *   { "elementId": "11-811", ... }
 *
 * This helper detects single-key wrappers where the key starts with "$" or
 * doesn't match any expected schema property, and unwraps them.
 */
export function unwrapToolResponse<T extends Record<string, unknown>>(
  result: T,
  expectedKeys?: string[],
): T {
  if (result == null || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }

  const keys = Object.keys(result);

  // Only unwrap if there's exactly one key that looks like a wrapper
  if (keys.length !== 1) {
    return result;
  }

  const [wrapperKey] = keys;
  const inner = result[wrapperKey];

  // Don't unwrap if the inner value isn't an object
  if (inner == null || typeof inner !== "object" || Array.isArray(inner)) {
    return result;
  }

  // Unwrap if the key starts with "$" (tool parameter naming convention)
  if (wrapperKey.startsWith("$")) {
    return inner as T;
  }

  // Unwrap if we have expected keys and the wrapper key isn't one of them
  // but the inner object has at least one expected key
  if (expectedKeys && expectedKeys.length > 0) {
    const isWrapperExpected = expectedKeys.includes(wrapperKey);
    const innerKeys = Object.keys(inner as Record<string, unknown>);
    const innerHasExpectedKey = innerKeys.some((k) => expectedKeys.includes(k));

    if (!isWrapperExpected && innerHasExpectedKey) {
      return inner as T;
    }
  }

  return result;
}
