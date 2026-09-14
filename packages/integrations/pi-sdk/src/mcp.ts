import {
  HarnessAdapterError,
  sanitizeErrorMessage,
  type HarnessLogger,
} from "@browserbasehq/stagehand-integrations/harness";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { TSchema } from "typebox";
import { isRecord, safeJson, type PiMcpServerSpec, type PiToolDefinition } from "./session.js";

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

export function attachPiMcpStderrLogger(
  stderr: NodeJS.ReadableStream,
  logger: HarnessLogger,
): void {
  let buffer = "";
  let flushed = false;
  const encoded = stderr as NodeJS.ReadableStream & {
    setEncoding?: (encoding: BufferEncoding) => unknown;
  };
  encoded.setEncoding?.("utf8");

  const logLine = (line: string): void => {
    const message = sanitizeErrorMessage(line.replace(/\r$/, "").trim());
    if (message) logger.log({ category: "pi_mcp", message, level: 1 });
  };
  const flush = (): void => {
    if (flushed) return;
    flushed = true;
    logLine(buffer);
    buffer = "";
  };

  stderr.on("data", (chunk) => {
    buffer += String(chunk);
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) logLine(line);
  });
  stderr.on("end", flush);
  stderr.on("close", flush);
}

export async function connectPiMcpServers(
  servers: Record<string, PiMcpServerSpec>,
  opts: { logger: HarnessLogger; signal?: AbortSignal; callTimeoutMs?: number },
): Promise<{ tools: PiToolDefinition[]; close: () => Promise<void> }> {
  const clients: Client[] = [];
  const tools: PiToolDefinition[] = [];
  let closePromise: Promise<void> | undefined;
  const close = async (): Promise<void> => {
    closePromise ??= Promise.all(
      clients.map((client) => client.close().catch(() => undefined)),
    ).then(() => undefined);
    await closePromise;
  };

  try {
    for (const [serverName, spec] of Object.entries(servers)) {
      const client = new Client({ name: `stagehand-evals-pi-${serverName}`, version: "1.0.0" });
      const transport = new StdioClientTransport({ ...spec, stderr: "pipe" });
      if (transport.stderr) {
        attachPiMcpStderrLogger(transport.stderr as unknown as NodeJS.ReadableStream, opts.logger);
      }
      await client.connect(transport, opts.signal ? { signal: opts.signal } : undefined);
      clients.push(client);
      const listed = await client.listTools(
        undefined,
        opts.signal ? { signal: opts.signal } : undefined,
      );
      if (listed.tools.length === 0) {
        opts.logger.warn({
          category: "pi_mcp",
          message: `MCP server "${serverName}" exposed no tools.`,
          level: 1,
        });
      }
      for (const tool of listed.tools) {
        tools.push({
          name: buildPiMcpToolName(serverName, tool.name),
          label: `${serverName}: ${tool.name}`,
          description: tool.description ?? "",
          parameters: tool.inputSchema as TSchema,
          executionMode: "sequential",
          async execute(_toolCallId, params, signal) {
            const result = await client.callTool(
              { name: tool.name, arguments: params as Record<string, unknown> },
              undefined,
              { signal, timeout: opts.callTimeoutMs ?? 120_000 },
            );
            const mapped = mcpCallResultToPiToolResult(
              result as { content?: unknown; structuredContent?: unknown; isError?: unknown },
            );
            if (mapped.isError) {
              throw new HarnessAdapterError("Pi MCP tool failed.");
            }
            return mapped;
          },
        } as PiToolDefinition);
      }
    }
    return { tools, close };
  } catch (error) {
    opts.logger.warn({
      category: "pi_mcp",
      message: `Failed to connect pi MCP servers: ${sanitizeErrorMessage(error instanceof Error ? error.message : String(error))}`,
      level: 0,
    });
    await close();
    throw new HarnessAdapterError("Failed to connect pi MCP servers.");
  }
}

function sanitizeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}
