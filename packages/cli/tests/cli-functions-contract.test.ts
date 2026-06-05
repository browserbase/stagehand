import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  jsonResponse,
  startFakeBrowserbaseServer,
  type CapturedRequest,
} from "./helpers/fake-browserbase-server.js";
import { runCli } from "./helpers/run-cli.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cleanupPaths: string[] = [];
const cleanupProcesses: ChildProcessWithoutNullStreams[] = [];

afterEach(async () => {
  while (cleanupProcesses.length > 0) {
    const child = cleanupProcesses.pop();
    if (!child || child.killed) {
      continue;
    }
    child.kill("SIGTERM");
    await waitForExit(child);
  }

  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

describe("functions API contracts", () => {
  it("publishes a Functions archive and polls build status", async () => {
    const cwd = await createFunctionFixture("functions-publish-");

    await withServer(
      async (request, response) => {
        if (
          request.method === "POST" &&
          request.path === "/v1/functions/builds"
        ) {
          jsonResponse(response, 200, { id: "build_123" });
          return;
        }

        if (
          request.method === "GET" &&
          request.path === "/v1/functions/builds/build_123"
        ) {
          jsonResponse(response, 200, {
            builtFunctions: [{ id: "fn_123", name: "my-function" }],
            id: "build_123",
            status: "COMPLETED",
          });
          return;
        }

        jsonResponse(response, 404, { error: "not found" });
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli(
          [
            "functions",
            "publish",
            "index.ts",
            "--api-key",
            "test-key",
            "--base-url",
            baseUrl,
          ],
          { cwd },
        );

        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          id: "build_123",
          status: "COMPLETED",
        });
        expectRequest(requests[0], "POST", "/v1/functions/builds", "test-key");
        expect(requests[0]?.headers["content-type"]).toContain(
          "multipart/form-data",
        );
        expect(requests[0]?.bodyText).toContain('"entrypoint":"index.ts"');
        expectRequest(
          requests[1],
          "GET",
          "/v1/functions/builds/build_123",
          "test-key",
        );
      },
    );
  });

  it("prints publish dry-run archive metadata", async () => {
    const cwd = await createFunctionFixture("functions-dry-run-");
    const fakeBin = await createFakePackageManagerBin(
      "npm",
      "#!/bin/sh\necho npm should not run during dry-run >&2\nexit 99\n",
    );
    await mkdir(join(cwd, ".browserbase", "functions", "manifests"), {
      recursive: true,
    });
    await writeFile(
      join(cwd, ".browserbase", "functions", "manifests", "local.json"),
      "{}",
    );

    const result = await runCli(
      [
        "functions",
        "publish",
        "index.ts",
        "--dry-run",
        "--api-key",
        "test-key",
      ],
      {
        cwd,
        env: {
          PATH: `${fakeBin}:${process.env.PATH}`,
        },
      },
    );

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as {
      dryRun: boolean;
      entrypoint: string;
      files: string[];
    };
    expect(output.dryRun).toBe(true);
    expect(output.entrypoint).toBe("index.ts");
    expect(output.files).toContain("index.ts");
    expect(output.files).toContain("package.json");
    expect(output.files.some((file) => file.startsWith(".browserbase/"))).toBe(
      false,
    );
  });

  it("exits nonzero when a build fails", async () => {
    const cwd = await createFunctionFixture("functions-publish-fail-");

    await withServer(
      async (request, response) => {
        if (
          request.method === "POST" &&
          request.path === "/v1/functions/builds"
        ) {
          jsonResponse(response, 200, { id: "build_failed" });
          return;
        }

        jsonResponse(response, 200, {
          id: "build_failed",
          status: "FAILED",
        });
      },
      async ({ baseUrl }) => {
        const result = await runCli(
          [
            "functions",
            "publish",
            "index.ts",
            "--api-key",
            "test-key",
            "--base-url",
            baseUrl,
          ],
          { cwd },
        );

        expect(result.exitCode).toBe(1);
        expect(JSON.parse(result.stdout)).toMatchObject({
          id: "build_failed",
          status: "FAILED",
        });
      },
    );
  });

  it("invokes a deployed Function and polls invocation status", async () => {
    await withServer(
      async (request, response) => {
        if (
          request.method === "POST" &&
          request.path === "/v1/functions/fn_123/invoke"
        ) {
          jsonResponse(response, 200, {
            functionId: "fn_123",
            id: "inv_123",
            status: "RUNNING",
          });
          return;
        }

        if (
          request.method === "GET" &&
          request.path === "/v1/functions/invocations/inv_123"
        ) {
          jsonResponse(response, 200, {
            functionId: "fn_123",
            id: "inv_123",
            results: { ok: true },
            status: "COMPLETED",
          });
          return;
        }

        jsonResponse(response, 404, { error: "not found" });
      },
      async ({ baseUrl, requests }) => {
        const result = await runCli([
          "functions",
          "invoke",
          "fn_123",
          "--params",
          '{"url":"https://example.com"}',
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          id: "inv_123",
          results: { ok: true },
          status: "COMPLETED",
        });
        expectRequest(
          requests[0],
          "POST",
          "/v1/functions/fn_123/invoke",
          "test-key",
        );
        expect(requests[0]?.jsonBody).toMatchObject({
          params: { url: "https://example.com" },
        });
        expectRequest(
          requests[1],
          "GET",
          "/v1/functions/invocations/inv_123",
          "test-key",
        );
      },
    );
  });

  it("exits nonzero when an invocation fails", async () => {
    await withServer(
      async (request, response) => {
        if (
          request.method === "POST" &&
          request.path === "/v1/functions/fn_123/invoke"
        ) {
          jsonResponse(response, 200, {
            functionId: "fn_123",
            id: "inv_failed",
            status: "RUNNING",
          });
          return;
        }

        jsonResponse(response, 200, {
          functionId: "fn_123",
          id: "inv_failed",
          status: "FAILED",
        });
      },
      async ({ baseUrl }) => {
        const result = await runCli([
          "functions",
          "invoke",
          "fn_123",
          "--api-key",
          "test-key",
          "--base-url",
          baseUrl,
        ]);

        expect(result.exitCode).toBe(1);
        expect(JSON.parse(result.stdout)).toMatchObject({
          id: "inv_failed",
          status: "FAILED",
        });
      },
    );
  });
});

