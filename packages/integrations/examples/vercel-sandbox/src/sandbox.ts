import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Sandbox, type SandboxUser } from "@vercel/sandbox";

const BROWSERBASE_API_HOST = "api.browserbase.com";
const BROWSERBASE_API_KEY_PLACEHOLDER = "bb_brokered_by_vercel";
const BRIDGE_PORT = 3000;
const GATEWAY_PORT = 8000;
const MCP_PROTOCOL_VERSION = "2025-11-25";
const MCP_USER = "stagehand-mcp";
const PROXY_USER = "stagehand-proxy";
const SANDBOX_ROOT = "/vercel/sandbox";
const STAGEHAND_ROOT = `${SANDBOX_ROOT}/stagehand`;
const EXAMPLE_ROOT = `${STAGEHAND_ROOT}/packages/integrations/examples/vercel-sandbox`;
const GATEWAY_BIN = `${EXAMPLE_ROOT}/node_modules/.bin/supergateway`;
const AUTH_PROXY_PATH = `${SANDBOX_ROOT}/auth-proxy.mjs`;
const STDIO_WRAPPER_PATH = `${SANDBOX_ROOT}/stdio-wrapper.mjs`;
const HEALTH_REQUEST_TIMEOUT_MS = 5_000;

class StagehandSandboxSetupError extends Error {
  override readonly name = "StagehandSandboxSetupError";

  constructor() {
    super("Stagehand sandbox setup failed.");
  }
}

class StagehandSandboxHealthError extends Error {
  override readonly name = "StagehandSandboxHealthError";

  constructor() {
    super("Stagehand sandbox health verification failed.");
  }
}

class StagehandCdpDiscoveryError extends Error {
  override readonly name = "StagehandCdpDiscoveryError";

  constructor() {
    super("Browserbase CDP host discovery failed.");
  }
}

class StagehandSandboxDisposeError extends Error {
  override readonly name = "StagehandSandboxDisposeError";

  constructor() {
    super("Could not stop and delete the Stagehand sandbox.");
  }
}

class StagehandSandboxCommandError extends Error {
  override readonly name = "StagehandSandboxCommandError";

  constructor(label: string, exitCode: number) {
    super(`${label} failed inside the trusted sandbox (exit ${exitCode}).`);
  }
}

export type StagehandSandboxOptions = {
  stagehandRevision: string;
  browserbaseApiKey: string;
  browserbaseProjectId: string;
  readinessTimeoutMs?: number;
  sandboxTimeoutMs?: number;
  cleanupTimeoutMs?: number;
};

export type StagehandSandboxConnection = {
  url: URL;
  token: string;
  close: () => Promise<void>;
};

/**
 * Build Stagehand from an exact revision inside a Vercel Sandbox, replace the
 * setup network with Browserbase-only egress, and expose its stdio MCP server
 * through an authenticated, stateful Streamable HTTP bridge.
 */
export async function createStagehandSandbox(
  options: StagehandSandboxOptions,
): Promise<StagehandSandboxConnection> {
  assertCommitHash(options.stagehandRevision);
  assertNonEmpty(options.browserbaseApiKey, "browserbaseApiKey");
  assertNonEmpty(options.browserbaseProjectId, "browserbaseProjectId");

  const cdpHost = await discoverBrowserbaseCdpHost(options);
  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.create({
      runtime: "node24",
      resources: { vcpus: 4 },
      timeout: options.sandboxTimeoutMs ?? 40 * 60_000,
      ports: [BRIDGE_PORT],
      persistent: false,
      networkPolicy: "allow-all",
      tags: { purpose: "stagehand-codemode-mcp" },
    });
  } catch {
    throw new StagehandSandboxSetupError();
  }
  const close = sandboxCloser(sandbox, options.cleanupTimeoutMs ?? 30_000);

  try {
    await installStagehand(sandbox, options.stagehandRevision);
    await sandbox.writeFiles([
      {
        path: AUTH_PROXY_PATH,
        content: await readFile(new URL("./guest/auth-proxy.mjs", import.meta.url)),
        mode: 0o555,
      },
      {
        path: STDIO_WRAPPER_PATH,
        content: await readFile(new URL("./guest/stdio-wrapper.mjs", import.meta.url)),
        mode: 0o555,
      },
    ]);

    const mcpUser = await sandbox.createUser(MCP_USER);
    const proxyUser = await sandbox.createUser(PROXY_USER);
    await assertUnprivileged(mcpUser, MCP_USER);
    await assertUnprivileged(proxyUser, PROXY_USER);
    await protectRuntimeFiles(sandbox);

    // This update is the trust transition: everything above is trusted setup;
    // everything below may eventually execute model-generated JavaScript.
    await sandbox.update({
      networkPolicy: {
        allow: {
          [BROWSERBASE_API_HOST]: [
            {
              transform: [{ headers: { "X-BB-API-Key": options.browserbaseApiKey } }],
            },
          ],
          [cdpHost]: [],
        },
      },
    });

    const token = randomBytes(32).toString("base64url");
    const tokenDigest = createHash("sha256").update(token).digest("hex");
    await startGateway(mcpUser, options.browserbaseProjectId);
    await startAuthProxy(proxyUser, tokenDigest);

    const origin = new URL(sandbox.domain(BRIDGE_PORT));
    await waitForHealth(origin, token, options.readinessTimeoutMs ?? 2 * 60_000);
    const unauthorized = await fetch(new URL("/healthz", origin), {
      signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
    }).catch(() => undefined);
    if (unauthorized?.status !== 401) {
      throw new StagehandSandboxHealthError();
    }

    return {
      url: new URL("/mcp", origin),
      token,
      close,
    };
  } catch (error) {
    try {
      await close();
    } catch {
      throw new StagehandSandboxSetupError();
    }
    if (
      error instanceof StagehandSandboxSetupError ||
      error instanceof StagehandSandboxHealthError ||
      error instanceof StagehandSandboxCommandError
    ) {
      throw error;
    }
    throw new StagehandSandboxSetupError();
  }
}

