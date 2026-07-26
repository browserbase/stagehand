import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromePath, launch, Launcher, type LaunchedChrome } from "chrome-launcher";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { StagehandMethods } from "../../schema-registry.js";
import type { StagehandRpcNotification } from "../../types.js";
import { CDPClient, resolveBrowserWebSocketUrl } from "../../../sdk-ts/src/cdpClient.js";
import { connectRPCClient, RPCClient } from "../../../sdk-ts/src/rpcClient.js";
import { FakePid2Server } from "./fake-pid2-server.js";

const DEBUGGING_PORT = 9222;
const COMMAND_TIMEOUT_MS = 15_000;
const extensionDir = path.resolve(fileURLToPath(new URL("../../../server/dist", import.meta.url)));
const extensionMetadataPath = fileURLToPath(
  new URL("../../../server/artifacts/stagehand-extension.metadata.json", import.meta.url),
);

type RuntimeMarker = {
  name: "stagehand";
  version: string;
  state: string;
  connected: boolean;
  activationEpoch?: string;
  runtimeInstanceId: string;
  timings: {
    connectAndBootstrapMs?: number;
    totalMs?: number;
  };
};

describe("pid2-resident Stagehand service worker", () => {
  let chrome: LaunchedChrome | undefined;
  let pid2: FakePid2Server | undefined;
  let cdp: CDPClient | undefined;
  let rpcClient: RPCClient | undefined;
  let marker: RuntimeMarker | undefined;

  beforeAll(async () => {
    const metadata = z
      .object({ chromeExtensionId: z.string().regex(/^[a-p]{32}$/u) })
      .parse(JSON.parse(await readFile(extensionMetadataPath, "utf8")));
    pid2 = new FakePid2Server(resolveChromeWebSocketUrl);
    await pid2.start();
    chrome = await launchChrome();
    try {
      rpcClient = await connectRPCClient({
        cdpUrl: `http://127.0.0.1:${DEBUGGING_PORT}`,
        extensionDir,
        serviceWorkerUrlIncludes: "service-worker.js",
        discoveryTimeoutMs: COMMAND_TIMEOUT_MS,
        commandTimeoutMs: COMMAND_TIMEOUT_MS,
        cdpConnectTimeoutMs: COMMAND_TIMEOUT_MS,
      });
    } catch (error) {
      const diagnostics = await readChromeExtensionDiagnostics().catch((diagnosticError) => ({
        diagnosticError:
          diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
      }));
      throw new Error(
        `Failed to connect to resident worker (${JSON.stringify({
          pid2Connections: pid2.connectionCount,
          upstreamConnections: pid2.upstreamConnectionCount,
          clientMessages: pid2.clientMessageCount,
          proxyError: pid2.lastProxyError,
          diagnostics,
        })})`,
        { cause: error },
      );
    }
    cdp = rpcClient.cdp as CDPClient;
    expect(rpcClient.serviceWorker.extensionId).toBe(metadata.chromeExtensionId);
    await expect(cdp.sendCommand("Extensions.getExtensions")).resolves.toMatchObject({
      extensions: [expect.objectContaining({ id: metadata.chromeExtensionId, enabled: true })],
    });
    if (!cdp.sessionId) throw new Error("Stagehand service worker was not attached");
    marker = await waitForResidentReady(cdp, cdp.sessionId);
  }, 45_000);

  afterAll(async () => {
    rpcClient?.close();
    chrome?.kill();
    await pid2?.close();
  });

  it("becomes operational through pid2 and serves RPCs without browserCdpUrl", async () => {
    expect(marker).toMatchObject({
      name: "stagehand",
      version: "4.0.0",
      state: "ready",
      connected: true,
      activationEpoch: "fake-pid2-reservation",
      runtimeInstanceId: expect.any(String),
      timings: {
        connectAndBootstrapMs: expect.any(Number),
        totalMs: expect.any(Number),
      },
    });
    expect(pid2?.clientMethods).not.toContain("Target.createTarget");
    expect(pid2?.clientMethods).not.toContain("Fetch.enable");
    expect(pid2?.clientMethods).not.toContain("Network.enable");
    expect(pid2?.clientMethods).not.toContain("Page.enable");
    expect(pid2?.clientMethods).not.toContain("Runtime.enable");

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

    await expect(
      activeRpcClient.send(StagehandMethods.stagehandInit, {
        protocolVersion: 4,
        clientInfo: { name: "stagehand-sdk-ts", version: "4.0.0" },
        telemetry: {
          traces: { endpoint: "http://127.0.0.1:4318/v1/traces", headers: {} },
        },
      }),
    ).resolves.toMatchObject({ initialized: true });
    expect(pid2?.clientMethods).toContain("Network.enable");
    expect(pid2?.clientMethods).toContain("Page.enable");
    expect(pid2?.clientMethods).toContain("Runtime.enable");
    await expect(
      activeRpcClient.send(StagehandMethods.browserGetVersion, {}),
    ).resolves.toMatchObject({
      protocolVersion: "1.3",
      product: expect.stringContaining("Chrome/"),
    });
    const pages = await activeRpcClient.send(StagehandMethods.contextPages, {});
    expect(pages).toHaveLength(1);
    await expect(
      activeRpcClient.send(StagehandMethods.pageUrl, { pageId: pages[0]!.pageId }),
    ).resolves.toMatchObject({ url: expect.any(String) });
    expect(pid2?.autoAttachRequests.length).toBeGreaterThan(0);
    for (const request of pid2?.autoAttachRequests ?? []) {
      expect(request).toMatchObject({
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
        filter: [{ type: "page" }, { type: "iframe" }, { exclude: true }],
      });
    }
    await vi.waitFor(() => expect(pid2?.pausedSessions.size).toBe(0));
  });
});

