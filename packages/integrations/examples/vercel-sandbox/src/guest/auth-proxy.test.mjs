import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import http from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TOKEN = "auth-proxy-contract-token";
const AUTHORIZATION = `Bearer ${TOKEN}`;
const PROXY_ORIGIN = "http://127.0.0.1:3000";
const REQUEST_TIMEOUT_MS = 2_000;

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
  await listen(bridge, 8000);
  context.after(() => closeServer(bridge));

  const proxy = spawn(
    process.execPath,
    [fileURLToPath(new URL("./auth-proxy.mjs", import.meta.url))],
    {
      env: {
        ...process.env,
        BRIDGE_TOKEN_SHA256: createHash("sha256").update(TOKEN).digest("hex"),
      },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  context.after(() => stopProcess(proxy));
  await waitForProxy();

  assert.equal((await fetchWithTimeout(`${PROXY_ORIGIN}/healthz`)).status, 401);
  assert.equal(
    (
      await fetchWithTimeout(`${PROXY_ORIGIN}/healthz`, {
        headers: { Authorization: `bEaReR ${TOKEN}` },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetchWithTimeout(`${PROXY_ORIGIN}/private`, {
        headers: { Authorization: AUTHORIZATION },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await fetchWithTimeout(`${PROXY_ORIGIN}/mcp`, {
        method: "PUT",
        headers: { Authorization: AUTHORIZATION },
      })
    ).status,
    405,
  );
  assert.equal(
    (
      await fetchWithTimeout(`${PROXY_ORIGIN}/mcp`, {
        headers: { Authorization: AUTHORIZATION },
      })
    ).status,
    405,
  );
  const forwarded = await fetchWithTimeout(`${PROXY_ORIGIN}/mcp`, {
    method: "POST",
    headers: { Authorization: AUTHORIZATION, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(forwarded.status, 200);
  assert.deepEqual(await forwarded.json(), { path: "/mcp", method: "POST" });
  const deleted = await fetchWithTimeout(`${PROXY_ORIGIN}/mcp`, {
    method: "DELETE",
    headers: { Authorization: AUTHORIZATION },
  });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { path: "/mcp", method: "DELETE" });
  assert.equal(upstreamRequests, 3, "rejected routes must not reach the bridge");

  const abandoned = http.request(`${PROXY_ORIGIN}/mcp?stall=1`, {
    method: "POST",
    headers: { Authorization: AUTHORIZATION, "content-type": "application/json" },
  });
  abandoned.on("error", () => undefined);
  abandoned.end("{}");
  await waitFor(() => upstreamRequests === 4);
  abandoned.destroy();
  await withTimeout(stalledResponseClosed, "proxy did not close the abandoned upstream request");
});

async function waitForProxy() {
  await waitFor(async () => {
    const response = await fetchWithTimeout(`${PROXY_ORIGIN}/healthz`).catch(() => undefined);
    return response?.status === 401;
  });
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

function withTimeout(promise, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), REQUEST_TIMEOUT_MS)),
  ]);
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
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
