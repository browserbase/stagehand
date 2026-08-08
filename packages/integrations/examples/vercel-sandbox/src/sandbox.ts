import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

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
const RUNTIME_ROOT = `${SANDBOX_ROOT}/stagehand-runtime`;
const PACKAGE_ROOT = `${SANDBOX_ROOT}/packages`;
const STAGEHAND_PACKAGE_PATH = `${PACKAGE_ROOT}/stagehand.tgz`;
const CODEMODE_PACKAGE_PATH = `${PACKAGE_ROOT}/stagehand-codemode.tgz`;
const RUNTIME_MANIFEST_PATH = `${RUNTIME_ROOT}/package.json`;
const RUNTIME_LOCK_PATH = `${RUNTIME_ROOT}/package-lock.json`;
const GATEWAY_BIN = `${RUNTIME_ROOT}/node_modules/.bin/supergateway`;
const CODEMODE_BIN = `${RUNTIME_ROOT}/node_modules/.bin/stagehand-codemode`;
const AUTH_PROXY_PATH = `${SANDBOX_ROOT}/auth-proxy.mjs`;
const STDIO_WRAPPER_PATH = `${SANDBOX_ROOT}/stdio-wrapper.mjs`;
const HEALTH_REQUEST_TIMEOUT_MS = 5_000;
const SUPERGATEWAY_VERSION = "3.4.3";
const NO_ERROR = Symbol("no error");

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

class StagehandPackageArtifactError extends Error {
  override readonly name = "StagehandPackageArtifactError";

  constructor() {
    super("Stagehand package artifact is invalid.");
  }
}

export type StagehandSandboxOptions = {
  packageArtifactsPath: string;
  browserbaseApiKey: string;
  browserbaseProjectId: string;
  vercelCredentials?: {
    teamId: string;
    projectId: string;
    token: string;
  };
  readinessTimeoutMs?: number;
  sandboxTimeoutMs?: number;
  cleanupTimeoutMs?: number;
  signal?: AbortSignal;
};

export type StagehandSandboxConnection = {
  url: URL;
  token: string;
  close: () => Promise<void>;
};

/**
 * Install exact Stagehand package artifacts inside a Vercel Sandbox, replace
 * setup egress with a Browserbase-only policy, and expose the code-mode stdio
 * server through an authenticated, stateful Streamable HTTP bridge.
 */
