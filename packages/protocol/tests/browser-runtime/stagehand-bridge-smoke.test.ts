import { createServer, type Server } from "node:http";
import { getChromePath, launch, Launcher, type LaunchedChrome } from "chrome-launcher";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { stagehandExtensionDistDir } from "../../../extension/build.ts";
import { connectStagehandBridge, type StagehandBridge } from "../../../modcdp/index.js";

type FixtureServer = {
  url: string;
  close(): Promise<void>;
};

// The production V4 CI installs and verifies a Chrome version with the extension
// support this provisional smoke test needs. Keep it local until that browser
// infrastructure replaces this test alongside the bridge.
const describeBrowserRuntime = process.env.CI ? describe.skip : describe;

describeBrowserRuntime("Stagehand service worker bridge smoke", () => {
  let extensionDir: string | undefined;
  let fixtureServer: FixtureServer | undefined;
  let chrome: LaunchedChrome | undefined;
  let bridge: StagehandBridge | undefined;

  beforeAll(async () => {
    extensionDir = stagehandExtensionDistDir;
    fixtureServer = await startFixtureServer();
    chrome = await launchChrome(fixtureServer.url);
    bridge = await connectStagehandBridge({
      cdpUrl: `http://127.0.0.1:${chrome.port}`,
      extensionDir,
      serviceWorkerUrlIncludes: "service-worker.js",
      discoveryTimeoutMs: 15_000,
      commandTimeoutMs: 15_000,
    });
  }, 45_000);

  afterAll(async () => {
    bridge?.close();
    chrome?.kill();
    await fixtureServer?.close();
  });

  it("discovers the Stagehand service worker in a real Chromium session", () => {
    expect(bridge?.serviceWorker.url).toContain("chrome-extension://");
    expect(bridge?.serviceWorker.url).toContain("/service-worker.js");
    expect(bridge?.serviceWorker.extensionId).toBeTruthy();
  });

  it("ping returns a typed response from the service worker runtime", async () => {
    await expect(bridge?.send("ping", {})).resolves.toStrictEqual({
      ok: true,
      runtime: "service_worker",
    });
  });

  it("browser.get_version returns the browser version over loopback CDP", async () => {
    const version = await bridge?.send("browser.get_version", {});

    expect(version?.protocolVersion).toBe("1.3");
    expect(version?.product).toContain("Chrome/");
    expect(version?.userAgent).toContain("Chrome/");
  });

  it("context.pages returns PageRefs from the understudy context", async () => {
    const pages = await requireBridge(bridge).send("context.pages", {});

    expect(pages.length).toBeGreaterThanOrEqual(1);
    expect(pages[0]?.pageId).toBeTruthy();
    expect(pages[0]?.url).toContain(requireFixtureServer(fixtureServer).url);
  });

  it("context.new_page returns a PageRef from the understudy context", async () => {
    const page = await requireBridge(bridge).send("context.new_page", {
      url: "about:blank",
    });

    expect(page.pageId).toBeTruthy();
    expect(page.url).toBe("about:blank");
  });

  it("ping rejects invalid params before the handler runs", async () => {
    await expect(bridge?.send("ping", { extra: true } as never)).rejects.toThrow();
  });

  it("routes page methods through real PageRefs in a browser session", async () => {
    const activeBridge = requireBridge(bridge);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const pages = await activeBridge.send("context.pages", {});
    const page = pages[0] ?? (await activeBridge.send("context.new_page", {}));

    await expect(
      activeBridge.send("page.goto", {
        pageId: page.pageId,
        url: activeFixtureServer.url,
      }),
    ).resolves.toStrictEqual({
      pageId: page.pageId,
      url: activeFixtureServer.url,
    });

    await expect(activeBridge.send("page.url", { pageId: page.pageId })).resolves.toStrictEqual({
      url: activeFixtureServer.url,
    });
    await expect(activeBridge.send("page.title", { pageId: page.pageId })).resolves.toStrictEqual({
      title: "Stagehand Smoke",
    });
  });

  it("closes a throwaway PageRef in a browser session", async () => {
    const activeBridge = requireBridge(bridge);
    const page = await activeBridge.send("context.new_page", {
      url: "about:blank",
    });

    await expect(activeBridge.send("page.close", { pageId: page.pageId })).resolves.toStrictEqual({
      closed: true,
    });
  });

  it("unknown protocol command returns a typed protocol error", async () => {
    await expect(bridge?.send("browser.raw_cdp" as never, {} as never)).rejects.toMatchObject({
      code: -32601,
      data: { type: "stagehand.unknown_command" },
    });
  });

  it("bridge does not expose raw CDP passthrough as public API", () => {
    expect(bridge).toBeDefined();
    expect("sendCDP" in (bridge as object)).toBe(false);
    expect("cdp" in (bridge as object)).toBe(false);
  });
});

function requireBridge(value: StagehandBridge | undefined): StagehandBridge {
  if (!value) {
    throw new Error("Stagehand bridge was not initialized");
  }

  return value;
}

function requireFixtureServer(value: FixtureServer | undefined): FixtureServer {
  if (!value) {
    throw new Error("Fixture server was not initialized");
  }

  return value;
}

async function launchChrome(startingUrl: string): Promise<LaunchedChrome> {
  const chromePath = getChromePath();

  if (!chromePath) {
    throw new Error("No local Chrome or Chromium installation was found");
  }

  return launch({
    chromePath,
    startingUrl,
    ignoreDefaultFlags: true,
    chromeFlags: [
      ...Launcher.defaultFlags().filter((flag) => flag !== "--disable-extensions"),
      "--enable-unsafe-extension-debugging",
      "--remote-allow-origins=*",
      "--window-size=1280,800",
      "--headless",
    ],
  });
}

async function startFixtureServer(): Promise<FixtureServer> {
  const server = createServer((request, response) => {
    if (request.url !== "/") {
      response.writeHead(404);
      response.end("not found");
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html>
  <head>
    <title>Stagehand Smoke</title>
  </head>
  <body>
    <button id="smoke-button" onclick="document.title = 'Stagehand Smoke Clicked'; this.textContent = 'Clicked';">Click me</button>
  </body>
</html>`);
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
    throw new Error("Fixture server did not bind to a TCP port");
  }

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
