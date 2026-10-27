import { isDeepStrictEqual } from "node:util";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import { isRecord } from "../skills/shared.js";

export interface McpEntry {
  command: string;
  args: string[];
}

// Rerunning setup is how users repair or move an installation; keep the
// environment they configured for the server (for example STAGEHAND_* options).
function keptEnvironment(server: unknown, key: string) {
  return isRecord(server) && isRecord(server[key])
    ? { [key]: server[key] }
    : {};
}

export function updateJsonMcp(
  raw: string,
  entry: McpEntry,
  claude: boolean,
): string {
  const source = raw.trim() ? raw : "{}\n";
  const errors: ParseError[] = [];
  const value: unknown = parse(source, errors, { allowTrailingComma: true });
  if (errors.length || !isRecord(value))
    throw new Error("Invalid MCP JSON config.");
  if (value.mcpServers !== undefined && !isRecord(value.mcpServers)) {
    throw new Error("MCP config mcpServers must be an object.");
  }
  const servers = value.mcpServers as Record<string, unknown> | undefined;
  return applyEdits(
    source,
    modify(
      source,
      ["mcpServers", "stagehand"],
      {
        ...(claude ? { type: "stdio" } : {}),
        ...entry,
        ...keptEnvironment(servers?.stagehand, "env"),
      },
      { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } },
    ),
  );
}

export function updateOpenCodeMcp(raw: string, entry: McpEntry): string {
  const source = raw.trim() ? raw : "{}\n";
  const errors: ParseError[] = [];
  const value: unknown = parse(source, errors, { allowTrailingComma: true });
  if (errors.length || !isRecord(value))
    throw new Error("Invalid OpenCode JSON config.");
  if (value.mcp !== undefined && !isRecord(value.mcp))
    throw new Error("OpenCode config mcp must be an object.");
  const mcp = value.mcp as
    | { servers?: Record<string, unknown> | undefined }
    | undefined;
  if (mcp?.servers !== undefined && !isRecord(mcp.servers))
    throw new Error("OpenCode config mcp.servers must be an object.");
  return applyEdits(
    source,
    modify(
      source,
      ["mcp", "servers", "stagehand"],
      {
        type: "local",
        command: [entry.command, ...entry.args],
        timeout: { startup: 60_000, execution: 180_000 },
        ...keptEnvironment(mcp?.servers?.stagehand, "environment"),
      },
      { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } },
    ),
  );
}

export function updateTomlMcp(raw: string, entry: McpEntry): string {
  const existing = parseToml(raw);
  if (existing.mcp_servers !== undefined && !isRecord(existing.mcp_servers)) {
    throw new Error("MCP config mcp_servers must be a table.");
  }
  const servers = existing.mcp_servers as Record<string, unknown> | undefined;
  const expected = {
    ...existing,
    mcp_servers: {
      ...servers,
      stagehand: {
        ...entry,
        startup_timeout_sec: 60,
        tool_timeout_sec: 180,
        ...keptEnvironment(servers?.stagehand, "env"),
      },
    },
  };
  // Keep unrelated TOML, including comments. Verify the complete parsed result
  // before writing, so unusual inline tables or multiline strings fail safely.
  let inStagehand = false;
  const kept: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) {
      inStagehand =
        /^\s*\[\s*(?:mcp_servers|"mcp_servers"|'mcp_servers')\s*\.\s*(?:stagehand|"stagehand"|'stagehand')\s*(?:\.|\])/.test(
          line,
        );
    }
    if (!inStagehand) kept.push(line);
  }
  const block = stringifyToml({
    mcp_servers: { stagehand: expected.mcp_servers.stagehand },
  });
  const result = `${kept.join("\n").trimEnd()}\n\n${block}`.trimStart();
  if (!isDeepStrictEqual(parseToml(result), expected)) {
    throw new Error(
      "Cannot safely update this Codex MCP config. Move the stagehand entry into its own [mcp_servers.stagehand] table and retry.",
    );
  }
  return result;
}
