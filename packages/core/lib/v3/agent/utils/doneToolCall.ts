interface DoneToolCallLike {
  toolName?: string;
  dynamic?: boolean;
  invalid?: boolean;
  input?: unknown;
}

function getTaskCompleteValue(input: unknown): boolean {
  if (typeof input !== "object" || input === null) {
    return false;
  }

  const maybeTaskComplete = (input as { taskComplete?: unknown }).taskComplete;
  return maybeTaskComplete === true;
}

/**
 * Returns true only for a non-dynamic, non-invalid done call that explicitly
 * marks taskComplete as true.
 */
export function isTerminalDoneToolCall(toolCall: DoneToolCallLike): boolean {
  if (toolCall.toolName !== "done") return false;
  if (toolCall.dynamic === true || toolCall.invalid === true) return false;
  return getTaskCompleteValue(toolCall.input);
}
