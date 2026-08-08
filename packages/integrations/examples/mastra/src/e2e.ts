import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { noopObserve } from "@mastra/core/tools";
import { createStagehandSandbox } from "@browserbasehq/stagehand-integrations-example-vercel-sandbox";

import { createStagehandAgent, type StagehandAgentHandle } from "./agent.js";

const directMarker = `mastra-direct-${randomUUID()}`;
const modelMarker = `mastra-model-${randomUUID()}`;
const NO_ERROR = Symbol("no error");
process.env.MASTRA_HOST_ONLY_MARKER = `host-${randomUUID()}`;

const connection = await createStagehandSandbox({
  packageArtifactsPath: requiredEnvironment("STAGEHAND_SANDBOX_ARTIFACTS"),
  browserbaseApiKey: requiredEnvironment("BROWSERBASE_API_KEY"),
  browserbaseProjectId: requiredEnvironment("BROWSERBASE_PROJECT_ID"),
  vercelCredentials: vercelCredentialsFromEnvironment(),
});

let handle: StagehandAgentHandle | undefined;
let primaryError: unknown = NO_ERROR;
let modelToolCalls = 0;
let finalState: Record<string, unknown> | undefined;

try {
  handle = await createStagehandAgent(connection);
  const execute = handle.tools.code_execute.execute;
  assert.ok(execute, "code_execute must be executable");

  const first = expectSuccessfulResult(
    await execute(
      {
        code: `
          await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
          await page.evaluate((marker) => {
            document.documentElement.dataset.mastraDirectMarker = marker;
          }, ${JSON.stringify(directMarker)});
          return {
            title: await page.title(),
            pageId: page.pageId,
            directMarker: await page.evaluate(
              () => document.documentElement.dataset.mastraDirectMarker,
            ),
            modelKeyVisible: process.env.OPENAI_API_KEY ?? null,
            hostMarkerVisible: process.env.MASTRA_HOST_ONLY_MARKER ?? null,
          };
        `,
      },
      { observe: noopObserve },
    ),
  );
  assert.equal(first.value.title, "Example Domain");
  assert.equal(first.value.directMarker, directMarker);
  assert.equal(first.value.modelKeyVisible, null);
  assert.equal(first.value.hostMarkerVisible, null);

  const second = expectSuccessfulResult(
    await execute(
      {
        code: `
          return {
            title: await page.title(),
            pageId: page.pageId,
            directMarker: await page.evaluate(
              () => document.documentElement.dataset.mastraDirectMarker,
            ),
          };
        `,
      },
      { observe: noopObserve },
    ),
  );
  assert.equal(second.value.title, "Example Domain");
  assert.equal(second.value.pageId, first.value.pageId);
  assert.equal(second.value.directMarker, directMarker);

  const result = await handle.agent.generate(
    [
      "Use code_execute to modify the already-open page.",
      `Set document.documentElement.dataset.mastraModelMarker to ${JSON.stringify(modelMarker)}.`,
      "Then read that dataset value and the current pageId and report them.",
      "You must call code_execute; do not merely describe JavaScript.",
    ].join(" "),
    { maxSteps: 8 },
  );
  assert.equal(result.error, undefined, "the Mastra agent run must not report an error");
  modelToolCalls = result.steps
    .flatMap((step) => step.toolCalls)
    .filter((call) => call.payload.toolName === "code_execute").length;
  assert.ok(modelToolCalls > 0, "the real Mastra model must select code_execute");

  const verified = expectSuccessfulResult(
    await execute(
      {
        code: `
          return {
            title: await page.title(),
            pageId: page.pageId,
            directMarker: await page.evaluate(
              () => document.documentElement.dataset.mastraDirectMarker,
            ),
            modelMarker: await page.evaluate(
              () => document.documentElement.dataset.mastraModelMarker,
            ),
          };
        `,
      },
      { observe: noopObserve },
    ),
  );
  assert.equal(verified.value.title, "Example Domain");
  assert.equal(verified.value.pageId, first.value.pageId);
  assert.equal(verified.value.directMarker, directMarker);
  assert.equal(verified.value.modelMarker, modelMarker);
  finalState = verified.value;
} catch (error) {
  primaryError = error;
}

const cleanupErrors: unknown[] = [];
await handle?.close().catch((error: unknown) => cleanupErrors.push(error));
await connection.close().catch((error: unknown) => cleanupErrors.push(error));
throwPrimaryOrCleanup(primaryError, cleanupErrors);

process.stdout.write(
  `${JSON.stringify({
    status: "PASS",
    framework: "mastra",
    directToolCalls: 3,
    modelToolCalls,
    sessionPersisted: true,
    modelCredentialIsolated: true,
    finalState,
    cleanup: ["mastra-mcp", "vercel-sandbox"],
  })}\n`,
);

function expectSuccessfulResult(result: unknown): {
  ok: true;
  value: Record<string, unknown>;
} {
  assert.ok(isRecord(result), "code_execute must return an object");
  assert.equal(result.ok, true, `code_execute failed: ${JSON.stringify(result)}`);
  assert.ok(isRecord(result.value), "code_execute must return an object value");
  return result as { ok: true; value: Record<string, unknown> };
}

function throwPrimaryOrCleanup(primary: unknown, cleanup: unknown[]): void {
  if (primary !== NO_ERROR && cleanup.length > 0) {
    throw new AggregateError([primary, ...cleanup], "Mastra E2E and cleanup both failed");
  }
  if (primary !== NO_ERROR) throw primary;
  if (cleanup.length > 0) {
    throw new AggregateError(cleanup, "Could not close Mastra MCP and the Vercel Sandbox");
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function vercelCredentialsFromEnvironment():
  | { teamId: string; projectId: string; token: string }
  | undefined {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return undefined;
  return {
    teamId: requiredEnvironment("VERCEL_TEAM_ID"),
    projectId: requiredEnvironment("VERCEL_PROJECT_ID"),
    token,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
