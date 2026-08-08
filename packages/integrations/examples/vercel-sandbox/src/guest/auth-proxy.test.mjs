import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import http from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TOKEN = "auth-proxy-contract-token";
const AUTHORIZATION = `Bearer ${TOKEN}`;
const REQUEST_TIMEOUT_MS = 2_000;
const PROXY_PATH = fileURLToPath(new URL("./auth-proxy.mjs", import.meta.url));

for (const scenario of [
  {
    name: "a non-decimal bridge port",
    environment: { BRIDGE_PORT: "8000.5", PROXY_PORT: "0" },
    expectedError: /BRIDGE_PORT must be a valid port/,
  },
  {
    name: "an out-of-range proxy port",
    environment: { BRIDGE_PORT: "8000", PROXY_PORT: "65536" },
    expectedError: /PROXY_PORT must be a valid port/,
  },
  {
    name: "an ephemeral bridge port",
    environment: { BRIDGE_PORT: "0", PROXY_PORT: "0" },
    expectedError: /BRIDGE_PORT must be a valid port/,
  },
]) {
  test(`auth proxy rejects ${scenario.name}`, async () => {
    const result = await runSparseProxy(scenario.environment);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, scenario.expectedError);
  });
}

test("auth proxy restricts ingress and closes abandoned upstream requests", async (context) => {
  let upstreamRequests = 0;
  let releaseStalledResponse;
  const stalledResponseClosed = new Promise((resolve) => {
    releaseStalledResponse = resolve;
  });
  const bridge = http.createServer((request, response) => {
    upstreamRequests += 1;
    if (request.url === "/mcp?stall=1") {
      response.once("close", releaseStalledResponse);
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ path: request.url, method: request.method }));
  });
  const bridgePort = await listen(bridge, 0);
  context.after(() => closeServer(bridge));

  const proxy = spawn(process.execPath, [PROXY_PATH], {
    env: {
      ...process.env,
      BRIDGE_TOKEN_SHA256: createHash("sha256").update(TOKEN).digest("hex"),
      BRIDGE_PORT: String(bridgePort),
      PROXY_PORT: "0",
    },
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  context.after(() => stopProcess(proxy));
  const proxyPort = await waitForProxyPort(proxy);
  const proxyOrigin = `http://127.0.0.1:${proxyPort}`;

  assert.equal((await fetchWithTimeout(`${proxyOrigin}/healthz`)).status, 401);
  assert.equal(
    (
      await fetchWithTimeout(`${proxyOrigin}/healthz`, {
        headers: { Authorization: `bEaReR ${TOKEN}` },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetchWithTimeout(`${proxyOrigin}/private`, {
        headers: { Authorization: AUTHORIZATION },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await fetchWithTimeout(`${proxyOrigin}/mcp`, {
        method: "PUT",
        headers: { Authorization: AUTHORIZATION },
      })
    ).status,
    405,
  );
  assert.equal(
    (
      await fetchWithTimeout(`${proxyOrigin}/mcp`, {
        headers: { Authorization: AUTHORIZATION },
      })
    ).status,
    405,
  );
  const forwarded = await fetchWithTimeout(`${proxyOrigin}/mcp`, {
    method: "POST",
    headers: { Authorization: AUTHORIZATION, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(forwarded.status, 200);
  assert.deepEqual(await forwarded.json(), { path: "/mcp", method: "POST" });
  const deleted = await fetchWithTimeout(`${proxyOrigin}/mcp`, {
    method: "DELETE",
    headers: { Authorization: AUTHORIZATION },
  });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { path: "/mcp", method: "DELETE" });
  assert.equal(upstreamRequests, 3, "rejected routes must not reach the bridge");

  const abandoned = http.request(`${proxyOrigin}/mcp?stall=1`, {
    method: "POST",
    headers: { Authorization: AUTHORIZATION, "content-type": "application/json" },
  });
  abandoned.on("error", () => undefined);
  abandoned.end("{}");
  await waitFor(() => upstreamRequests === 4);
  abandoned.destroy();
  await withTimeout(stalledResponseClosed, "proxy did not close the abandoned upstream request");
});

function runSparseProxy(environment) {
  return withTimeout(
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [PROXY_PATH], {
        env: {
          BRIDGE_TOKEN_SHA256: createHash("sha256").update(TOKEN).digest("hex"),
          ...environment,
        },
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("close", (code, signal) => {
        resolve({ code, signal, stderr });
      });
    }),
    "Timed out waiting for invalid auth-proxy configuration to fail",
  );
}

function waitForProxyPort(child) {
  return withTimeout(
    new Promise((resolve, reject) => {
      const onMessage = (message) => {
        if (!message || typeof message !== "object" || typeof message.port !== "number") return;
        cleanup();
        resolve(message.port);
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const onExit = (code, signal) => {
        cleanup();
        reject(new Error(`auth proxy exited before listening (${signal ?? code ?? "unknown"})`));
      };
      const cleanup = () => {
        child.off("message", onMessage);
        child.off("error", onError);
        child.off("exit", onExit);
      };
      child.on("message", onMessage);
      child.once("error", onError);
      child.once("exit", onExit);
    }),
    "Timed out waiting for auth proxy to listen",
  );
}

async function waitFor(predicate) {
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for auth-proxy contract state");
}

async function fetchWithTimeout(url, init = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

async function withTimeout(promise, message) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), REQUEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        reject(new Error("Test bridge did not bind a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

async function closeServer(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}
