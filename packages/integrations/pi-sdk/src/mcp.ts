export function isPiMcpToolName(name: string, server?: string): boolean {
  const prefix = server === undefined ? "mcp__" : `mcp__${server.replace(/[^A-Za-z0-9_]/g, "_")}__`;
  return name.startsWith(prefix);
}
