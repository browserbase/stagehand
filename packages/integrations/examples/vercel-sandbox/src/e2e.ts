import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { createStagehandSandbox, stagehandTransport } from "./sandbox.js";

const hostMarker = `host-${randomUUID()}`;
const stateMarker = `state-${randomUUID()}`;
const markerPath = `/tmp/stagehand-vercel-proof-${randomUUID()}.json`;
process.env.HOST_ONLY_MARKER = hostMarker;
assert.equal(existsSync(markerPath), false);

const connection = await createStagehandSandbox({
  stagehandRevision: requiredEnvironment("STAGEHAND_REVISION"),
  browserbaseApiKey: requiredEnvironment("BROWSERBASE_API_KEY"),
  browserbaseProjectId: requiredEnvironment("BROWSERBASE_PROJECT_ID"),
});
const client = new Client({ name: "stagehand-vercel-sandbox-e2e", version: "1.0.0" });
let primaryError: unknown;

try {
  const unauthorized = await fetch(connection.url);
  assert.equal(unauthorized.status, 401);
  const authorizedHealth = await fetch(new URL("/healthz", connection.url), {
    headers: { Authorization: `Bearer ${connection.token}` },
  });
  assert.equal(authorizedHealth.status, 200);
  const optionalGetStream = await fetch(connection.url, {
    headers: { Authorization: `Bearer ${connection.token}` },
  });
  assert.equal(optionalGetStream.status, 405);
  assert.equal(optionalGetStream.headers.get("allow"), "POST, DELETE");

  await client.connect(stagehandTransport(connection));
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["code_execute"],
  );

  const first = await client.callTool({
    name: "code_execute",
    arguments: {
      code: `
        const fs = await import("node:fs/promises");
        await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
        await page.evaluate((marker) => {
          document.documentElement.dataset.vercelStagehandState = marker;
        }, ${JSON.stringify(stateMarker)});
        await fs.writeFile(
          ${JSON.stringify(markerPath)},
          JSON.stringify({ marker: ${JSON.stringify(stateMarker)}, pageId: page.pageId }),
        );
        let unrelatedEgressBlocked = false;
        try {
          await fetch("https://example.org", { signal: AbortSignal.timeout(5_000) });
        } catch {
          unrelatedEgressBlocked = true;
        }
        return {
          title: await page.title(),
          pageId: page.pageId,
          domMarker: await page.evaluate(
            () => document.documentElement.dataset.vercelStagehandState,
          ),
          boundary: process.env.STAGEHAND_SANDBOX_BOUNDARY,
          browserbaseCredentialInProcess: process.env.BROWSERBASE_API_KEY,
          hostMarker: process.env.HOST_ONLY_MARKER ?? null,
          bridgeTokenVisible: process.env.BRIDGE_TOKEN ?? null,
          bridgeTokenDigestVisible: process.env.BRIDGE_TOKEN_SHA256 ?? null,
          unrelatedEgressBlocked,
        };
      `,
    },
  });
  const firstValue = successfulValue(first, "first code_execute");

  const second = await client.callTool({
    name: "code_execute",
    arguments: {
      code: `
        const fs = await import("node:fs/promises");
        const persisted = JSON.parse(
          await fs.readFile(${JSON.stringify(markerPath)}, "utf8"),
        );
        const procEntries = (await fs.readdir("/proc")).filter((entry) => /^\\d+$/.test(entry));
        let proxyPid = null;
        let proxyUid = null;
        let rawTokenEnvSeen = false;
        let digestEnvSeen = false;
        for (const pid of procEntries) {
          const cmdline = await fs.readFile(\`/proc/\${pid}/cmdline\`, "utf8").catch(() => "");
          if (cmdline.includes("auth-proxy.mjs")) {
            proxyPid = Number(pid);
            const status = await fs.readFile(\`/proc/\${pid}/status\`, "utf8");
            proxyUid = Number(/^Uid:\\s+(\\d+)/m.exec(status)?.[1]);
          }
          const environ = await fs.readFile(\`/proc/\${pid}/environ\`, "utf8").catch(() => "");
          rawTokenEnvSeen ||= environ
            .split("\\0")
            .some((entry) => entry.startsWith("BRIDGE_TOKEN="));
          digestEnvSeen ||= environ
            .split("\\0")
            .some((entry) => entry.startsWith("BRIDGE_TOKEN_SHA256="));
        }
        if (proxyPid === null) throw new Error("Auth proxy process was not found");
        const proxyEnvironReadable = await fs
          .readFile(\`/proc/\${proxyPid}/environ\`)
          .then(() => true, () => false);
        const proxyMemoryReadable = await fs
          .open(\`/proc/\${proxyPid}/mem\`, "r")
          .then(async (handle) => {
            await handle.close();
            return true;
          }, () => false);
        let proxySignalAllowed = true;
        try {
          process.kill(proxyPid, 0);
        } catch {
          proxySignalAllowed = false;
        }
        const { execFile } = await import("node:child_process");
        const sudoAllowed = await new Promise((resolve) => {
          execFile("sudo", ["-n", "true"], (error) => resolve(error === null));
        });
        return {
          title: await page.title(),
          pageId: page.pageId,
          domMarker: await page.evaluate(
            () => document.documentElement.dataset.vercelStagehandState,
          ),
          fileMarker: persisted.marker,
          filePageId: persisted.pageId,
          hostMarker: process.env.HOST_ONLY_MARKER ?? null,
          rawTokenEnvSeen,
          digestEnvSeen,
          proxyRunsAsDifferentUser: proxyUid !== process.getuid(),
          proxyEnvironReadable,
          proxyMemoryReadable,
          proxySignalAllowed,
          sudoAllowed,
        };
      `,
    },
  });
  const secondValue = successfulValue(second, "second code_execute");

  assert.equal(firstValue.title, "Example Domain");
  assert.equal(secondValue.title, "Example Domain");
  assert.equal(firstValue.pageId, secondValue.pageId);
  assert.equal(firstValue.domMarker, stateMarker);
  assert.equal(secondValue.domMarker, stateMarker);
  assert.equal(secondValue.fileMarker, stateMarker);
  assert.equal(secondValue.filePageId, firstValue.pageId);
  assert.equal(firstValue.boundary, "vercel-firecracker-microvm");
  assert.equal(firstValue.browserbaseCredentialInProcess, "bb_brokered_by_vercel");
  assert.equal(firstValue.hostMarker, null);
  assert.equal(secondValue.hostMarker, null);
  assert.equal(firstValue.bridgeTokenVisible, null);
  assert.equal(firstValue.bridgeTokenDigestVisible, null);
  assert.equal(firstValue.unrelatedEgressBlocked, true);
  assert.equal(secondValue.rawTokenEnvSeen, false);
  assert.equal(secondValue.digestEnvSeen, false);
  assert.equal(secondValue.proxyRunsAsDifferentUser, true);
  assert.equal(secondValue.proxyEnvironReadable, false);
  assert.equal(secondValue.proxyMemoryReadable, false);
  assert.equal(secondValue.proxySignalAllowed, false);
  assert.equal(secondValue.sudoAllowed, false);
  assert.equal(existsSync(markerPath), false, "sandbox marker escaped to the host filesystem");

  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      tools: ["code_execute"],
      calls: 2,
      statePersisted: true,
      unrelatedEgressBlocked: true,
      publicAuth: { unauthorized: 401, authorized: 200 },
      optionalGetStream: 405,
      credentialBrokered: true,
      hostIsolated: true,
      proxyUserIsolated: true,
    })}\n`,
  );
} catch (error) {
  primaryError = error;
}

const cleanupErrors: unknown[] = [];
await client.close().catch((error: unknown) => cleanupErrors.push(error));
await connection.close().catch((error: unknown) => cleanupErrors.push(error));
if (primaryError !== undefined && cleanupErrors.length > 0) {
  throw new AggregateError(
    [primaryError, ...cleanupErrors],
    "Vercel Sandbox E2E failed and cleanup also failed",
  );
}
if (primaryError !== undefined) throw primaryError;
if (cleanupErrors.length > 0) {
  throw new AggregateError(cleanupErrors, "Could not close the MCP client and Vercel Sandbox");
}

function successfulValue(result: Awaited<ReturnType<Client["callTool"]>>, label: string) {
  const structured = result.structuredContent as { ok?: unknown; value?: unknown } | undefined;
  assert.equal(result.isError ?? false, false, `${label} returned an MCP error`);
  assert.equal(structured?.ok, true, `${label} returned a code error`);
  assert.equal(typeof structured?.value, "object", `${label} returned no value`);
  return structured.value as Record<string, unknown>;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
