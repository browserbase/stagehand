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

  it("ping rejects invalid params before the handler runs", async () => {
    await expect(bridge?.send("ping", { extra: true } as never)).rejects.toThrow();
  });

  it("page.goto returns a typed response from the service worker runtime", async () => {
    await expect(
      bridge?.send("page.goto", {
        pageId: "active-page",
        url: fixtureServer?.url ?? "",
      }),
    ).resolves.toStrictEqual({
      pageId: "active-page",
      url: fixtureServer?.url,
      title: "Stagehand Smoke",
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
