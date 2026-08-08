import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const EXIT_TIMEOUT_MS = 2_000;

test("lease setup failure exits while the parent keeps stdin open", async () => {
  const environment = { ...process.env };
  delete environment.STAGEHAND_REVISION;
  delete environment.BROWSERBASE_API_KEY;
  delete environment.BROWSERBASE_PROJECT_ID;

  const child = spawn(
    process.execPath,
    [
      fileURLToPath(import.meta.resolve("tsx/cli")),
      fileURLToPath(new URL("./lease.ts", import.meta.url)),
    ],
    {
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));

  const exit = await Promise.race([
    new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Lease did not exit after setup failure")),
        EXIT_TIMEOUT_MS,
      ),
    ),
  ]).finally(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });

  assert.deepEqual(exit, { code: 1, signal: null });
  assert.equal(Buffer.concat(stdout).length, 0);
  assert.match(Buffer.concat(stderr).toString(), /^Stagehand sandbox lease failed: Missing /);
});
