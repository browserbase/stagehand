import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import Browserbase from "@browserbasehq/sdk";
import { chromium } from "playwright";

import {
  assertFetchOk,
  assertFetchStatus,
  endSession,
  fetchWithContext,
  getBaseUrl,
  getHeaders,
  LOCAL_BROWSER_BODY,
  HTTP_BAD_REQUEST,
  HTTP_OK,
} from "../utils.js";
import type { BrowserbaseRegion } from "@browserbasehq/stagehand";

// =============================================================================
// Response Type Definitions
// =============================================================================

interface StartSuccessResponse {
  success: true;
  data: {
    sessionId: string;
    cdpUrl: string;
    available: boolean;
  };
}

interface StartUnavailableResponse {
  success: true;
  data: {
    sessionId: null;
    available: false;
  };
}

interface StartErrorResponse {
  success: false;
  message: string;
}

type StartResponse =
  | StartSuccessResponse
  | StartUnavailableResponse
  | StartErrorResponse;

function isSuccessResponse(
  response: StartResponse,
): response is StartSuccessResponse {
  return response.success && response.data.sessionId !== null;
}

type SeaHandle = {
  proc: ChildProcessWithoutNullStreams;
  baseUrl: string;
  logs: string[];
};

type SupervisorInfo = {
  pid: number;
  args: string;
  chromePid?: number;
};

const repoRoot = (() => {
  const value = fileURLToPath(import.meta.url).replaceAll("\\", "/");
  const root = value.split("/packages/server/")[0];
  if (root === value) {
    throw new Error(`Unable to determine repo root from ${value}`);
  }
  return root;
})();