export function stagehandTransport(
  connection: Pick<StagehandSandboxConnection, "url" | "token">,
): StreamableHTTPClientTransport {
  const transport = new StreamableHTTPClientTransport(connection.url, {
    requestInit: {
      headers: { Authorization: `Bearer ${connection.token}` },
    },
  });
  transport.setProtocolVersion(MCP_PROTOCOL_VERSION);
  return transport;
}

async function installStagehand(sandbox: Sandbox, revision: string): Promise<void> {
  await run(sandbox, "initialize Stagehand checkout", "git", ["init", STAGEHAND_ROOT]);
  await run(sandbox, "add Stagehand remote", "git", [
    "-C",
    STAGEHAND_ROOT,
    "remote",
    "add",
    "origin",
    "https://github.com/browserbase/stagehand.git",
  ]);
  await run(sandbox, "fetch Stagehand revision", "git", [
    "-C",
    STAGEHAND_ROOT,
    "fetch",
    "--depth=1",
    "origin",
    revision,
  ]);
  await run(sandbox, "checkout Stagehand revision", "git", [
    "-C",
    STAGEHAND_ROOT,
    "checkout",
    "--detach",
    "FETCH_HEAD",
  ]);
  const resolved = await run(sandbox, "resolve Stagehand revision", "git", [
    "-C",
    STAGEHAND_ROOT,
    "rev-parse",
    "HEAD",
  ]);
  if (resolved.trim() !== revision) {
    throw new Error(`Stagehand checkout resolved to an unexpected revision: ${resolved.trim()}`);
  }

  await run(sandbox, "activate pnpm", "corepack", ["prepare", "pnpm@11.10.0", "--activate"]);
  await run(
    sandbox,
    "install Stagehand dependencies",
    "pnpm",
    ["install", "--frozen-lockfile"],
    STAGEHAND_ROOT,
  );
  await run(
    sandbox,
    "build Stagehand extension",
    "pnpm",
    ["--filter", "@browserbasehq/stagehand-extension", "build"],
    STAGEHAND_ROOT,
  );
  await run(
    sandbox,
    "build Stagehand integrations",
    "pnpm",
    ["--filter", "@browserbasehq/stagehand-integrations...", "build"],
    STAGEHAND_ROOT,
  );
}

async function protectRuntimeFiles(sandbox: Sandbox): Promise<void> {
  await run(sandbox.asUser("root"), "protect the trusted runtime", "bash", [
    "-lc",
    [
      `test -x ${GATEWAY_BIN}`,
      `chown -R root:root ${STAGEHAND_ROOT}`,
      `chown root:root ${AUTH_PROXY_PATH} ${STDIO_WRAPPER_PATH}`,
      `chmod -R a-w ${STAGEHAND_ROOT}`,
      `chmod 0555 ${AUTH_PROXY_PATH} ${STDIO_WRAPPER_PATH}`,
    ].join(" && "),
  ]);
}

async function startGateway(user: SandboxUser, browserbaseProjectId: string): Promise<void> {
  await user.runCommand({
    cmd: GATEWAY_BIN,
    args: [
      "--stdio",
      `node ${STDIO_WRAPPER_PATH}`,
      "--outputTransport",
      "streamableHttp",
      "--stateful",
      "--sessionTimeout",
      "600000",
      "--protocolVersion",
      MCP_PROTOCOL_VERSION,
      "--port",
      String(GATEWAY_PORT),
      "--healthEndpoint",
      "/healthz",
      "--logLevel",
      "none",
    ],
    detached: true,
    env: {
      BROWSERBASE_API_KEY: BROWSERBASE_API_KEY_PLACEHOLDER,
      BROWSERBASE_PROJECT_ID: browserbaseProjectId,
      STAGEHAND_BROWSER: "browserbase",
      STAGEHAND_SANDBOX_BOUNDARY: "vercel-firecracker-microvm",
    },
  });
}

