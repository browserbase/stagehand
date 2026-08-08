import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const stdioServerPath = fileURLToPath(
  new URL("../../../dist/codemode/stdio-server.mjs", import.meta.url),
);
const client = new Client({ name: "stagehand-stdio-smoke", version: "1.0.0" });

try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [stdioServerPath],
      env: localSmokeEnvironment(),
      stderr: "inherit",
    }),
  );
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["code_execute"],
  );

  const first = await client.callTool({
    name: "code_execute",
    arguments: {
      code: `
        await page.goto("https://example.com", { waitUntil: "load" });
        await context.newPage();
        await context.setActivePage(page);
        return { title: await page.title(), pages: (await context.pages()).length };
      `,
    },
  });
  const second = await client.callTool({
    name: "code_execute",
    arguments: {
      code: `return { title: await page.title(), pages: (await context.pages()).length };`,
    },
  });

  assert.ok(containsBrowserState(first.structuredContent), JSON.stringify(first.structuredContent));
  assert.ok(
    containsBrowserState(second.structuredContent),
    JSON.stringify(second.structuredContent),
  );
  process.stdout.write(
    `${JSON.stringify({ status: "PASS", tools: ["code_execute"], statePersisted: true })}\n`,
  );
} finally {
  await client.close().catch(() => undefined);
}

function localSmokeEnvironment(): Record<string, string> {
  const environment: Record<string, string> = { STAGEHAND_BROWSER: "local" };
  for (const name of ["CHROME_PATH", "CI", "HOME", "PATH", "TMPDIR"]) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  return environment;
}

function containsBrowserState(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsBrowserState);
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.title === "Example Domain" && record.pages === 2) return true;
  return Object.values(record).some(containsBrowserState);
}
