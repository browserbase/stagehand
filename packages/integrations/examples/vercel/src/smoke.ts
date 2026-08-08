import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type { Tool } from "ai";

const stdioServerPath = fileURLToPath(
  new URL("../../../dist/codemode/stdio-server.mjs", import.meta.url),
);
let client: MCPClient | undefined;

try {
  client = await createMCPClient({
    transport: new Experimental_StdioMCPTransport({
      command: process.execPath,
      args: [stdioServerPath],
      env: localSmokeEnvironment(),
    }),
  });
  const tools = await client.tools();
  assert.deepEqual(Object.keys(tools), ["code_execute"]);

  const tool = tools.code_execute as Tool<{ code: string }, unknown>;
  assert.equal(typeof tool?.execute, "function");
  const first = await tool.execute!(
    {
      code: `
        await page.goto("https://example.com", { waitUntil: "load" });
        await context.newPage();
        await context.setActivePage(page);
        return { title: await page.title(), pages: (await context.pages()).length };
      `,
    },
    { context: {}, messages: [], toolCallId: "vercel-smoke-1" },
  );
  const second = await tool.execute!(
    { code: `return { title: await page.title(), pages: (await context.pages()).length };` },
    { context: {}, messages: [], toolCallId: "vercel-smoke-2" },
  );

  assert.ok(containsBrowserState(first, "Example Domain", 2), JSON.stringify(first));
  assert.ok(containsBrowserState(second, "Example Domain", 2), JSON.stringify(second));
  process.stdout.write(
    `${JSON.stringify({ status: "PASS", tools: ["code_execute"], statePersisted: true })}\n`,
  );
} finally {
  await client?.close().catch(() => undefined);
}

function localSmokeEnvironment(): Record<string, string> {
  const environment: Record<string, string> = { STAGEHAND_BROWSER: "local" };
  for (const name of ["CHROME_PATH", "HOME", "PATH", "TMPDIR"]) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  return environment;
}

function containsBrowserState(value: unknown, title: string, pages: number): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsBrowserState(entry, title, pages));
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.title === title && record.pages === pages) return true;
  return Object.values(record).some((entry) => containsBrowserState(entry, title, pages));
}
