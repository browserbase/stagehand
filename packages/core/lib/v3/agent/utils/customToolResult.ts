export const DEFAULT_CUSTOM_TOOL_SUCCESS_RESULT = "Tool executed successfully";

export function formatCustomToolResult(toolResult: unknown): string {
  return JSON.stringify(toolResult) ?? DEFAULT_CUSTOM_TOOL_SUCCESS_RESULT;
}
