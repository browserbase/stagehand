import { strict as assert } from "node:assert";

import { anthropic } from "@ai-sdk/anthropic";

import { runStagehandAgent, STAGEHAND_TOOL_NAME } from "./agent.js";

const result = await runStagehandAgent(
  anthropic(process.env.VERCEL_STAGEHAND_MODEL ?? "claude-opus-5"),
  [
    `Use ${STAGEHAND_TOOL_NAME} exactly twice.`,
    "First navigate to https://example.com, open one additional blank tab, then restore the Example Domain page as active.",
    "Second return an object with the active page title and total context page count.",
    "Report the title and count in your final answer.",
  ].join(" "),
  {
    stagehandRevision: requiredEnvironment("STAGEHAND_REVISION"),
    browserbaseApiKey: requiredEnvironment("BROWSERBASE_API_KEY"),
    browserbaseProjectId: requiredEnvironment("BROWSERBASE_PROJECT_ID"),
  },
);

assert.deepEqual(result.toolNames, [STAGEHAND_TOOL_NAME, STAGEHAND_TOOL_NAME]);
assert.ok(
  result.toolOutputs.some((output) => containsBrowserState(output, "Example Domain", 2)),
  `Expected structured title/page-count evidence: ${JSON.stringify(result.toolOutputs)}`,
);

process.stdout.write(
  `${JSON.stringify({ status: "PASS", toolNames: result.toolNames, state: { title: "Example Domain", pages: 2 } })}\n`,
);

function containsBrowserState(value: unknown, title: string, pages: number): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsBrowserState(entry, title, pages));
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.title === title && (record.pages === pages || record.pageCount === pages)) {
    return true;
  }
  return Object.values(record).some((entry) => containsBrowserState(entry, title, pages));
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
