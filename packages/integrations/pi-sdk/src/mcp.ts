import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { isRecord, safeJson } from "./session.js";

export const PI_MCP_TOOL_PREFIX = "mcp__";

export function buildPiMcpToolName(server: string, tool: string): string {
  return `${PI_MCP_TOOL_PREFIX}${sanitizeName(server)}__${sanitizeName(tool)}`;
}

export function isPiMcpToolName(name: string, server?: string): boolean {
  return server === undefined
    ? name.startsWith(PI_MCP_TOOL_PREFIX)
    : name.startsWith(`${PI_MCP_TOOL_PREFIX}${sanitizeName(server)}__`);
}

export function mcpCallResultToPiToolResult(result: {
  content?: unknown;
  structuredContent?: unknown;
  isError?: unknown;
}): AgentToolResult<unknown> & { isError: boolean } {
  const content = Array.isArray(result.content)
    ? result.content.map((block) => {
        if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
          return { type: "text" as const, text: block.text };
        }
        if (
          isRecord(block) &&
          block.type === "image" &&
          typeof block.data === "string" &&
          typeof block.mimeType === "string"
        ) {
          return { type: "image" as const, data: block.data, mimeType: block.mimeType };
        }
        return { type: "text" as const, text: safeJson(block) ?? String(block) };
      })
    : [];
  return {
    content,
    details: result.structuredContent ?? {},
    isError: result.isError === true,
  };
}

export function piToolResultText(result: { content: unknown }): string {
  if (!Array.isArray(result.content)) return "";
  return result.content
    .filter(
      (block): block is { type: "text"; text: string } =>
        isRecord(block) && block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

function sanitizeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}
