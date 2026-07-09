import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChromePath, launch, Launcher, type LaunchedChrome } from "chrome-launcher";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { connectStagehandBridge, type StagehandBridge } from "../../../modcdp/index.js";

type FixtureServer = {
  url: string;
  close(): Promise<void>;
};

describe.sequential("Stagehand service worker bridge smoke", () => {
  let extensionDir: string | undefined;
  let fixtureServer: FixtureServer | undefined;
  let chrome: LaunchedChrome | undefined;
  let bridge: StagehandBridge | undefined;

  beforeAll(async () => {
    extensionDir = await createStagehandSmokeExtension();
    fixtureServer = await startFixtureServer();
    chrome = await launchChrome(fixtureServer.url);
    bridge = await connectStagehandBridge({
      cdpUrl: `http://127.0.0.1:${chrome.port}`,
      extensionDir,
      serviceWorkerUrlIncludes: "stagehand-smoke-worker.js",
      discoveryTimeoutMs: 15_000,
      commandTimeoutMs: 15_000,
    });
  }, 45_000);

  afterAll(async () => {
    bridge?.close();
    chrome?.kill();
    await fixtureServer?.close();

    if (extensionDir) {
      await rm(extensionDir, { force: true, recursive: true });
    }
  });

  it("discovers the Stagehand service worker in a real Chromium session", () => {
    expect(bridge?.serviceWorker.url).toContain("chrome-extension://");
    expect(bridge?.serviceWorker.url).toContain("/stagehand-smoke-worker.js");
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

  it("unknown protocol command returns a typed protocol error", async () => {
    await expect(bridge?.send("browser.raw_cdp" as never, {} as never)).rejects.toMatchObject({
      code: "stagehand.unknown_command",
    });
  });

  it("page.goto navigates the active page in a real browser", async () => {
    const result = await bridge?.send("page.goto", {
      url: fixtureServer?.url ?? "http://127.0.0.1/",
      wait_until: "load",
      timeout_ms: 10_000,
    });

    expect(result?.url).toBe(fixtureServer?.url);
  });

  it("page.goto returns live browser url and title data", async () => {
    const result = await bridge?.send("page.goto", {
      url: fixtureServer?.url ?? "http://127.0.0.1/",
      wait_until: "load",
      timeout_ms: 10_000,
    });

    expect(result).toStrictEqual({
      url: fixtureServer?.url,
      title: "Stagehand Smoke",
    });
  });

  it("page.click clicks a locator on a real fixture page", async () => {
    await bridge?.send("page.goto", {
      url: fixtureServer?.url ?? "http://127.0.0.1/",
      wait_until: "load",
      timeout_ms: 10_000,
    });

    const result = await bridge?.send("page.click", {
      locator: { css: "#smoke-button" },
      timeout_ms: 10_000,
    });

    expect(result).toStrictEqual({
      clicked: true,
      tag_name: "button",
      text: "Clicked",
    });
  });

  it("page.click rejects internal-only locator fields like backendNodeId", async () => {
    await expect(
      bridge?.send("page.click", {
        locator: { css: "#smoke-button", backendNodeId: 1 },
      } as never),
    ).rejects.toThrow();
  });

  it("bridge does not expose raw CDP passthrough as public API", () => {
    expect(bridge).toBeDefined();
    expect("sendCDP" in (bridge as object)).toBe(false);
    expect("cdp" in (bridge as object)).toBe(false);
  });
});

async function createStagehandSmokeExtension(): Promise<string> {
  const extensionDir = await mkdtemp(path.join(tmpdir(), "stagehand-smoke-extension-"));
  const runtimePath = fileURLToPath(
    new URL("../../../server/runtime/serviceWorkerRuntime.ts", import.meta.url),
  );
  const runtimeSource = await readFile(runtimePath, "utf8");
  const serviceWorker = ts.transpileModule(runtimeSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      removeComments: false,
    },
    fileName: "service-worker.ts",
  });

  await writeFile(
    path.join(extensionDir, "manifest.json"),
    JSON.stringify(
      {
        manifest_version: 3,
        name: "Stagehand Smoke Runtime",
        version: "0.0.0",
        permissions: ["scripting", "tabs"],
        host_permissions: ["<all_urls>"],
        background: {
          service_worker: "stagehand-smoke-worker.js",
          type: "module",
        },
        options_page: "options.html",
      },
      null,
      2,
    ),
  );
  await writeFile(path.join(extensionDir, "stagehand-smoke-worker.js"), serviceWorker.outputText);
  await writeFile(
    path.join(extensionDir, "options.html"),
    '<!doctype html><script src="options.js"></script>',
  );
  await writeFile(
    path.join(extensionDir, "options.js"),
    "chrome.runtime.sendMessage({ type: 'stagehand_smoke_options_wake' }, () => void chrome.runtime.lastError);\n",
  );

  return extensionDir;
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
      "--window-size=1280,800",
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
