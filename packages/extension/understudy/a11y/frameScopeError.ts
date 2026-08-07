const FRAME_SCOPE_ERROR_PATTERNS = [
  /Frame with (?:the )?given id (?:(?:is|was) )?not found/i,
  /Frame(?: with (?:the )?given id)? does not belong to the target/i,
];

export function isFrameScopeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return FRAME_SCOPE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}
