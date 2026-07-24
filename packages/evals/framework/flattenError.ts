/**
 * Flatten a caught error for inclusion in a task result row.
 *
 * Error instances JSON-serialize to `{}` (message/stack are non-enumerable),
 * so returning a raw `error` — or `JSON.parse(JSON.stringify(error))` — hides
 * the real failure from the TUI and Braintrust rows. Flatten to a plain
 * `{ message, stack }` object so the failure reason survives serialization.
 */
export function flattenError(error: unknown): unknown {
  return error instanceof Error
    ? { message: error.message, stack: error.stack }
    : error;
}