export async function createStagehandSandbox(
  options: StagehandSandboxOptions,
): Promise<StagehandSandboxConnection> {
  assertNonEmpty(options.browserbaseApiKey, "browserbaseApiKey");
  assertNonEmpty(options.browserbaseProjectId, "browserbaseProjectId");
  assertNotAborted(options.signal);
  const artifacts = await loadPackageArtifacts(options);

  const cdpHost = await discoverBrowserbaseCdpHost(options);
  assertNotAborted(options.signal);
  let sandbox: Sandbox;
  try {
    const vercelCredentials = options.vercelCredentials;
    sandbox = await Sandbox.create({
      runtime: "node24",
      resources: { vcpus: 4 },
      timeout: options.sandboxTimeoutMs ?? 40 * 60_000,
      ports: [BRIDGE_PORT],
      persistent: false,
      networkPolicy: "allow-all",
      tags: { purpose: "stagehand-codemode-mcp" },
      ...(vercelCredentials
        ? {
            teamId: vercelCredentials.teamId,
            projectId: vercelCredentials.projectId,
            token: vercelCredentials.token,
          }
        : {}),
    });
  } catch {
    throw new StagehandSandboxSetupError();
  }
  const close = sandboxCloser(sandbox, options.cleanupTimeoutMs ?? 30_000);

  try {
    assertNotAborted(options.signal);
    await abortable(installStagehandPackages(sandbox, artifacts), options.signal);
    await abortable(
      sandbox.writeFiles([
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
      ]),
      options.signal,
    );

    const mcpUser = await abortable(sandbox.createUser(MCP_USER), options.signal);
    const proxyUser = await abortable(sandbox.createUser(PROXY_USER), options.signal);
    await abortable(assertUnprivileged(mcpUser, MCP_USER), options.signal);
    await abortable(assertUnprivileged(proxyUser, PROXY_USER), options.signal);
    await abortable(protectRuntimeFiles(sandbox), options.signal);

    // This update is the trust transition: everything above is trusted setup;
    // everything below may eventually execute model-generated JavaScript.
    await abortable(
      sandbox.update({
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
      }),
      options.signal,
    );

    const token = randomBytes(32).toString("base64url");
    const tokenDigest = createHash("sha256").update(token).digest("hex");
    await abortable(startGateway(mcpUser, options.browserbaseProjectId), options.signal);
    await abortable(startAuthProxy(proxyUser, tokenDigest), options.signal);

    const origin = new URL(sandbox.domain(BRIDGE_PORT));
    await waitForHealth(origin, token, options.readinessTimeoutMs ?? 2 * 60_000, options.signal);
    const unauthorized = await abortable(
      fetch(new URL("/healthz", origin), {
        signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
      }).catch(() => undefined),
      options.signal,
    );
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

async function installStagehandPackages(
  sandbox: Sandbox,
  artifacts: PackageArtifacts,
): Promise<void> {
  await run(sandbox, "create package install directories", "mkdir", [
    "-p",
    PACKAGE_ROOT,
    RUNTIME_ROOT,
  ]);
  await sandbox.writeFiles([
    { path: STAGEHAND_PACKAGE_PATH, content: artifacts.stagehand.content, mode: 0o444 },
    { path: CODEMODE_PACKAGE_PATH, content: artifacts.codeMode.content, mode: 0o444 },
    { path: RUNTIME_MANIFEST_PATH, content: artifacts.runtimeManifest.content, mode: 0o444 },
    { path: RUNTIME_LOCK_PATH, content: artifacts.runtimeLock.content, mode: 0o444 },
  ]);
  await verifyArtifact(sandbox, STAGEHAND_PACKAGE_PATH, artifacts.stagehand.sha256);
  await verifyArtifact(sandbox, CODEMODE_PACKAGE_PATH, artifacts.codeMode.sha256);
  await verifyArtifact(sandbox, RUNTIME_MANIFEST_PATH, artifacts.runtimeManifest.sha256);
  await verifyArtifact(sandbox, RUNTIME_LOCK_PATH, artifacts.runtimeLock.sha256);
  await run(
    sandbox,
    "install Stagehand package artifacts",
    "npm",
    ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
    RUNTIME_ROOT,
  );
}

async function protectRuntimeFiles(sandbox: Sandbox): Promise<void> {
  await run(sandbox.asUser("root"), "protect the trusted runtime", "bash", [
    "-lc",
    [
      `test -x ${GATEWAY_BIN}`,
      `test -x ${CODEMODE_BIN}`,
      `chown -R root:root ${RUNTIME_ROOT} ${PACKAGE_ROOT}`,
      `chown root:root ${AUTH_PROXY_PATH} ${STDIO_WRAPPER_PATH}`,
      `chmod -R a-w ${RUNTIME_ROOT} ${PACKAGE_ROOT}`,
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

async function waitForHealth(
  origin: URL,
  token: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  assertNotAborted(signal);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const requestTimeoutMs = Math.max(
      1,
      Math.min(HEALTH_REQUEST_TIMEOUT_MS, deadline - Date.now()),
    );
    const response = await fetch(new URL("/healthz", origin), {
      headers: { Authorization: `Bearer ${token}` },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)])
        : AbortSignal.timeout(requestTimeoutMs),
    }).catch(() => undefined);
    assertNotAborted(signal);
    if (response?.ok) return;
    await delay(Math.min(250, Math.max(0, deadline - Date.now())), signal);
  }
  throw new StagehandSandboxHealthError();
}

async function discoverBrowserbaseCdpHost(options: StagehandSandboxOptions): Promise<string> {
  let sessionId: string | undefined;
  let discoveredHost: string | undefined;
  let primaryError: unknown = NO_ERROR;

  try {
    const response = await fetch(`https://${BROWSERBASE_API_HOST}/v1/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-BB-API-Key": options.browserbaseApiKey,
      },
      body: JSON.stringify({ projectId: options.browserbaseProjectId }),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    });
    assertNotAborted(options.signal);
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

  let cleanupError: unknown = NO_ERROR;
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

  if (primaryError !== NO_ERROR || cleanupError !== NO_ERROR || !discoveredHost) {
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

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} must not be empty`);
}

function assertBrowserbaseCdpHost(hostname: string): string {
  if (!/^connect(?:\.[a-z0-9-]+)?\.browserbase\.com$/.test(hostname)) {
    throw new Error(`Browserbase returned an unexpected CDP hostname: ${hostname}`);
  }
  return hostname;
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, milliseconds));
  assertNotAborted(signal);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(new StagehandSandboxSetupError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new StagehandSandboxSetupError();
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  assertNotAborted(signal);
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new StagehandSandboxSetupError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

type PackageArtifact = { content: Buffer; sha256: string };
type PackageArtifacts = {
  stagehand: PackageArtifact;
  codeMode: PackageArtifact;
  runtimeManifest: PackageArtifact;
  runtimeLock: PackageArtifact;
};

async function loadPackageArtifacts(options: StagehandSandboxOptions): Promise<PackageArtifacts> {
  try {
    if (!path.isAbsolute(options.packageArtifactsPath)) {
      throw new StagehandPackageArtifactError();
    }
    const packageRoot = path.join(options.packageArtifactsPath, "packages");
    const runtimeRoot = path.join(options.packageArtifactsPath, "runtime");
    const runtimeManifest = await loadPackageArtifact(
      path.join(runtimeRoot, "package.json"),
      false,
    );
    assertRuntimeManifest(runtimeManifest.content);
    const runtimeLock = await loadPackageArtifact(
      path.join(runtimeRoot, "package-lock.json"),
      false,
    );
    assertRuntimeLock(runtimeLock.content);
    return {
      stagehand: await loadPackageArtifact(path.join(packageRoot, "stagehand.tgz"), true),
      codeMode: await loadPackageArtifact(path.join(packageRoot, "stagehand-codemode.tgz"), true),
      runtimeManifest,
      runtimeLock,
    };
  } catch {
    throw new StagehandPackageArtifactError();
  }
}

async function loadPackageArtifact(
  artifactPath: string,
  compressed: boolean,
): Promise<PackageArtifact> {
  const content = await readFile(artifactPath);
  if (content.length === 0 || (compressed && (content[0] !== 0x1f || content[1] !== 0x8b))) {
    throw new StagehandPackageArtifactError();
  }
  return {
    content,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function assertRuntimeManifest(content: Buffer): void {
  const manifest = JSON.parse(content.toString()) as { dependencies?: Record<string, unknown> };
  const dependencies = manifest.dependencies;
  if (
    dependencies?.["@browserbasehq/stagehand"] !== "file:../packages/stagehand.tgz" ||
    dependencies["@browserbasehq/stagehand-codemode"] !==
      "file:../packages/stagehand-codemode.tgz" ||
    dependencies.supergateway !== SUPERGATEWAY_VERSION ||
    Object.keys(dependencies).length !== 3
  ) {
    throw new StagehandPackageArtifactError();
  }
}

function assertRuntimeLock(content: Buffer): void {
  const lock = JSON.parse(content.toString()) as {
    lockfileVersion?: unknown;
    packages?: Record<string, { dependencies?: Record<string, unknown>; resolved?: unknown }>;
  };
  const dependencies = lock.packages?.[""]?.dependencies;
  if (lock.lockfileVersion !== 3 || !dependencies) {
    throw new StagehandPackageArtifactError();
  }
  for (const entry of Object.values(lock.packages ?? {})) {
    const resolved = entry.resolved;
    if (
      resolved !== undefined &&
      (typeof resolved !== "string" ||
        (!resolved.startsWith("file:") && !resolved.startsWith("https://registry.npmjs.org/")))
    ) {
      throw new StagehandPackageArtifactError();
    }
  }
  assertRuntimeManifest(Buffer.from(JSON.stringify({ dependencies })));
}

async function verifyArtifact(
  sandbox: Sandbox,
  artifactPath: string,
  expectedSha256: string,
): Promise<void> {
  const actual = await run(sandbox, "verify uploaded package artifact", "sha256sum", [
    artifactPath,
  ]);
  if (actual.split(/\s+/, 1)[0] !== expectedSha256) {
    throw new StagehandPackageArtifactError();
  }
}