async function launchChrome(): Promise<LaunchedChrome> {
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
      // The fake pid2 proxy is a Node WebSocket client, so Chrome sees its
      // handshake rather than the extension origin used on the first hop.
      "--remote-allow-origins=*",
      "--window-size=1280,800",
      "--headless",
      ...(process.env.CI ? ["--no-sandbox"] : []),
    ],
  });
}

async function readChromeExtensionDiagnostics(): Promise<unknown> {
  const webSocketDebuggerUrl = await resolveBrowserWebSocketUrl(
    `http://127.0.0.1:${DEBUGGING_PORT}`,
  );
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Diagnostic CDP socket failed")), {
      once: true,
    });
  });
  const client = new CDPClient(socket, webSocketDebuggerUrl, COMMAND_TIMEOUT_MS);
  try {
    const extensions = await client.sendCommand("Extensions.getExtensions");
    const { targetId } = await client.sendCommand<{ targetId: string }>("Target.createTarget", {
      url: "chrome://extensions-internals/",
    });
    const { sessionId } = await client.sendCommand<{ sessionId: string }>("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    await client.sendCommand("Runtime.enable", {}, sessionId);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const body = await client.sendCommand(
      "Runtime.evaluate",
      { expression: "document.body.innerText", returnByValue: true },
      sessionId,
    );
    return { extensions, body };
  } finally {
    client.close();
  }
}

async function resolveChromeWebSocketUrl(): Promise<string> {
  const deadline = Date.now() + COMMAND_TIMEOUT_MS;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUGGING_PORT}/json/version`);
      if (response.ok) {
        const version = (await response.json()) as { webSocketDebuggerUrl?: string };
        if (version.webSocketDebuggerUrl) return version.webSocketDebuggerUrl;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out resolving local Chrome for fake pid2: ${lastError}`);
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
        expression: `({
          marker: globalThis.__stagehand_runtime,
          hasReceiver: typeof globalThis.__stagehandReceiveFromHost === "function"
        })`,
        returnByValue: true,
      },
      sessionId,
    );
    const value = evaluated.result?.value as
      | { marker?: RuntimeMarker; hasReceiver?: boolean }
      | undefined;
    lastMarker = value?.marker;
    if (value?.marker?.state === "ready" && value.hasReceiver === true) return value.marker;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for resident readiness: ${JSON.stringify(lastMarker)}`);
}

function requireRpcClient(value: RPCClient | undefined): RPCClient {
  if (!value) throw new Error("Stagehand RPC client was not initialized");
  return value;
}
