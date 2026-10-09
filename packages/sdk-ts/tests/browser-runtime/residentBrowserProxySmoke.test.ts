import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, type Plugin } from "vite";
import { describe, expect, it } from "vitest";
import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
import { STAGEHAND_PROTOCOL_VERSION } from "@browserbasehq/stagehand-protocol/schemas";
import { launchLocalBrowser } from "../../src/browser/localBrowser.js";
import type { CDPClient } from "../../src/cdpClient.js";
import { connectRPCClient, type RPCClient } from "../../src/rpcClient.js";

const stagehandExtensionDistDir = fileURLToPath(
  new URL("../../../extension/dist", import.meta.url),
);
const stagehandExtensionEntry = fileURLToPath(
  new URL("../../../extension/service-worker.ts", import.meta.url),
);
// Loaded by path at runtime so this package does not import extension source.
const instrumentedDecoratorBuildModule = pathToFileURL(
  fileURLToPath(new URL("../../../extension/instrumentedDecoratorBuild.ts", import.meta.url)),
).href;

type LaunchedLocalBrowser = Awaited<ReturnType<typeof launchLocalBrowser>>;

type BrowserProxy = {
  url: string;
  close(): Promise<void>;
};

describe("resident browser proxy", () => {
  it("attaches a real extension on the first RPC without a client CDP URL", async () => {
    const signal = AbortSignal.timeout(60_000);
    let chrome: LaunchedLocalBrowser | undefined;
    let proxy: BrowserProxy | undefined;
    let extensionDir: string | undefined;
    let rpcClient: RPCClient | undefined;

    try {
      chrome = await launchLocalBrowser({ headless: true }, signal);
      const chromePort = Number(new URL(chrome.cdpUrl).port);
      proxy = await startBrowserProxy(chromePort);
      extensionDir = await buildResidentExtension(proxy.url);
      rpcClient = await connectRPCClient({
        cdpUrl: chrome.cdpUrl,
        extensionDir,
        serviceWorkerUrlIncludes: "service-worker.js",
        signal,
      });

      await expect(readRuntimeMarker(rpcClient, signal)).resolves.toMatchObject({
        state: "idle",
        connected: false,
      });
      const initParams = {
        protocolVersion: STAGEHAND_PROTOCOL_VERSION,
        clientInfo: { name: "stagehand-sdk-ts" as const, version: "4.0.0" },
        logLevel: "off" as const,
      };
      await expect(
        rpcClient.send(StagehandMethods.stagehandInit, initParams, { signal }),
      ).resolves.toMatchObject({ initialized: true });
      await expect(readRuntimeMarker(rpcClient, signal)).resolves.toMatchObject({
        state: "ready",
        connected: true,
        timings: {
          connectAndBootstrapMs: expect.any(Number),
          totalMs: expect.any(Number),
        },
      });

      await expect(
        rpcClient.send(StagehandMethods.contextPages, {}, { signal }),
      ).resolves.toHaveLength(1);
      const page = await rpcClient.send(
        StagehandMethods.contextNewPage,
        { url: "data:text/html,<title>Resident proxy smoke</title>" },
        { signal },
      );
      await expect(
        rpcClient.send(StagehandMethods.contextSetActivePage, { pageId: page.pageId }, { signal }),
      ).resolves.toStrictEqual({ ok: true });
      await expect(
        rpcClient.send(StagehandMethods.contextActivePage, {}, { signal }),
      ).resolves.toMatchObject({ pageId: page.pageId });
      await expect(
        rpcClient.send(
          StagehandMethods.pageEvaluate,
          { pageId: page.pageId, expression: "document.title" },
          { signal },
        ),
      ).resolves.toStrictEqual({ value: "Resident proxy smoke" });

      // stagehand.close disposes the instance but keeps the resident connection for the next one.
      await expect(
        rpcClient.send(StagehandMethods.stagehandClose, {}, { signal }),
      ).resolves.toMatchObject({ closed: true });
      await expect(readRuntimeMarker(rpcClient, signal)).resolves.toMatchObject({
        state: "ready",
        connected: true,
      });
      await expect(
        rpcClient.send(StagehandMethods.stagehandInit, initParams, { signal }),
      ).resolves.toMatchObject({ initialized: true });
    } finally {
      rpcClient?.close();
      await chrome?.close();
      await proxy?.close();
      if (extensionDir) await rm(extensionDir, { force: true, recursive: true });
    }
  }, 60_000);
});

async function readRuntimeMarker(rpcClient: RPCClient, signal: AbortSignal): Promise<unknown> {
  const cdp = rpcClient.cdp as CDPClient;
  const result = await cdp.sendCommand<{
    result: { value?: unknown };
    exceptionDetails?: unknown;
  }>(
    "Runtime.evaluate",
    { expression: "globalThis.__stagehand_runtime", returnByValue: true },
    cdp.sessionId,
    signal,
  );
  if (result.exceptionDetails) throw new Error("Failed to read the Stagehand runtime marker");
  return result.result.value;
}

async function buildResidentExtension(browserProxyUrl: string): Promise<string> {
  const extensionDir = await mkdtemp(path.join(tmpdir(), "stagehand-resident-extension-"));
  try {
    const outputFiles = await readdir(stagehandExtensionDistDir);
    await Promise.all(
      outputFiles.map((file) =>
        cp(path.join(stagehandExtensionDistDir, file), path.join(extensionDir, file), {
          recursive: true,
        }),
      ),
    );
    await build({
      configFile: false,
      logLevel: "silent",
      define: {
        "import.meta.env.VITE_STAGEHAND_BROWSER_PROXY_URL": JSON.stringify(browserProxyUrl),
      },
      plugins: [
        (
          (await import(instrumentedDecoratorBuildModule)) as {
            instrumentedDecoratorBuild: () => Plugin;
          }
        ).instrumentedDecoratorBuild(),
      ],
      build: {
        emptyOutDir: false,
        minify: "oxc",
        outDir: extensionDir,
        target: "es2022",
        rolldownOptions: {
          input: stagehandExtensionEntry,
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
  } catch (error) {
    await rm(extensionDir, { force: true, recursive: true });
    throw error;
  }
}

async function startBrowserProxy(chromePort: number): Promise<BrowserProxy> {
  const sockets = new Set<Duplex>();
  const server = createServer(async (request, response) => {
    if (request.method !== "GET" || request.url !== "/json/version") {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    try {
      const upstream = await fetch(`http://127.0.0.1:${chromePort}/json/version`);
      response.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
      });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (request, socket, head) => {
    const upstream = connect(chromePort, "127.0.0.1");
    sockets.add(upstream);
    upstream.once("close", () => sockets.delete(upstream));
    const destroyBoth = (error: Error) => {
      socket.destroy(error);
      upstream.destroy(error);
    };
    upstream.once("error", destroyBoth);
    socket.once("error", destroyBoth);
    upstream.once("connect", () => {
      const headers: string[] = [];
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        headers.push(`${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}`);
      }
      upstream.write(
        `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers.join("\r\n")}\r\n\r\n`,
      );
      if (head.length > 0) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Browser proxy did not bind to a TCP port");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      for (const socket of sockets) socket.destroy();
      await closeServer(server);
    },
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
