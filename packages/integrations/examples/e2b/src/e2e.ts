import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { createStagehandSandbox, stagehandTransport } from "./sandbox.js";

const markerPath = `/tmp/stagehand-e2b-source-proof-${randomUUID()}`;
const connection = await createStagehandSandbox({
  stagehandRevision: requiredEnvironment("STAGEHAND_REVISION"),
  browserbaseApiKey: requiredEnvironment("BROWSERBASE_API_KEY"),
  browserbaseProjectId: process.env.BROWSERBASE_PROJECT_ID,
  browserbaseCdpHosts: (process.env.BROWSERBASE_CDP_HOSTS ?? "connect.usw2.browserbase.com")
    .split(",")
    .map((hostname) => hostname.trim())
    .filter(Boolean),
});
const client = new Client({ name: "stagehand-e2b-proof", version: "1.0.0" });
let primaryError: unknown;

try {
  await client.connect(stagehandTransport(connection.url, connection.token));
  const { tools } = await client.listTools();
  const codeTools = tools.filter((tool) => tool.name.endsWith("code_execute"));
  assert.equal(tools.length, 1, tools.map((tool) => tool.name).join(", "));
  assert.equal(codeTools.length, 1, tools.map((tool) => tool.name).join(", "));
  const toolName = codeTools[0]!.name;

  const first = await client.callTool({
    name: toolName,
    arguments: {
      code: `
        const fs = await import("node:fs/promises");
        await fs.writeFile(${JSON.stringify(markerPath)}, "inside-e2b");
        await page.goto("https://example.com", { waitUntil: "load" });
        await context.newPage();
        await context.setActivePage(page);
        let unrelatedEgressBlocked = false;
        try {
          await fetch("https://example.org", { signal: AbortSignal.timeout(5_000) });
        } catch {
          unrelatedEgressBlocked = true;
        }
        return {
          title: await page.title(),
          pages: (await context.pages()).length,
          marker: await fs.readFile(${JSON.stringify(markerPath)}, "utf8"),
          hostname: (await fs.readFile("/etc/hostname", "utf8")).trim(),
          unrelatedEgressBlocked,
        };
      `,
    },
  });

  assert.ok(
    containsState(first.structuredContent, {
      title: "Example Domain",
      pages: 2,
      marker: "inside-e2b",
      unrelatedEgressBlocked: true,
    }),
    JSON.stringify(first.structuredContent),
  );
  assert.equal(existsSync(markerPath), false, "sandbox marker escaped to the host filesystem");

  process.stdout.write(
    `${JSON.stringify({ status: "PASS", tools: [toolName], toolCalls: 1, unrelatedEgressBlocked: true, hostMarkerPresent: false })}\n`,
  );
} catch (error) {
  primaryError = error;
}

const cleanupErrors: unknown[] = [];
await client.close().catch((error: unknown) => cleanupErrors.push(error));
await connection.close().catch((error: unknown) => cleanupErrors.push(error));
if (primaryError !== undefined) throw primaryError;
if (cleanupErrors.length > 0) {
  throw new AggregateError(cleanupErrors, "Could not close the MCP client and E2B sandbox");
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

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