describe("functions scaffolding and local dev", () => {
  it("scaffolds a Functions project", async () => {
    const cwd = await createTempDir("functions-init-");
    const fakeBin = await createFakePackageManagerBin();

    const result = await runCli(
      ["functions", "init", "demo-function", "--package-manager", "pnpm"],
      {
        cwd,
        env: {
          PATH: `${fakeBin}:${process.env.PATH}`,
        },
      },
    );

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      projectRoot: string;
    };
    expect(output.ok).toBe(true);
    expect(output.projectRoot.endsWith("demo-function")).toBe(true);

    const entrypoint = await readFile(
      join(cwd, "demo-function", "index.ts"),
      "utf8",
    );
    expect(entrypoint).toContain(
      'import { defineFn } from "@browserbasehq/sdk-functions";',
    );
    expect(
      await readFile(join(cwd, "demo-function", ".env"), "utf8"),
    ).toContain("BROWSERBASE_API_KEY=");
  });

  it("runs a local dev server and invokes a function", async () => {
    const cwd = await createTempDir("functions-dev-");
    const port = await getFreePort();
    await writeRuntimeEntrypoint(cwd);

    await withServer(
      async (request, response) => {
        if (request.method === "POST" && request.path === "/v1/sessions") {
          jsonResponse(response, 200, {
            connectUrl: "ws://example.test/devtools",
            id: "sess_123",
          });
          return;
        }

        if (
          request.method === "POST" &&
          request.path === "/v1/sessions/sess_123"
        ) {
          jsonResponse(response, 200, {
            id: "sess_123",
            status: "REQUEST_RELEASE",
          });
          return;
        }

        jsonResponse(response, 404, { error: "not found" });
      },
      async ({ baseUrl, requests }) => {
        const child = spawn(
          process.execPath,
          [
            join(repoRoot, "bin/run.js"),
            "functions",
            "dev",
            "runtime-entry.mjs",
            "--port",
            String(port),
            "--api-key",
            "test-key",
            "--base-url",
            baseUrl,
          ],
          {
            cwd,
            env: {
              ...process.env,
              NODE_ENV: "test",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        cleanupProcesses.push(child);

        await waitForStdout(child, '"ok": true');

        const allowedOrigin = `http://localhost:${port}`;
        const optionsResponse = await fetch(
          `http://127.0.0.1:${port}/v1/functions/test-function/invoke`,
          {
            headers: {
              origin: allowedOrigin,
            },
            method: "OPTIONS",
          },
        );
        expect(optionsResponse.status).toBe(204);
        expect(optionsResponse.headers.get("access-control-allow-origin")).toBe(
          allowedOrigin,
        );
        expect(optionsResponse.headers.get("vary")).toBe("Origin");
        await expect(optionsResponse.text()).resolves.toBe("");

        const invokeResponse = await fetch(
          `http://127.0.0.1:${port}/v1/functions/test-function/invoke`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: allowedOrigin,
            },
            body: JSON.stringify({ params: { answer: 42 } }),
          },
        );
        expect(invokeResponse.status).toBe(200);
        expect(invokeResponse.headers.get("access-control-allow-origin")).toBe(
          allowedOrigin,
        );
        await expect(invokeResponse.json()).resolves.toMatchObject({
          ok: true,
          params: { answer: 42 },
          sessionId: "sess_123",
        });

        await waitForRequests(requests, 2);
        expectRequest(requests[0], "POST", "/v1/sessions", "test-key");
        expectRequest(requests[1], "POST", "/v1/sessions/sess_123", "test-key");
      },
    );
  }, 30_000);

  it("blocks browser origins outside loopback before creating a session", async () => {
    const cwd = await createTempDir("functions-dev-cors-");
    const port = await getFreePort();
    await writeRuntimeEntrypoint(cwd);

    await withServer(
      async (request, response) => {
        if (request.method === "POST" && request.path === "/v1/sessions") {
          jsonResponse(response, 200, {
            connectUrl: "ws://example.test/devtools",
            id: "sess_123",
          });
          return;
        }

        jsonResponse(response, 404, { error: "not found" });
      },
      async ({ baseUrl, requests }) => {
        const child = spawn(
          process.execPath,
          [
            join(repoRoot, "bin/run.js"),
            "functions",
            "dev",
            "runtime-entry.mjs",
            "--port",
            String(port),
            "--api-key",
            "test-key",
            "--base-url",
            baseUrl,
          ],
          {
            cwd,
            env: {
              ...process.env,
              NODE_ENV: "test",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        cleanupProcesses.push(child);

        await waitForStdout(child, '"ok": true');

        const blockedOrigin = "https://evil.example";
        const optionsResponse = await fetch(
          `http://127.0.0.1:${port}/v1/functions/test-function/invoke`,
          {
            headers: {
              origin: blockedOrigin,
            },
            method: "OPTIONS",
          },
        );
        expect(optionsResponse.status).toBe(403);
        expect(
          optionsResponse.headers.get("access-control-allow-origin"),
        ).toBeNull();

        const invokeResponse = await fetch(
          `http://127.0.0.1:${port}/v1/functions/test-function/invoke`,
          {
            body: JSON.stringify({ params: { answer: 42 } }),
            headers: {
              "content-type": "application/json",
              origin: blockedOrigin,
            },
            method: "POST",
          },
        );
        expect(invokeResponse.status).toBe(403);
        expect(
          invokeResponse.headers.get("access-control-allow-origin"),
        ).toBeNull();
        await expect(invokeResponse.json()).resolves.toMatchObject({
          error: "Origin is not allowed.",
        });

        await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
        expect(requests).toHaveLength(0);
      },
    );
  }, 30_000);

  it("reports not ready if the local runtime never connects", async () => {
    const cwd = await createTempDir("functions-dev-runtime-not-ready-");
    const port = await getFreePort();
    await writeIdleRuntimeEntrypoint(cwd);

    await withServer(
      async (_request, response) => {
        jsonResponse(response, 404, { error: "not found" });
      },
      async ({ baseUrl }) => {
        const child = spawn(
          process.execPath,
          [
            join(repoRoot, "bin/run.js"),
            "functions",
            "dev",
            "runtime-entry.mjs",
            "--port",
            String(port),
            "--api-key",
            "test-key",
            "--base-url",
            baseUrl,
          ],
          {
            cwd,
            env: {
              ...process.env,
              BROWSERBASE_FUNCTIONS_DEV_STARTUP_TIMEOUT_MS: "0",
              NODE_ENV: "test",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        cleanupProcesses.push(child);

        const stdout = await waitForStdout(child, '"ok": false');
        expect(stdout).toContain('"ok": false');
        expect(stdout).toContain('"runtimeConnected": false');
        expect(stdout).toContain(`"url": "http://127.0.0.1:${port}"`);
        expect(stdout).toContain("runtime has not connected");

        const healthResponse = await fetch(`http://127.0.0.1:${port}/`);
        expect(healthResponse.status).toBe(200);
      },
    );
  }, 30_000);

  it("returns a JSON error if local session creation fails", async () => {
    const cwd = await createTempDir("functions-dev-session-fail-");
    const port = await getFreePort();
    await writeRuntimeEntrypoint(cwd);

    await withServer(
      async (_request, response) => {
        jsonResponse(response, 500, { message: "session create failed" });
      },
      async ({ baseUrl }) => {
        const child = spawn(
          process.execPath,
          [
            join(repoRoot, "bin/run.js"),
            "functions",
            "dev",
            "runtime-entry.mjs",
            "--port",
            String(port),
            "--api-key",
            "test-key",
            "--base-url",
            baseUrl,
          ],
          {
            cwd,
            env: {
              ...process.env,
              NODE_ENV: "test",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        cleanupProcesses.push(child);

        await waitForStdout(child, '"ok": true');

        const invokeResponse = await fetch(
          `http://127.0.0.1:${port}/v1/functions/test-function/invoke`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({ params: {} }),
          },
        );
        expect(invokeResponse.status).toBe(500);
        await expect(invokeResponse.json()).resolves.toMatchObject({
          error: "session create failed",
        });
        expect(child.exitCode).toBe(null);
      },
    );
  }, 30_000);

  it("continues accepting local invokes if session cleanup fails", async () => {
    const cwd = await createTempDir("functions-dev-cleanup-fail-");
    const port = await getFreePort();
    const runtimeStatusLog = join(cwd, "runtime-response-status.log");
    await writeRuntimeEntrypoint(cwd, { runtimeStatusLog });
    let sessionCount = 0;

    await withServer(
      async (request, response) => {
        if (request.method === "POST" && request.path === "/v1/sessions") {
          sessionCount += 1;
          jsonResponse(response, 200, {
            connectUrl: "ws://example.test/devtools",
            id: `sess_${sessionCount}`,
          });
          return;
        }

        if (
          request.method === "POST" &&
          request.path.startsWith("/v1/sessions/sess_")
        ) {
          jsonResponse(response, 500, { message: "cleanup failed" });
          return;
        }

        jsonResponse(response, 404, { error: "not found" });
      },
      async ({ baseUrl }) => {
        const child = spawn(
          process.execPath,
          [
            join(repoRoot, "bin/run.js"),
            "functions",
            "dev",
            "runtime-entry.mjs",
            "--port",
            String(port),
            "--api-key",
            "test-key",
            "--base-url",
            baseUrl,
          ],
          {
            cwd,
            env: {
              ...process.env,
              NODE_ENV: "test",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        cleanupProcesses.push(child);

        await waitForStdout(child, '"ok": true');

        const first = await invokeLocalFunction(port, { attempt: 1 });
        expect(first.status).toBe(200);
        await expect(first.json()).resolves.toMatchObject({
          ok: true,
          sessionId: "sess_1",
        });
        await waitForFileText(runtimeStatusLog, "202\n");

        const second = await invokeLocalFunction(port, { attempt: 2 });
        expect(second.status).toBe(200);
        await expect(second.json()).resolves.toMatchObject({
          ok: true,
          sessionId: "sess_2",
        });
        await waitForFileText(runtimeStatusLog, "202\n202\n");
      },
    );
  }, 30_000);

  it("fails the active invoke if the runtime response payload is malformed", async () => {
    const cwd = await createTempDir("functions-dev-malformed-response-");
    const port = await getFreePort();
    const runtimeStatusLog = join(cwd, "runtime-response-status.log");
    await writeRuntimeEntrypoint(cwd, {
      malformedResponse: true,
      runtimeStatusLog,
    });
    let sessionCount = 0;

    await withServer(
      async (request, response) => {
        if (request.method === "POST" && request.path === "/v1/sessions") {
          sessionCount += 1;
          jsonResponse(response, 200, {
            connectUrl: "ws://example.test/devtools",
            id: `sess_${sessionCount}`,
          });
          return;
        }

        if (
          request.method === "POST" &&
          request.path.startsWith("/v1/sessions/sess_")
        ) {
          jsonResponse(response, 200, { status: "REQUEST_RELEASE" });
          return;
        }

        jsonResponse(response, 404, { error: "not found" });
      },
      async ({ baseUrl }) => {
        const child = spawn(
          process.execPath,
          [
            join(repoRoot, "bin/run.js"),
            "functions",
            "dev",
            "runtime-entry.mjs",
            "--port",
            String(port),
            "--api-key",
            "test-key",
            "--base-url",
            baseUrl,
          ],
          {
            cwd,
            env: {
              ...process.env,
              NODE_ENV: "test",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        cleanupProcesses.push(child);

        await waitForStdout(child, '"ok": true');

        const first = await invokeLocalFunction(port, { attempt: 1 });
        expect(first.status).toBe(500);
        expect(first.headers.get("access-control-allow-origin")).toBeNull();
        await expect(first.json()).resolves.toMatchObject({
          error: {
            errorMessage: expect.stringContaining(
              "Invalid runtime response payload",
            ),
          },
        });
        await waitForFileText(runtimeStatusLog, "400\n");

        const second = await invokeLocalFunction(port, { attempt: 2 });
        expect(second.status).toBe(500);
        await expect(second.json()).resolves.toMatchObject({
          error: {
            errorMessage: expect.stringContaining(
              "Invalid runtime response payload",
            ),
          },
        });
        await waitForFileText(runtimeStatusLog, "400\n400\n");
      },
    );
  }, 30_000);

  it("shuts down if the runtime process already exited", async () => {
    const cwd = await createTempDir("functions-dev-runtime-exit-");
    const port = await getFreePort();
    await writeExitingRuntimeEntrypoint(cwd);

    await withServer(
      async (_request, response) => {
        jsonResponse(response, 404, { error: "not found" });
      },
      async ({ baseUrl }) => {
        const child = spawn(
          process.execPath,
          [
            join(repoRoot, "bin/run.js"),
            "functions",
            "dev",
            "runtime-entry.mjs",
            "--port",
            String(port),
            "--api-key",
            "test-key",
            "--base-url",
            baseUrl,
          ],
          {
            cwd,
            env: {
              ...process.env,
              NODE_ENV: "test",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        cleanupProcesses.push(child);

        await waitForStdout(child, '"ok": true', 15_000);
        child.kill("SIGTERM");
        await waitForExit(child, 5_000);
        expect(child.exitCode ?? child.signalCode).not.toBe(null);
      },
    );
  }, 30_000);
});

async function createFunctionFixture(prefix: string): Promise<string> {
  const cwd = await createTempDir(prefix);
  await writeFile(join(cwd, "index.ts"), "export const value = 1;\n");
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify(
      {
        name: "functions-fixture",
        private: true,
        type: "module",
      },
      null,
      2,
    ),
  );
  return cwd;
}

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  cleanupPaths.push(directory);
  return directory;
}

async function createFakePackageManagerBin(
  name = "pnpm",
  contents = "#!/bin/sh\nexit 0\n",
): Promise<string> {
  const directory = await createTempDir("functions-fake-bin-");
  const scriptPath = join(directory, name);
  await writeFile(scriptPath, contents);
  await chmod(scriptPath, 0o755);
  return directory;
}

async function writeRuntimeEntrypoint(
  cwd: string,
  options: { malformedResponse?: boolean; runtimeStatusLog?: string } = {},
): Promise<void> {
  await writeFile(
    join(cwd, "runtime-entry.mjs"),
    `
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const manifestsDir = join(process.cwd(), ".browserbase", "functions", "manifests");
mkdirSync(manifestsDir, { recursive: true });
writeFileSync(join(manifestsDir, "test-function.json"), JSON.stringify({
  name: "test-function",
  config: {},
}, null, 2));

const runtimeApi = process.env.AWS_LAMBDA_RUNTIME_API;
const runtimeStatusLog = ${options.runtimeStatusLog ? JSON.stringify(options.runtimeStatusLog) : "null"};

while (true) {
  const next = await fetch(\`http://\${runtimeApi}/2018-06-01/runtime/invocation/next\`);
  const requestId = next.headers.get("Lambda-Runtime-Aws-Request-Id");
  const event = await next.json();
  ${
    options.malformedResponse
      ? `
  const malformedResponse = await fetch(\`http://\${runtimeApi}/2018-06-01/runtime/invocation/\${requestId}/response\`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  if (runtimeStatusLog) {
    appendFileSync(runtimeStatusLog, \`\${malformedResponse.status}\\n\`);
  }
  continue;
`
      : ""
  }
  const response = await fetch(\`http://\${runtimeApi}/2018-06-01/runtime/invocation/\${requestId}/response\`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ok: true,
      params: event.params,
      sessionId: event.context.session.id,
    }),
  });
  if (runtimeStatusLog) {
    appendFileSync(runtimeStatusLog, \`\${response.status}\\n\`);
  }
}
`,
  );
}

async function writeExitingRuntimeEntrypoint(cwd: string): Promise<void> {
  await writeFile(
    join(cwd, "runtime-entry.mjs"),
    `
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const manifestsDir = join(process.cwd(), ".browserbase", "functions", "manifests");
mkdirSync(manifestsDir, { recursive: true });
writeFileSync(join(manifestsDir, "test-function.json"), JSON.stringify({
  name: "test-function",
  config: {},
}, null, 2));

const runtimeApi = process.env.AWS_LAMBDA_RUNTIME_API;
const controller = new AbortController();
setTimeout(() => controller.abort(), 50);
try {
  await fetch(\`http://\${runtimeApi}/2018-06-01/runtime/invocation/next\`, {
    signal: controller.signal,
  });
} catch {
}
`,
  );
}

async function writeIdleRuntimeEntrypoint(cwd: string): Promise<void> {
  await writeFile(
    join(cwd, "runtime-entry.mjs"),
    `
setInterval(() => {}, 1_000);
`,
  );
}

async function getFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not allocate test port.");
  }
  await new Promise<void>((resolvePromise) =>
    server.close(() => resolvePromise()),
  );
  return address.port;
}

async function invokeLocalFunction(
  port: number,
  params: Record<string, unknown>,
): Promise<Response> {
  return await fetch(
    `http://127.0.0.1:${port}/v1/functions/test-function/invoke`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ params }),
    },
  );
}

async function waitForFileText(
  filePath: string,
  expectedText: string,
): Promise<string> {
  const deadline = Date.now() + 10_000;
  let lastText = "";
  while (Date.now() < deadline) {
    try {
      lastText = await readFile(filePath, "utf8");
      if (lastText.includes(expectedText)) {
        return lastText;
      }
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      ) {
        throw error;
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(
    `Timed out waiting for ${filePath} to include ${expectedText}. Saw: ${lastText}`,
  );
}

async function withServer(
  handler: (
    request: CapturedRequest,
    response: Parameters<typeof jsonResponse>[0],
  ) => Promise<void> | void,
  callback: (
    server: Awaited<ReturnType<typeof startFakeBrowserbaseServer>>,
  ) => Promise<void>,
): Promise<void> {
  const server = await startFakeBrowserbaseServer(handler);
  try {
    await callback(server);
  } finally {
    await server.close();
  }
}

function expectRequest(
  request: CapturedRequest | undefined,
  method: string,
  path: string,
  apiKey: string,
): void {
  expect(request).toBeDefined();
  expect(request?.method).toBe(method);
  expect(request?.path).toBe(path);
  expect(request?.headers["x-bb-api-key"]).toBe(apiKey);
}

async function waitForStdout(
  child: ChildProcessWithoutNullStreams,
  text: string,
  timeoutMs = 10_000,
): Promise<string> {
  return await new Promise<string>((resolvePromise, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for stdout to include ${text}. Saw stdout: ${stdout}. Saw stderr: ${stderr}`,
        ),
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes(text)) {
        clearTimeout(timer);
        resolvePromise(stdout);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Dev server exited early with code ${code}. Saw stdout: ${stdout}. Saw stderr: ${stderr}`,
        ),
      );
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function waitForRequests(
  requests: CapturedRequest[],
  count: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (requests.length >= count) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(
    `Timed out waiting for ${count} requests. Saw ${requests.length}.`,
  );
}

async function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs = 10_000,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for child process to exit."));
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}
