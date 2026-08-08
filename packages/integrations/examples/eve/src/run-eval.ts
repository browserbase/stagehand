import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { startLocalTestGateway } from "./gateway.js";

const EVE_BINARY = fileURLToPath(new URL("../node_modules/.bin/eve", import.meta.url));
const EXAMPLE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const BUILT_SERVER = fileURLToPath(new URL("../.output/server/index.mjs", import.meta.url));

export async function runEveStagehandEval(deterministic: boolean): Promise<void> {
  const gateway = await startLocalTestGateway();
  try {
    const unauthorized = await fetch(gateway.url);
    assert.equal(unauthorized.status, 401, "the gateway must reject requests without its token");

    const environment = {
      ...process.env,
      ...(deterministic ? { EVE_STAGEHAND_DETERMINISTIC: "1" } : {}),
      STAGEHAND_MCP_URL: gateway.url,
      STAGEHAND_MCP_TOKEN: gateway.token,
    };
    await runChild(EVE_BINARY, ["build"], environment);

    const port = await reservePort();
    const serverRoot = await mkdtemp(join(tmpdir(), "eve-stagehand-"));
    const server = spawn(process.execPath, [BUILT_SERVER], {
      cwd: serverRoot,
      env: { ...environment, HOST: "127.0.0.1", PORT: String(port) },
      stdio: "inherit",
    });
    try {
      await waitForAgent(port, server);
      await runChild(
        EVE_BINARY,
        ["eval", "stagehand", "--skip-report", "--url", `http://127.0.0.1:${port}`],
        environment,
      );
    } finally {
      await stopChild(server);
      await rm(serverRoot, { recursive: true, force: true });
    }
  } finally {
    await gateway.close();
  }
}

async function runChild(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const child = spawn(command, args, {
    cwd: EXAMPLE_ROOT,
    env: environment,
    stdio: "inherit",
  });
  const [exitCode] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
  if (exitCode !== 0) throw new Error(`${command} exited with code ${String(exitCode)}`);
}

async function reservePort(): Promise<number> {
  const server = http.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitForAgent(port: number, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error("the built Eve server exited before startup");
    const response = await fetch(`http://127.0.0.1:${port}/eve/v1/health`).catch(() => undefined);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("the built Eve server did not become healthy");
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    once(child, "exit").then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 3_000)),
  ]);
  if (!stopped) child.kill("SIGKILL");
}
