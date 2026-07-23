import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromePath, launch, Launcher, type LaunchedChrome } from "chrome-launcher";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { StagehandMethods } from "../../schema-registry.js";
import type { StagehandRpcNotification } from "../../types.js";
import { CDPClient } from "../../../sdk-ts/src/cdpClient.js";
import { connectRPCClient, RPCClient } from "../../../sdk-ts/src/rpcClient.js";

const DEBUGGING_PORT = 9222;
const COMMAND_TIMEOUT_MS = 15_000;
const extensionDir = path.resolve(fileURLToPath(new URL("../../../server/dist", import.meta.url)));

type RuntimeMarker = {
  protocolVersion: number;
  serverInfo: {
    name: string;
    version: string;
  };
  state: string;
  connected: boolean;
  timings: {
    resolveMs?: number;
    connectAndBootstrapMs?: number;
    totalMs?: number;
  };
};

describe("resident Stagehand service worker", () => {
  let chrome: LaunchedChrome | undefined;
  let cdp: CDPClient | undefined;
  let rpcClient: RPCClient | undefined;
  let marker: RuntimeMarker | undefined;

  beforeAll(async () => {
    const extensionId = unpackedExtensionId(extensionDir);
    chrome = await launchChrome(extensionId);
    rpcClient = await connectRPCClient(
      {
        cdpUrl: `http://127.0.0.1:${DEBUGGING_PORT}`,
        extensionDir,
        serviceWorkerUrlIncludes: "service-worker.js",
        discoveryTimeoutMs: COMMAND_TIMEOUT_MS,
        commandTimeoutMs: COMMAND_TIMEOUT_MS,
        cdpConnectTimeoutMs: COMMAND_TIMEOUT_MS,
      },
      { autoAttach: true },
    );
    cdp = rpcClient.cdp as CDPClient;
    await expect(cdp.sendCommand("Extensions.getExtensions")).resolves.toMatchObject({
      extensions: [expect.objectContaining({ id: extensionId, enabled: true })],
    });
    if (!cdp.sessionId) throw new Error("Stagehand service worker was not attached");
    marker = await waitForResidentReady(cdp, cdp.sessionId);
  }, 45_000);

  afterAll(() => {
    rpcClient?.close();
    chrome?.kill();
  });

  it("becomes ready and serves browser RPCs without runtime.configure", async () => {
    expect(marker).toMatchObject({
      protocolVersion: 4,
      serverInfo: {
        name: "stagehand",
        version: "4.0.0",
      },
      state: "ready",
      connected: true,
      timings: {
        resolveMs: expect.any(Number),
        connectAndBootstrapMs: expect.any(Number),
        totalMs: expect.any(Number),
      },
    });

    const activeRpcClient = requireRpcClient(rpcClient);
    const notifications: StagehandRpcNotification[] = [];
    const stopListening = activeRpcClient.onNotification((notification) => {
      notifications.push(notification);
    });
    expect(
      notifications.some(
        (notification) =>
          notification.method === "stagehand.log" &&
          notification.params.message === "[stagehand] runtime.configure",
      ),
    ).toBe(false);
    stopListening();

    await expect(activeRpcClient.send(StagehandMethods.stagehandInit, {})).resolves.toMatchObject({
      initialized: true,
    });
    await expect(
      activeRpcClient.send(StagehandMethods.browserGetVersion, {}),
    ).resolves.toMatchObject({
      protocolVersion: "1.3",
      product: expect.stringContaining("Chrome/"),
    });
    const pages = await activeRpcClient.send(StagehandMethods.contextPages, {});
    expect(pages.length).toBeGreaterThanOrEqual(1);
    await expect(
      activeRpcClient.send(StagehandMethods.pageUrl, { pageId: pages[0]!.pageId }),
    ).resolves.toMatchObject({ url: expect.any(String) });
  });
});

async function launchChrome(extensionId: string): Promise<LaunchedChrome> {
  const chromePath = getChromePath();
  if (!chromePath) throw new Error("No local Chrome or Chromium installation was found");

  return await launch({
    chromePath,
    port: DEBUGGING_PORT,
    startingUrl: "about:blank",
    ignoreDefaultFlags: true,
    chromeFlags: [
      ...Launcher.defaultFlags().filter((flag) => flag !== "--disable-extensions"),
      `--load-extension=${extensionDir}`,
      "--enable-unsafe-extension-debugging",
      `--remote-allow-origins=chrome-extension://${extensionId}`,
      "--window-size=1280,800",
      "--headless",
      ...(process.env.CI ? ["--no-sandbox"] : []),
    ],
  });
}

async function waitForResidentReady(cdp: CDPClient, sessionId: string): Promise<RuntimeMarker> {
  const deadline = Date.now() + COMMAND_TIMEOUT_MS;
  let lastMarker: unknown;

  while (Date.now() < deadline) {
    const evaluated = await cdp.sendCommand<{
      result?: { value?: unknown };
      exceptionDetails?: unknown;
    }>(
      "Runtime.evaluate",
      {
        expression: "globalThis.__stagehand_runtime",
        returnByValue: true,
      },
      sessionId,
    );
    lastMarker = evaluated.result?.value;
    if (
      typeof lastMarker === "object" &&
      lastMarker !== null &&
      "state" in lastMarker &&
      lastMarker.state === "ready"
    ) {
      return lastMarker as RuntimeMarker;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for resident readiness: ${JSON.stringify(lastMarker)}`);
}

function unpackedExtensionId(directory: string): string {
  return createHash("sha256")
    .update(directory)
    .digest("hex")
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (character) =>
      String.fromCharCode("a".charCodeAt(0) + Number.parseInt(character, 16)),
    );
}

function requireRpcClient(value: RPCClient | undefined): RPCClient {
  if (!value) throw new Error("Stagehand RPC client was not initialized");
  return value;
}
