import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const stdioServerPath = fileURLToPath(
  new URL("../../../dist/codemode/stdio-server.mjs", import.meta.url),
);
const client = new Client({ name: "stagehand-vercel-sandbox-smoke", version: "1.0.0" });
let primaryError: unknown;

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
        await page.evaluate(() => { document.documentElement.dataset.smoke = "persisted"; });
        return { title: await page.title() };
      `,
    },
  });
  const second = await client.callTool({
    name: "code_execute",
    arguments: {
      code: `
        return {
          title: await page.title(),
          marker: await page.evaluate(() => document.documentElement.dataset.smoke),
        };
      `,
    },
  });

  assert.ok(containsState(first.structuredContent, { title: "Example Domain" }));
  assert.ok(
    containsState(second.structuredContent, {
      title: "Example Domain",
      marker: "persisted",
    }),
  );
} catch (error) {
  primaryError = error;
}

let cleanupError: unknown;
await client.close().catch((error: unknown) => {
  cleanupError = error;
});
if (primaryError !== undefined && cleanupError !== undefined) {
  throw new AggregateError(
    [primaryError, cleanupError],
    "Stagehand sandbox smoke failed and MCP client cleanup also failed",
  );
}
if (primaryError !== undefined) throw primaryError;
if (cleanupError !== undefined) throw cleanupError;

process.stdout.write(
  `${JSON.stringify({ status: "PASS", tools: ["code_execute"], calls: 2, statePersisted: true })}\n`,
);

function localSmokeEnvironment(): Record<string, string> {
  const environment: Record<string, string> = { STAGEHAND_BROWSER: "local" };
  for (const name of ["CHROME_PATH", "CI", "HOME", "PATH", "TMPDIR"]) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  return environment;
}

function containsState(value: unknown, expected: Record<string, unknown>): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsState(entry, expected));
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (Object.entries(expected).every(([key, expectedValue]) => record[key] === expectedValue)) {
    return true;
  }
  return Object.values(record).some((entry) => containsState(entry, expected));
}
