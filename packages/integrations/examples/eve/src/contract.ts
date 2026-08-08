import assert from "node:assert/strict";

import { startEveContractServer } from "./contract-server.js";
import { assertEveEndpointContract, runEveStagehandEval } from "./run-eval.js";

const server = await startEveContractServer();
let primaryError: unknown;
try {
  await assertEveEndpointContract(server);
  await runEveStagehandEval(server, true);
  assert.equal(server.codeExecuteCalls(), 2, "Eve must call code_execute twice in one session");
} catch (error) {
  primaryError = error;
}

let cleanupError: unknown;
await server.close().catch((error: unknown) => {
  cleanupError = error;
});

if (primaryError !== undefined && cleanupError !== undefined) {
  throw new AggregateError([primaryError, cleanupError], "Eve contract and cleanup both failed");
}
if (primaryError !== undefined) throw primaryError;
if (cleanupError !== undefined) throw cleanupError;

process.stdout.write(
  `${JSON.stringify({
    status: "PASS",
    framework: "eve",
    proof: "deterministic authenticated Streamable HTTP contract",
    connectionSearchCalls: 1,
    codeExecuteCalls: 2,
    unauthorizedStatus: 401,
    optionalGetStatus: 405,
  })}\n`,
);
