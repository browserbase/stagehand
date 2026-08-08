import assert from "node:assert/strict";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";

const DEFAULT_STDIO_SERVER_PATH = fileURLToPath(
  new URL("../../../dist/codemode/stdio-server.mjs", import.meta.url),
);
const SUPERGATEWAY_PATH = fileURLToPath(
  new URL("../node_modules/.bin/supergateway", import.meta.url),
);
const MCP_PROTOCOL_VERSION = "2025-11-25";

export type StagehandGateway = {
  url: string;
  token: string;
  close: () => Promise<void>;
};

export async function startLocalTestGateway(options?: {
  stdioServerPath?: string;
}): Promise<StagehandGateway> {
  const token = randomBytes(32).toString("hex");
  const upstreamPort = await reservePort();
  const stdioServerPath = options?.stdioServerPath ?? DEFAULT_STDIO_SERVER_PATH;
  const stdioCommand = `${shellQuote(process.execPath)} ${shellQuote(stdioServerPath)}`;
  const gateway = spawn(
    SUPERGATEWAY_PATH,
    [
      "--stdio",
      stdioCommand,
      "--outputTransport",
      "streamableHttp",
      "--stateful",
      "--sessionTimeout",
      "600000",
      "--protocolVersion",
      MCP_PROTOCOL_VERSION,
      "--port",
      String(upstreamPort),
      "--healthEndpoint",
      "/healthz",
      "--logLevel",
      "none",
    ],
    {
      detached: process.platform !== "win32",
      // This helper is local-test-only. Production uses the allowlisted guest
      // environment in sandbox.ts and destroys the complete sandbox afterward.
      env: localTestEnvironment(process.env),
      stdio: ["ignore", "ignore", "pipe"],
    },
  );

  let stderr = "";
  gateway.stderr?.setEncoding("utf8");
  gateway.stderr?.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-4_000);
  });

  try {
    await waitForHealthyGateway(upstreamPort, gateway, () => stderr);
    const proxy = await startAuthenticatedProxy({ token, upstreamPort });
    return {
      url: `http://127.0.0.1:${proxy.port}/mcp`,
      token,
      async close() {
        await proxy.close();
        await stopProcessTree(gateway);
      },
    };
  } catch (error) {
    await stopProcessTree(gateway);
    throw error;
  }
}

async function startAuthenticatedProxy(options: {
  token: string;
  upstreamPort: number;
}): Promise<{ port: number; close: () => Promise<void> }> {
  const expectedAuthorization = Buffer.from(`Bearer ${options.token}`);
  const server = http.createServer((request, response) => {
    if (!isAuthorized(request.headers.authorization, expectedAuthorization)) {
      response.writeHead(401, { "content-type": "text/plain" });
      response.end("Unauthorized\n");
      return;
    }

    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: options.upstreamPort,
        method: request.method,
        path: request.url,
        headers: forwardedMcpHeaders(request.headers),
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      },
    );
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end("Upstream unavailable\n");
    });
    request.pipe(upstream);
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    port: address.port,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function isAuthorized(header: string | undefined, expected: Buffer): boolean {
  if (!header) return false;
  const provided = Buffer.from(header);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function forwardedMcpHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  return Object.fromEntries(
    ["accept", "content-length", "content-type", "mcp-protocol-version", "mcp-session-id"]
      .map((name) => [name, headers[name]] as const)
      .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined),
  );
}

async function reservePort(): Promise<number> {
  const server = http.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitForHealthyGateway(
  port: number,
  process: ChildProcess,
  readStderr: () => string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (process.exitCode !== null) {
      throw new Error(`supergateway exited before startup: ${readStderr()}`);
    }
    const response = await fetch(`http://127.0.0.1:${port}/healthz`).catch(() => undefined);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`supergateway did not become healthy: ${readStderr()}`);
}

async function stopProcessTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return;
  signalProcessTree(child, "SIGTERM");
  const stopped = await Promise.race([
    once(child, "exit").then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 3_000)),
  ]);
  if (stopped) return;
  signalProcessTree(child, "SIGKILL");
  await once(child, "exit").catch(() => undefined);
}

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform === "win32" || child.pid === undefined) child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function localTestEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
