import { connect, type Socket } from "node:net";
import { createServer, type Server } from "node:http";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromePath, launch, Launcher, type LaunchedChrome } from "chrome-launcher";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { instrumentedDecoratorBuild } from "../../../server/instrumentedDecoratorBuild.js";
import { CDPClient } from "../../../sdk-ts/src/cdpClient.js";
import { connectRPCClient, type RPCClient } from "../../../sdk-ts/src/rpcClient.js";
import { StagehandMethods } from "../../schema-registry.js";
import { STAGEHAND_PROTOCOL_VERSION } from "../../schemas.js";

const COMMAND_TIMEOUT_MS = 15_000;
const serverDistDir = path.resolve(fileURLToPath(new URL("../../../server/dist", import.meta.url)));
const serviceWorkerEntry = path.resolve(
  fileURLToPath(new URL("../../../server/service-worker.ts", import.meta.url)),
);

type BrowserProxy = {
  url: string;
  close(): Promise<void>;
};

describe("resident browser proxy", () => {
  it("bootstraps a real extension and serves the first RPC without a client CDP URL", async () => {
    let chrome: LaunchedChrome | undefined;
    let proxy: BrowserProxy | undefined;
    let extensionDir: string | undefined;
    let rpcClient: RPCClient | undefined;

    try {
      chrome = await launchChrome();
      proxy = await startBrowserProxy(chrome.port);
      extensionDir = await buildResidentExtension(proxy.url);
      rpcClient = await connectRPCClient({
        cdpUrl: `http://127.0.0.1:${chrome.port}`,
        extensionDir,
        serviceWorkerUrlIncludes: "service-worker.js",
        discoveryTimeoutMs: COMMAND_TIMEOUT_MS,
        commandTimeoutMs: COMMAND_TIMEOUT_MS,
      });

      const marker = await waitForResidentReady(rpcClient);
      expect(marker).toMatchObject({
        state: "ready",
        connected: true,
        timings: {
          connectAndBootstrapMs: expect.any(Number),
          totalMs: expect.any(Number),
        },
      });

      await expect(
        rpcClient.send(StagehandMethods.stagehandInit, {
          protocolVersion: STAGEHAND_PROTOCOL_VERSION,
          clientInfo: { name: "stagehand-sdk-ts", version: "4.0.0" },
          logLevel: "off",
          telemetry: { traces: { endpoint: "http://127.0.0.1:4318/v1/traces", headers: {} } },
        }),
      ).resolves.toMatchObject({ initialized: true });
      await expect(rpcClient.send(StagehandMethods.browserGetVersion, {})).resolves.toMatchObject({
        protocolVersion: "1.3",
        product: expect.stringContaining("Chrome/"),
      });

      const existingPages = await rpcClient.send(StagehandMethods.contextPages, {});
      expect(existingPages).toHaveLength(1);
      const page = await rpcClient.send(StagehandMethods.contextNewPage, {
        url: "data:text/html,<title>Resident proxy smoke</title>",
      });
      await expect(
        rpcClient.send(StagehandMethods.pageEvaluate, {
          pageId: page.pageId,
          expression: "document.title",
        }),
      ).resolves.toStrictEqual({ value: "Resident proxy smoke" });
    } finally {
      rpcClient?.close();
      chrome?.kill();
      await proxy?.close();
      if (extensionDir) await rm(extensionDir, { force: true, recursive: true });
    }
  }, 60_000);
});

async function buildResidentExtension(browserProxyUrl: string): Promise<string> {
  const extensionDir = await mkdtemp(path.join(tmpdir(), "stagehand-resident-proxy-"));
  await cp(serverDistDir, extensionDir, { recursive: true });
  await build({
    configFile: false,
    logLevel: "silent",
    define: {
      "import.meta.env.VITE_STAGEHAND_BROWSER_PROXY_URL": JSON.stringify(browserProxyUrl),
    },
    plugins: [instrumentedDecoratorBuild()],
    build: {
      emptyOutDir: false,
      minify: "oxc",
      outDir: extensionDir,
      target: "es2022",
      rolldownOptions: {
        input: serviceWorkerEntry,
        output: {
          entryFileNames: "service-worker.js",
          minify: {
            compress: { keepNames: { function: true, class: true } },
            mangle: { keepNames: { function: true, class: true } },
          },
        },
      },
    },
  });
  return extensionDir;
}

async function launchChrome(): Promise<LaunchedChrome> {
  const chromePath = getChromePath();
  if (!chromePath) throw new Error("No local Chrome or Chromium installation was found");

  return await launch({
    chromePath,
    startingUrl: "about:blank",
    ignoreDefaultFlags: true,
    chromeFlags: [
      ...Launcher.defaultFlags().filter((flag) => flag !== "--disable-extensions"),
      "--enable-unsafe-extension-debugging",
      "--remote-allow-origins=*",
      "--window-size=1280,800",
      "--headless",
      ...(process.env.CI ? ["--no-sandbox"] : []),
    ],
  });
}

async function startBrowserProxy(chromePort: number): Promise<BrowserProxy> {
  const sockets = new Set<Socket>();
  const server = createServer(async (request, response) => {
    try {
      if (request.url !== "/json/version") {
        response.writeHead(404).end("not found");
        return;
      }
      const upstream = await fetch(`http://127.0.0.1:${chromePort}/json/version`);
      response.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
      });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      response.writeHead(502).end(error instanceof Error ? error.message : String(error));
    }
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (request, clientSocket, head) => {
    const upstreamSocket = connect(chromePort, "127.0.0.1");
    sockets.add(upstreamSocket);
    upstreamSocket.once("close", () => sockets.delete(upstreamSocket));
    upstreamSocket.once("error", () => clientSocket.destroy());
    clientSocket.once("error", () => upstreamSocket.destroy());
    upstreamSocket.once("connect", () => {
      const headers: string[] = [];
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        headers.push(`${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}`);
      }
      upstreamSocket.write(
        `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers.join("\r\n")}\r\n\r\n`,
      );
      if (head.length > 0) upstreamSocket.write(head);
      clientSocket.pipe(upstreamSocket).pipe(clientSocket);
    });
  });

  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Browser proxy did not bind");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await closeServer(server);
    },
  };
}

async function waitForResidentReady(rpcClient: RPCClient): Promise<unknown> {
  const cdp = rpcClient.cdp as CDPClient;
  const sessionId = cdp.sessionId;
  if (!sessionId) throw new Error("Stagehand service worker is not attached");
  const deadline = Date.now() + COMMAND_TIMEOUT_MS;
  let marker: unknown;
  while (Date.now() < deadline) {
    const evaluated = await cdp.sendCommand<{ result?: { value?: unknown } }>(
      "Runtime.evaluate",
      { expression: "globalThis.__stagehand_runtime", returnByValue: true },
      sessionId,
    );
    marker = evaluated.result?.value;
    if (typeof marker === "object" && marker !== null && Reflect.get(marker, "state") === "ready") {
      return marker;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for resident readiness: ${JSON.stringify(marker)}`);
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
