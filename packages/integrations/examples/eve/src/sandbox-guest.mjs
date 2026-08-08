import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import { spawn } from "node:child_process";

const port = Number.parseInt(requiredEnvironment("STAGEHAND_GATEWAY_PORT"), 10);
const token = requiredEnvironment("STAGEHAND_GATEWAY_TOKEN");
const stdio = JSON.parse(requiredEnvironment("STAGEHAND_STDIO_COMMAND_JSON"));
assert.equal(typeof stdio.command, "string");
assert.ok(Array.isArray(stdio.args) && stdio.args.every((value) => typeof value === "string"));

const supergateway = spawn(
  "/tmp/stagehand-eve-gateway/node_modules/.bin/supergateway",
  [
    "--stdio",
    [stdio.command, ...stdio.args].map(shellQuote).join(" "),
    "--outputTransport",
    "streamableHttp",
    "--stateful",
    "--sessionTimeout",
    "600000",
    "--protocolVersion",
    "2025-11-25",
    "--port",
    String(port + 1),
    "--healthEndpoint",
    "/healthz",
    "--logLevel",
    "none",
  ],
  { detached: true, env: process.env, stdio: ["ignore", "ignore", "pipe"] },
);

let stderr = "";
supergateway.stderr.setEncoding("utf8");
supergateway.stderr.on("data", (chunk) => {
  stderr = `${stderr}${chunk}`.slice(-4_000);
});

await waitForHealthyGateway(port + 1);

const expectedAuthorization = Buffer.from(`Bearer ${token}`);
const server = http.createServer((request, response) => {
  if (!isAuthorized(request.headers.authorization)) {
    response.writeHead(401, { "content-type": "text/plain" });
    response.end("Unauthorized\n");
    return;
  }

  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: port + 1,
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

server.listen(port, "0.0.0.0");
await once(server, "listening");

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, async () => {
    await new Promise((resolve) => server.close(resolve));
    stopProcessTree("SIGTERM");
    process.exit(0);
  });
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function isAuthorized(header) {
  if (!header) return false;
  const provided = Buffer.from(header);
  return (
    provided.length === expectedAuthorization.length &&
    timingSafeEqual(provided, expectedAuthorization)
  );
}

function forwardedMcpHeaders(headers) {
  return Object.fromEntries(
    ["accept", "content-length", "content-type", "mcp-protocol-version", "mcp-session-id"]
      .map((name) => [name, headers[name]])
      .filter((entry) => entry[1] !== undefined),
  );
}

async function waitForHealthyGateway(upstreamPort) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (supergateway.exitCode !== null) {
      throw new Error(`supergateway exited before startup: ${stderr}`);
    }
    const response = await fetch(`http://127.0.0.1:${upstreamPort}/healthz`).catch(() => undefined);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`supergateway did not become healthy: ${stderr}`);
}

function stopProcessTree(signal) {
  if (supergateway.pid === undefined) return;
  try {
    process.kill(-supergateway.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
