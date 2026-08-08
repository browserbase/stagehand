import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

void test("stdio wrapper reports a controlled startup failure", async () => {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./stdio-wrapper.mjs", import.meta.url))],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const result = await new Promise((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
  });

  assert.deepEqual(result, { code: 1, signal: null });
  assert.equal(stderr, "Stagehand code-mode process failed to start.\n");
});
