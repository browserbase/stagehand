import assert from "node:assert/strict";

import { noopObserve } from "@mastra/core/tools";

import { createStagehandMcpClient, loadStagehandCodeTools } from "./agent.js";

const marker = "persisted-across-mastra-mcp-calls";
const title = "Mastra code-mode smoke";

const firstCall = `
await page.evaluate(
  ({ marker, title }) => {
    document.title = title;
    document.body.innerHTML = '<main id="mastra-session-marker">' + marker + '</main>';
  },
  { marker: ${JSON.stringify(marker)}, title: ${JSON.stringify(title)} },
);
return {
  title: await page.title(),
  marker: await page.locator("#mastra-session-marker").innerText(),
  pageCount: (await context.pages()).length,
};
`;

const secondCall = `
return {
  title: await page.title(),
  marker: await page.locator("#mastra-session-marker").innerText(),
  pageCount: (await context.pages()).length,
};
`;

const browserMode = process.env.STAGEHAND_BROWSER ?? "local";
process.env.STAGEHAND_BROWSER = browserMode;

const mcp = createStagehandMcpClient();

try {
  const tools = await loadStagehandCodeTools(mcp);
  const execute = tools.code_execute.execute;
  assert.ok(execute, "code_execute must be executable");

  const first = expectSuccessfulResult(
    await execute({ code: firstCall }, { observe: noopObserve }),
  );
  assert.deepEqual(first.value, { title, marker, pageCount: 1 });

  const second = expectSuccessfulResult(
    await execute({ code: secondCall }, { observe: noopObserve }),
  );
  assert.deepEqual(second.value, { title, marker, pageCount: 1 });

  console.log(
    JSON.stringify({
      status: "PASS",
      browser: browserMode,
      tool: "code_execute",
      calls: 2,
      persistentState: second.value,
    }),
  );
} finally {
  await mcp.disconnect();
  console.log("Mastra MCP disconnect PASS");
}

function expectSuccessfulResult(result: unknown): {
  ok: true;
  value: unknown;
} {
  assert.ok(isRecord(result), "code_execute must return an object");
  assert.equal(result.ok, true, `code_execute failed: ${JSON.stringify(result)}`);
  assert.ok("value" in result, "code_execute must return a value");
  return result as { ok: true; value: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
