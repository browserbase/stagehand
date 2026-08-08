import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ALL_TRAFFIC, Sandbox } from "e2b";

const E2B_MCP_PROTOCOL_VERSION = "2025-06-18";
const E2B_STAGEHAND_SERVER = "github/browserbase/stagehand";
const BROWSERBASE_API_HOST = "api.browserbase.com";
const DEFAULT_BROWSERBASE_CDP_HOSTS = ["connect.usw2.browserbase.com"];
const STAGEHAND_GITHUB_URL_PREFIX = "https://github.com/browserbase/stagehand";
const STAGEHAND_OFFLINE_MARKER = "/opt/stagehand-codemode-offline";
const STAGEHAND_OFFLINE_MIRROR = "/opt/stagehand-codemode.git";
const STAGEHAND_PNPM_STORE = "/opt/stagehand-pnpm-store";

export type StagehandSandboxOptions = {
  stagehandRevision: string;
  browserbaseApiKey: string;
  browserbaseProjectId?: string;
  browserbaseCdpHosts?: string[];
  readinessTimeoutMs?: number;
  sandboxTimeoutMs?: number;
};

export type StagehandSandboxConnection = {
  url: URL;
  token: string;
  close: () => Promise<void>;
};

/**
 * Start Stagehand's stdio MCP server inside E2B, wait for it to become ready,
 * then switch the running microVM to a Browserbase-only egress allowlist.
 */
export async function createStagehandSandbox(
  options: StagehandSandboxOptions,
): Promise<StagehandSandboxConnection> {
  assertCommitHash(options.stagehandRevision);
  const cdpHosts = options.browserbaseCdpHosts ?? DEFAULT_BROWSERBASE_CDP_HOSTS;
  if (cdpHosts.length === 0) throw new Error("browserbaseCdpHosts must contain at least one host");
  const allowedHosts = [
    BROWSERBASE_API_HOST,
    ...cdpHosts.map((hostname) => assertHostname(hostname.trim())),
  ];
  let sandbox: Sandbox | undefined;

  try {
    sandbox = await Sandbox.create({
      timeoutMs: options.sandboxTimeoutMs ?? 20 * 60_000,
      envs: {
        STAGEHAND_BROWSER: "browserbase",
        BROWSERBASE_API_KEY: options.browserbaseApiKey,
        ...(options.browserbaseProjectId
          ? { BROWSERBASE_PROJECT_ID: options.browserbaseProjectId }
          : {}),
      },
      mcp: {
        [E2B_STAGEHAND_SERVER]: {
          installCmd: stagehandInstallCommand(options.stagehandRevision),
          runCmd: "node packages/integrations/dist/codemode/stdio-server.mjs",
        },
      },
    });

    const token = await sandbox.getMcpToken();
    if (!token) throw new Error("E2B did not return an MCP gateway token");
    const url = new URL(sandbox.getMcpUrl());

    await waitForOfflineSource(sandbox, options.readinessTimeoutMs ?? 12 * 60_000);
    await waitForStagehand(url, token, options.readinessTimeoutMs ?? 12 * 60_000);

    // E2B requires ALL_TRAFFIC in denyOut when allowOut contains domains.
    // Do this after trusted readiness, but before returning an untrusted session.
    await sandbox.updateNetwork({
      allowOut: [...new Set(allowedHosts)],
      denyOut: [ALL_TRAFFIC],
    });

    let closed = false;
    return {
      url,
      token,
      close: async () => {
        if (closed) return;
        await sandbox.kill();
        closed = true;
      },
    };
  } catch (error) {
    await sandbox?.kill().catch(() => undefined);
    throw error;
  }
}

async function waitForOfflineSource(sandbox: Sandbox, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await sandbox.commands.run(`test -f ${STAGEHAND_OFFLINE_MARKER}`, {
      timeoutMs: 5_000,
    });
    if (result.exitCode === 0) return;
    await delay(2_000);
  }
  throw new Error("Timed out waiting for the trusted Stagehand source build in E2B");
}

async function waitForStagehand(url: URL, token: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    const client = new Client({ name: "stagehand-e2b-readiness", version: "1.0.0" });
    const transport = stagehandTransport(url, token);
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      if (tools.length !== 1 || !tools[0]?.name.endsWith("code_execute")) {
        throw new Error(`Expected one Stagehand code_execute tool, received: ${toolNames(tools)}`);
      }
      await client.close();
      return;
    } catch (error) {
      lastError = error;
      await client.close().catch(() => undefined);
      await delay(5_000);
    }
  }

  throw new Error("Timed out waiting for the Stagehand MCP server in E2B", { cause: lastError });
}

function stagehandInstallCommand(revision: string): string {
  const install = [
    `if [ -f ${STAGEHAND_OFFLINE_MARKER} ]`,
    `then pnpm install --offline --frozen-lockfile --store-dir ${STAGEHAND_PNPM_STORE}`,
    `else corepack prepare pnpm@11.10.0 --activate && pnpm install --frozen-lockfile --store-dir ${STAGEHAND_PNPM_STORE}`,
    "fi",
  ].join("; ");
  const prepareOfflineSource = [
    `if [ -f ${STAGEHAND_OFFLINE_MARKER} ]; then true; else`,
    [
      `rm -rf ${STAGEHAND_OFFLINE_MIRROR}.tmp`,
      `git clone --bare . ${STAGEHAND_OFFLINE_MIRROR}.tmp`,
      `mv ${STAGEHAND_OFFLINE_MIRROR}.tmp ${STAGEHAND_OFFLINE_MIRROR}`,
      "git config --system protocol.file.allow always",
      `git config --system url.file://${STAGEHAND_OFFLINE_MIRROR}.insteadOf ${STAGEHAND_GITHUB_URL_PREFIX}`,
      `chmod -R a-w ${STAGEHAND_OFFLINE_MIRROR}`,
      `touch ${STAGEHAND_OFFLINE_MARKER}`,
    ].join(" && "),
    "fi",
  ].join(" ");

  return [
    `git checkout --detach ${revision}`,
    install,
    "pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations...",
    prepareOfflineSource,
  ].join(" && ");
}

export function stagehandTransport(url: URL, token: string): StreamableHTTPClientTransport {
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  // E2B's current gateway requires this protocol version on gateway requests.
  transport.setProtocolVersion(E2B_MCP_PROTOCOL_VERSION);
  return transport;
}

function assertCommitHash(revision: string): void {
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error("stagehandRevision must be a complete 40-character Git commit hash");
  }
}

function assertHostname(hostname: string): string {
  const parsed = new URL(`https://${hostname}`);
  if (parsed.hostname !== hostname || parsed.port || parsed.pathname !== "/") {
    throw new Error(`Expected a hostname without a scheme, port, or path: ${hostname}`);
  }
  return hostname;
}

function toolNames(tools: Array<{ name: string }>): string {
  return tools.map((tool) => tool.name).join(", ") || "none";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
