import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createStagehandSandbox } from "@browserbasehq/stagehand-integrations-example-vercel-sandbox";

import { assertEveEndpointContract, runEveStagehandEval } from "./run-eval.js";

const NO_ERROR = Symbol("no error");
process.env.EVE_HOST_ONLY_MARKER = `host-${randomUUID()}`;

const connection = await createStagehandSandbox({
  packageArtifactsPath: requiredEnvironment("STAGEHAND_SANDBOX_ARTIFACTS"),
  browserbaseApiKey: requiredEnvironment("BROWSERBASE_API_KEY"),
  browserbaseProjectId: requiredEnvironment("BROWSERBASE_PROJECT_ID"),
  vercelCredentials: vercelCredentialsFromEnvironment(),
});

let primaryError: unknown = NO_ERROR;
try {
  await assertEveEndpointContract(connection);
  await runEveStagehandEval(connection, true);
  await runEveStagehandEval(connection, false);
} catch (error) {
  primaryError = error;
}

let cleanupError: unknown;
await connection.close().catch((error: unknown) => {
  cleanupError = error;
});

if (primaryError !== NO_ERROR && cleanupError !== undefined) {
  throw new AggregateError([primaryError, cleanupError], "Eve E2E and sandbox cleanup both failed");
}
if (primaryError !== NO_ERROR) throw primaryError;
if (cleanupError !== undefined) throw cleanupError;

process.stdout.write(
  `${JSON.stringify({
    status: "PASS",
    framework: "eve",
    eveVersion: "0.29.4",
    deterministicEval: true,
    realModelEval: true,
    connectionSearchCallsPerEval: 1,
    codeExecuteCallsPerEval: 2,
    sessionPersisted: true,
    modelCredentialIsolated: true,
    unauthorizedStatus: 401,
    optionalGetStatus: 405,
    cleanup: ["eve-runtime", "vercel-sandbox"],
  })}\n`,
);

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  assert.ok(value, `Missing ${name}`);
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