async function startAuthProxy(user: SandboxUser, tokenDigest: string): Promise<void> {
  await user.runCommand({
    cmd: "node",
    args: [AUTH_PROXY_PATH],
    detached: true,
    env: { BRIDGE_TOKEN_SHA256: tokenDigest },
  });
}

async function assertUnprivileged(user: SandboxUser, name: string): Promise<void> {
  const sudoProbe = await user.runCommand({ cmd: "sudo", args: ["-n", "true"] });
  if (sudoProbe.exitCode === 0) throw new Error(`${name} unexpectedly has sudo access`);
}

async function waitForHealth(origin: URL, token: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const requestTimeoutMs = Math.max(
      1,
      Math.min(HEALTH_REQUEST_TIMEOUT_MS, deadline - Date.now()),
    );
    const response = await fetch(new URL("/healthz", origin), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(requestTimeoutMs),
    }).catch(() => undefined);
    if (response?.ok) return;
    await delay(Math.min(250, Math.max(0, deadline - Date.now())));
  }
  throw new StagehandSandboxHealthError();
}

async function discoverBrowserbaseCdpHost(options: StagehandSandboxOptions): Promise<string> {
  let sessionId: string | undefined;
  let discoveredHost: string | undefined;
  let primaryError: unknown;

  try {
    const response = await fetch(`https://${BROWSERBASE_API_HOST}/v1/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-BB-API-Key": options.browserbaseApiKey,
      },
      body: JSON.stringify({ projectId: options.browserbaseProjectId }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`Browserbase CDP host discovery returned ${response.status}`);
    }
    const session = (await response.json()) as { id?: unknown; connectUrl?: unknown };
    if (typeof session.id === "string") sessionId = session.id;
    if (!sessionId || typeof session.connectUrl !== "string") {
      throw new Error("Browserbase CDP host discovery returned an invalid session");
    }
    discoveredHost = assertBrowserbaseCdpHost(new URL(session.connectUrl).hostname);
  } catch (error) {
    primaryError = error;
  }

  let cleanupError: unknown;
  if (sessionId) {
    try {
      const response = await fetch(
        `https://${BROWSERBASE_API_HOST}/v1/sessions/${encodeURIComponent(sessionId)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-BB-API-Key": options.browserbaseApiKey,
          },
          body: JSON.stringify({ status: "REQUEST_RELEASE" }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok)
        throw new Error(`Browserbase discovery-session release returned ${response.status}`);
    } catch (error) {
      cleanupError = error;
    }
  }

  if (primaryError !== undefined || cleanupError !== undefined || !discoveredHost) {
    throw new StagehandCdpDiscoveryError();
  }
  return discoveredHost;
}

function sandboxCloser(sandbox: Sandbox, timeoutMs: number): () => Promise<void> {
  let closePromise: Promise<void> | undefined;
  return () => {
    closePromise ??= disposeSandbox(sandbox, timeoutMs);
    return closePromise;
  };
}

async function disposeSandbox(sandbox: Sandbox, timeoutMs: number): Promise<void> {
  const errors: unknown[] = [];
  await withTimeout(sandbox.stop(), timeoutMs, "Vercel Sandbox stop").catch((error: unknown) => {
    errors.push(error);
  });
  await withTimeout(sandbox.delete(), timeoutMs, "Vercel Sandbox delete").catch(
    (error: unknown) => {
      errors.push(error);
    },
  );
  if (errors.length > 0) throw new StagehandSandboxDisposeError();
}

async function run(
  target: Pick<Sandbox, "runCommand"> | SandboxUser,
  label: string,
  cmd: string,
  args: string[],
  cwd?: string,
): Promise<string> {
  const result = await target.runCommand({ cmd, args, cwd });
  const [stdout, stderr] = await Promise.all([result.stdout(), result.stderr()]);
  if (result.exitCode !== 0) {
    void stderr;
    throw new StagehandSandboxCommandError(label, result.exitCode);
  }
  return stdout;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timeout);
  }
}

function assertCommitHash(revision: string): void {
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error("stagehandRevision must be a complete 40-character Git commit hash");
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} must not be empty`);
}

function assertBrowserbaseCdpHost(hostname: string): string {
  if (!/^connect(?:\.[a-z0-9-]+)?\.browserbase\.com$/.test(hostname)) {
    throw new Error(`Browserbase returned an unexpected CDP hostname: ${hostname}`);
  }
  return hostname;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