const defaultSeaBinaryName = `stagehand-server-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
const seaBinaryPath = `${repoRoot}/packages/server/dist/sea/${process.env.SEA_BINARY_NAME ?? defaultSeaBinaryName}`;
const bbApiKey = process.env.BROWSERBASE_API_KEY;
const bbProjectId = process.env.BROWSERBASE_PROJECT_ID;
const activeSea = new Set<SeaHandle>();

afterEach(async () => {
  await Promise.all(
    [...activeSea].map(async (handle) => {
      await stopSeaServer(handle);
      activeSea.delete(handle);
    }),
  );
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to allocate an ephemeral port"));
        return;
      }
      const { port } = addr;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

function listProcesses(): Array<{ pid: number; args: string }> {
  const output = execFileSync("ps", ["-axo", "pid=,args="], {
    encoding: "utf8",
  });
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const firstSpace = line.indexOf(" ");
      if (firstSpace === -1) {
        return { pid: Number(line), args: "" };
      }
      return {
        pid: Number(line.slice(0, firstSpace)),
        args: line.slice(firstSpace + 1),
      };
    })
    .filter((entry) => Number.isFinite(entry.pid) && entry.pid > 0);
}

function parseSupervisorConfigArg(args: string): {
  kind?: string;
  pid?: number;
  parentPid?: number;
} | null {
  const prefix = "--supervisor-config=";
  const index = args.indexOf(prefix);
  if (index === -1) return null;
  const raw = args.slice(index + prefix.length).trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as {
      kind?: string;
      pid?: number;
      parentPid?: number;
    };
  } catch {
    return null;
  }
}

function findLocalSupervisorByParentPid(
  parentPid: number,
): SupervisorInfo | null {
  const candidates = listProcesses()
    .map((entry) => ({
      ...entry,
      config: parseSupervisorConfigArg(entry.args),
    }))
    .filter(
      (entry) =>
        entry.config?.kind === "LOCAL" && entry.config.parentPid === parentPid,
    )
    .sort((a, b) => b.pid - a.pid);

  const entry = candidates[0];
  if (!entry) return null;

  return {
    pid: entry.pid,
    args: entry.args,
    chromePid:
      typeof entry.config?.pid === "number" && Number.isFinite(entry.config.pid)
        ? entry.config.pid
        : undefined,
  };
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ESRCH") return false;
    return true;
  }
}

async function waitForValue<T>(
  read: () => T | null,
  timeoutMs: number,
  intervalMs = 200,
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = read();
    if (value !== null) return value;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

async function waitForPidState(
  pid: number,
  shouldBeAlive: boolean,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (isPidAlive(pid) === shouldBeAlive) return;
    await sleep(200);
  }
  const entry = listProcesses().find((candidate) => candidate.pid === pid);
  const details = entry ? ` args=${entry.args}` : "";
  throw new Error(
    `PID ${pid} did not become ${shouldBeAlive ? "alive" : "dead"} within ${timeoutMs}ms${details}`,
  );
}

async function waitForServerReady(baseUrl: string, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await sleep(500);
  }
  throw new Error(
    `Server did not become ready at ${baseUrl} within ${timeoutMs}ms`,
  );
}

async function waitForProcessExit(
  proc: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  if (proc.exitCode !== null) {
    return true;
  }
  return await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function startSeaServer(
  envOverrides: Record<string, string> = {},
): Promise<SeaHandle> {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs: string[] = [];
  const proc = spawn(
    seaBinaryPath,
    ["--node-options=--no-lazy --enable-source-maps"],
    {
      env: {
        ...process.env,
        ...envOverrides,
        NODE_ENV: "production",
        PORT: String(port),
        STAGEHAND_SEA_CACHE_DIR:
          process.env.STAGEHAND_SEA_CACHE_DIR ?? `${repoRoot}/.stagehand-sea`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  proc.stdout.on("data", (chunk: Buffer) => {
    const value = chunk.toString().trim();
    if (value) logs.push(value);
  });
  proc.stderr.on("data", (chunk: Buffer) => {
    const value = chunk.toString().trim();
    if (value) logs.push(value);
  });

  if (!proc.pid) {
    throw new Error("SEA process did not provide a PID");
  }

  const handle: SeaHandle = { proc, baseUrl, logs };
  activeSea.add(handle);

  try {
    await waitForServerReady(baseUrl);
    return handle;
  } catch (error) {
    await stopSeaServer(handle);
    const tail = logs.slice(-30).join("\n");
    throw new Error(
      `Failed to start SEA server at ${baseUrl}: ${(error as Error).message}\n${tail}`,
    );
  }
}

async function stopSeaServer(handle: SeaHandle): Promise<void> {
  const { proc } = handle;
  if (proc.exitCode !== null) return;
  try {
    proc.kill("SIGTERM");
  } catch {
    // ignore
  }
  const exited = await waitForProcessExit(proc, 5_000);
  if (!exited) {
    try {
      proc.kill("SIGKILL");
    } catch {
      // ignore
    }
    await waitForProcessExit(proc, 5_000);
  }
}

async function forceKillSeaServer(handle: SeaHandle): Promise<void> {
  const { proc } = handle;
  if (proc.exitCode !== null) return;
  try {
    proc.kill("SIGKILL");
  } catch {
    // ignore
  }
  await waitForProcessExit(proc, 5_000);
}

async function startKeepAliveFalseLocalSession(baseUrl: string): Promise<{
  sessionId: string;
  cdpUrl: string;
}> {
  const headers = getHeaders("3.0.0");
  const ctx = await fetchWithContext<StartResponse>(
    `${baseUrl}/v1/sessions/start`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        modelName: "gpt-4.1-nano",
        keepAlive: false,
        ...LOCAL_BROWSER_BODY,
      }),
    },
  );

  assert.equal(
    ctx.status,
    HTTP_OK,
    `Expected local /start to succeed, got ${ctx.status}\n${ctx.debugSummary()}`,
  );
  assertFetchOk(ctx.body !== null, "Should have response body", ctx);
  assertFetchOk(
    isSuccessResponse(ctx.body),
    "Should return a successful start response",
    ctx,
  );
  return {
    sessionId: ctx.body.data.sessionId,
    cdpUrl: ctx.body.data.cdpUrl,
  };
}

async function startKeepAliveFalseBrowserbaseSession(
  baseUrl: string,
): Promise<string> {
  assert.ok(bbApiKey, "BROWSERBASE_API_KEY must be set");
  assert.ok(bbProjectId, "BROWSERBASE_PROJECT_ID must be set");
  const headers = {
    ...getHeaders("3.0.0"),
    "x-bb-api-key": bbApiKey,
    "x-bb-project-id": bbProjectId,
  };
  const ctx = await fetchWithContext<StartResponse>(
    `${baseUrl}/v1/sessions/start`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        modelName: "gpt-4.1-nano",
        keepAlive: false,
        experimental: true,
        browser: { type: "browserbase" },
      }),
    },
  );

  assert.equal(
    ctx.status,
    HTTP_OK,
    `Expected browserbase /start to succeed, got ${ctx.status}\n${ctx.debugSummary()}`,
  );
  assertFetchOk(ctx.body !== null, "Should have response body", ctx);
  assertFetchOk(
    isSuccessResponse(ctx.body),
    "Should return a successful start response",
    ctx,
  );
  const sessionId = ctx.body.data.sessionId;

  // Browserbase Stagehand init is lazy; navigate once to ensure supervisor is running.
  const navigateCtx = await fetchWithContext<{ success?: boolean }>(
    `${baseUrl}/v1/sessions/${sessionId}/navigate`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ url: "https://example.com", frameId: "" }),
    },
  );
  assert.equal(
    navigateCtx.status,
    HTTP_OK,
    `Expected browserbase /navigate to succeed, got ${navigateCtx.status}\n${navigateCtx.debugSummary()}`,
  );

  return sessionId;
}

async function closeLocalBrowserViaCdp(cdpUrl: string): Promise<void> {
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const context = browser.contexts()[0];
    if (!context) return;
    const page = context.pages()[0] ?? (await context.newPage());
    const cdp = await context.newCDPSession(page);
    await cdp.send("Browser.close");
  } finally {
    await browser.close().catch(() => {
      // best-effort close of Playwright transport
    });
  }
}

async function waitForBrowserbaseNotRunning(
  sessionId: string,
  timeoutMs: number,
): Promise<string> {
  assert.ok(bbApiKey, "BROWSERBASE_API_KEY must be set");
  const bb = new Browserbase({ apiKey: bbApiKey });

  let lastStatus = "UNKNOWN";
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const snapshot = (await bb.sessions.retrieve(sessionId)) as {
        status?: string;
      };
      lastStatus = snapshot.status ?? "UNKNOWN";
      if (lastStatus !== "RUNNING") {
        return lastStatus;
      }
    } catch {
      return "RETRIEVE_FAILED";
    }
    await sleep(1000);
  }
  throw new Error(
    `Browserbase session ${sessionId} stayed RUNNING for ${timeoutMs}ms (last status=${lastStatus})`,
  );
}

async function requestBrowserbaseReleaseBestEffort(sessionId: string) {
  if (!bbApiKey || !bbProjectId) return;
  const bb = new Browserbase({ apiKey: bbApiKey });
  try {
    await bb.sessions.update(sessionId, {
      status: "REQUEST_RELEASE",
      projectId: bbProjectId,
    });
  } catch {
    // best-effort cleanup
  }
}

// =============================================================================
// V3 Format Tests (x-sdk-version: 3.x.x header)
// =============================================================================

describe("POST /v1/sessions/start - V3 format", () => {
  const headers = getHeaders("3.0.0");
  const localBrowser = LOCAL_BROWSER_BODY;

  it("should start session with modelName string and V3 header", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ modelName: "gpt-4.1-nano", ...localBrowser }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Request should succeed");
    assertFetchOk(ctx.body !== null, "Should have response body", ctx);
    assertFetchOk(
      isSuccessResponse(ctx.body),
      "Should be a success response",
      ctx,
    );
    assertFetchOk(ctx.body.data.available, "Session should be available", ctx);
    assertFetchOk(!!ctx.body.data.sessionId, "Should have sessionId", ctx);
    assertFetchOk(!!ctx.body.data.cdpUrl, "Should have cdpUrl", ctx);

    await endSession(ctx.body.data.sessionId, headers);
  });

  it("should start session with experimental flag", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelName: "gpt-4.1-nano",
          experimental: true,
          ...localBrowser,
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Request should succeed");
    assertFetchOk(ctx.body !== null, "Should have response body", ctx);
    assertFetchOk(
      isSuccessResponse(ctx.body),
      "Should be a success response",
      ctx,
    );

    await endSession(ctx.body.data.sessionId, headers);
  });

  it("should accept x-language header for python V3", async () => {
    const url = getBaseUrl();
    const pythonHeaders = getHeaders("1.0.0", "python");

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers: pythonHeaders,
        body: JSON.stringify({ modelName: "gpt-4.1-nano", ...localBrowser }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Request should succeed");
    assertFetchOk(ctx.body !== null, "Should have response body", ctx);
    assertFetchOk(
      isSuccessResponse(ctx.body),
      "Should be a success response",
      ctx,
    );

    await endSession(ctx.body.data.sessionId, pythonHeaders);
  });

  it("should start session with extended options (timeouts, verbose)", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelName: "gpt-4.1-nano",
          actTimeoutMs: 30000,
          domSettleTimeoutMs: 5000,
          verbose: "2",
          ...localBrowser,
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Request should succeed");
    assertFetchOk(ctx.body !== null, "Should have response body", ctx);
    assertFetchOk(
      isSuccessResponse(ctx.body),
      "Should be a success response",
      ctx,
    );
    assertFetchOk(ctx.body.data.available, "Session should be available", ctx);
    assertFetchOk(!!ctx.body.data.sessionId, "Should have sessionId", ctx);

    await endSession(ctx.body.data.sessionId, headers);
  });

  it("should return cdpUrl as a valid WebSocket URL for local browser", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ modelName: "gpt-4.1-nano", ...localBrowser }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Request should succeed");
    assertFetchOk(ctx.body !== null, "Should have response body", ctx);
    assertFetchOk(
      isSuccessResponse(ctx.body),
      "Should be a success response",
      ctx,
    );
    // cdpUrl should not be empty since we eagerly launch the browser
    assertFetchOk(
      ctx.body.data.cdpUrl !== "",
      "cdpUrl should not be empty",
      ctx,
    );
    // cdpUrl should be a valid WebSocket URL
    assertFetchOk(
      ctx.body.data.cdpUrl.startsWith("ws://"),
      "cdpUrl should be a WebSocket URL",
      ctx,
    );

    await endSession(ctx.body.data.sessionId, headers);
  });

  it("should return provided cdpUrl when explicit cdpUrl is passed", async () => {
    const url = getBaseUrl();
    const providedCdpUrl = "ws://localhost:9222/devtools/browser/test";

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelName: "gpt-4.1-nano",
          browser: { type: "local", cdpUrl: providedCdpUrl },
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Request should succeed");
    assertFetchOk(ctx.body !== null, "Should have response body", ctx);
    assertFetchOk(
      isSuccessResponse(ctx.body),
      "Should be a success response",
      ctx,
    );
    assertFetchOk(
      ctx.body.data.cdpUrl === providedCdpUrl,
      "cdpUrl should match provided value",
      ctx,
    );

    await endSession(ctx.body.data.sessionId, headers);
  });

  it("should return error for browserbase requests without API key", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelName: "gpt-4.1-nano",
          browser: { type: "browserbase" },
        }),
      },
    );

    // Should fail because browserbase requires x-bb-api-key and x-bb-project-id headers
    assertFetchStatus(ctx, HTTP_BAD_REQUEST, "Request should fail with 400");
  });

  // =============================================================================
  // Multi-Region Support Tests
  // =============================================================================

  it("should accept non-default region in browserbaseSessionCreateParams", async () => {
    const url = getBaseUrl();

    // Test with us-east-1 region - server should accept this request
    // Note: Local browser sessions don't actually use the region, but the server
    // should still accept the parameter without returning { available: false }
    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelName: "gpt-4.1-nano",
          browserbaseSessionCreateParams: {
            region: "us-east-1" as BrowserbaseRegion,
          },
          ...localBrowser,
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Request should succeed");
    assertFetchOk(ctx.body !== null, "Should have response body", ctx);
    assertFetchOk(
      isSuccessResponse(ctx.body),
      "Should be a success response",
      ctx,
    );
    // The key assertion: non-default regions should NOT return available: false
    assertFetchOk(
      ctx.body.data.available === true,
      "Session should be available for non-default regions",
      ctx,
    );
    assertFetchOk(!!ctx.body.data.sessionId, "Should have sessionId", ctx);

    await endSession(ctx.body.data.sessionId, headers);
  });

  it("should accept eu-central-1 region in browserbaseSessionCreateParams", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelName: "gpt-4.1-nano",
          browserbaseSessionCreateParams: {
            region: "eu-central-1" as BrowserbaseRegion,
          },
          ...localBrowser,
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Request should succeed");
    assertFetchOk(ctx.body !== null, "Should have response body", ctx);
    assertFetchOk(
      isSuccessResponse(ctx.body),
      "Should be a success response",
      ctx,
    );
    assertFetchOk(
      ctx.body.data.available === true,
      "Session should be available for eu-central-1 region",
      ctx,
    );
    assertFetchOk(!!ctx.body.data.sessionId, "Should have sessionId", ctx);

    await endSession(ctx.body.data.sessionId, headers);
  });

  it("should accept ap-southeast-1 region in browserbaseSessionCreateParams", async () => {
    const url = getBaseUrl();

    const ctx = await fetchWithContext<StartResponse>(
      `${url}/v1/sessions/start`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelName: "gpt-4.1-nano",
          browserbaseSessionCreateParams: {
            region: "ap-southeast-1" as BrowserbaseRegion,
          },
          ...localBrowser,
        }),
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Request should succeed");
    assertFetchOk(ctx.body !== null, "Should have response body", ctx);
    assertFetchOk(
      isSuccessResponse(ctx.body),
      "Should be a success response",
      ctx,
    );
    assertFetchOk(
      ctx.body.data.available === true,
      "Session should be available for ap-southeast-1 region",
      ctx,
    );
    assertFetchOk(!!ctx.body.data.sessionId, "Should have sessionId", ctx);

    await endSession(ctx.body.data.sessionId, headers);
  });
});

describe("POST /v1/sessions/start - keepAlive=false supervision in SEA", () => {
  it("spawns a supervisor and exits it when chrome dies", async () => {
    const handle = await startSeaServer();
    const seaPid = handle.proc.pid;
    assert.ok(seaPid, "SEA server must have a PID");

    const { cdpUrl } = await startKeepAliveFalseLocalSession(handle.baseUrl);
    const supervisor = await waitForValue(
      () => findLocalSupervisorByParentPid(seaPid),
      10_000,
    );

    assert.ok(
      supervisor.chromePid,
      `Expected local supervisor to include --chrome-pid. args=${supervisor.args}`,
    );
    assert.ok(
      isPidAlive(supervisor.pid),
      `Supervisor PID ${supervisor.pid} should be alive`,
    );
    assert.ok(
      isPidAlive(supervisor.chromePid),
      `Chrome PID ${supervisor.chromePid} should be alive`,
    );

    await closeLocalBrowserViaCdp(cdpUrl);

    await waitForPidState(supervisor.chromePid, false, 10_000);
    await waitForPidState(supervisor.pid, false, 10_000);
    assert.ok(
      isPidAlive(seaPid),
      "SEA process should stay alive after chrome dies",
    );
  });

  it("force-killing SEA kills local chrome and exits supervisor within 10s", async () => {
    const handle = await startSeaServer();
    const seaPid = handle.proc.pid;
    assert.ok(seaPid, "SEA server must have a PID");

    await startKeepAliveFalseLocalSession(handle.baseUrl);
    const supervisor = await waitForValue(
      () => findLocalSupervisorByParentPid(seaPid),
      10_000,
    );

    assert.ok(
      supervisor.chromePid,
      `Expected local supervisor to include --chrome-pid. args=${supervisor.args}`,
    );
    assert.ok(
      isPidAlive(supervisor.pid),
      `Supervisor PID ${supervisor.pid} should be alive`,
    );
    assert.ok(
      isPidAlive(supervisor.chromePid),
      `Chrome PID ${supervisor.chromePid} should be alive`,
    );

    await forceKillSeaServer(handle);

    await waitForPidState(supervisor.pid, false, 10_000);
    await waitForPidState(supervisor.chromePid, false, 10_000);
  });

  it("force-killing SEA ends Browserbase session when keepAlive=false", async () => {
    const handle = await startSeaServer({ BB_ENV: "prod" });
    const sessionId = await startKeepAliveFalseBrowserbaseSession(
      handle.baseUrl,
    );

    try {
      await forceKillSeaServer(handle);
      const finalStatus = await waitForBrowserbaseNotRunning(sessionId, 30_000);
      assert.notEqual(
        finalStatus,
        "RUNNING",
        "Browserbase session should not remain RUNNING after SEA kill",
      );
    } finally {
      await requestBrowserbaseReleaseBestEffort(sessionId);
    }
  });
});
