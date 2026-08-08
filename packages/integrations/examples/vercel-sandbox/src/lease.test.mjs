import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXIT_TIMEOUT_MS = 2_000;

test("lease setup failure exits while the parent keeps stdin open", async () => {
  const environment = { ...process.env };
  delete environment.STAGEHAND_SANDBOX_ARTIFACTS;
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

  let timeout;
  const exit = await Promise.race([
    new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("Lease did not exit after setup failure")),
        EXIT_TIMEOUT_MS,
      );
    }),
  ]).finally(() => {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });

  assert.deepEqual(exit, { code: 1, signal: null });
  assert.equal(Buffer.concat(stdout).length, 0);
  assert.match(Buffer.concat(stderr).toString(), /^Stagehand sandbox lease failed: Missing /);
});

test("lease preserves signal exit semantics during setup", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "stagehand-lease-signal-"));
  const artifactRoot = path.join(temporaryRoot, "artifacts");
  const packageRoot = path.join(artifactRoot, "packages");
  const runtimeRoot = path.join(artifactRoot, "runtime");
  const readyPath = path.join(temporaryRoot, "fetch-ready");
  const preloadPath = path.join(temporaryRoot, "block-fetch.mjs");
  const dependencies = {
    "@browserbasehq/stagehand": "file:../packages/stagehand.tgz",
    "@browserbasehq/stagehand-codemode": "file:../packages/stagehand-codemode.tgz",
    supergateway: "3.4.3",
  };
  await Promise.all([
    mkdir(packageRoot, { recursive: true }),
    mkdir(runtimeRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(packageRoot, "stagehand.tgz"), Buffer.from([0x1f, 0x8b])),
    writeFile(path.join(packageRoot, "stagehand-codemode.tgz"), Buffer.from([0x1f, 0x8b])),
    writeFile(path.join(runtimeRoot, "package.json"), JSON.stringify({ dependencies })),
    writeFile(
      path.join(runtimeRoot, "package-lock.json"),
      JSON.stringify({
        lockfileVersion: 3,
        packages: { "": { dependencies } },
      }),
    ),
    writeFile(
      preloadPath,
      [
        'import { writeFileSync } from "node:fs";',
        "globalThis.fetch = (_input, init = {}) => {",
        '  writeFileSync(process.env.STAGEHAND_SIGNAL_READY_FILE, "ready");',
        "  return new Promise((_resolve, reject) => {",
        '    init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });',
        "  });",
        "};",
      ].join("\n"),
    ),
  ]);

  const child = spawn(
    process.execPath,
    [
      fileURLToPath(import.meta.resolve("tsx/cli")),
      fileURLToPath(new URL("./lease.ts", import.meta.url)),
    ],
    {
      env: {
        ...process.env,
        NODE_OPTIONS: `--import=${pathToFileURL(preloadPath).href}`,
        STAGEHAND_SIGNAL_READY_FILE: readyPath,
        STAGEHAND_SANDBOX_ARTIFACTS: artifactRoot,
        BROWSERBASE_API_KEY: "unused-test-key",
        BROWSERBASE_PROJECT_ID: "unused-test-project",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  try {
    await waitForFile(readyPath);
    child.kill("SIGTERM");
    const exit = await waitForExit(child, "Lease did not preserve the setup signal");
    assert.deepEqual(exit, { code: 143, signal: null });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

async function waitForFile(filePath) {
  const deadline = Date.now() + EXIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error("Lease did not reach the blocked setup request");
}

async function waitForExit(child, message) {
  let timeout;
  return Promise.race([
    new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), EXIT_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timeout));
}
