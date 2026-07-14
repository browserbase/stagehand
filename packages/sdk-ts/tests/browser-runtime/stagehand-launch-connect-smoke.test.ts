import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { Stagehand } from "../../src/index.js";

type FixtureServer = {
  url: string;
  close(): Promise<void>;
};

describe("Stagehand TS SDK launch/connect smoke", () => {
  let fixtureServer: FixtureServer | undefined;
  let stagehand: Stagehand | undefined;

  beforeAll(async () => {
    fixtureServer = await startFixtureServer();
    stagehand = new Stagehand({
      localBrowserLaunchOptions: {
        headless: true,
      },
    });
    await stagehand.init();
  }, 45_000);

  afterAll(async () => {
    await stagehand?.close();
    await fixtureServer?.close();
  });

  it("drives a real browser through the public TS object model", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const page =
      (await activeStagehand.context.pages())[0] ?? (await activeStagehand.context.newPage());

    await page.goto(activeFixtureServer.url);
    await page.locator("#locator-input").fill("user@example.com");
    await page.locator("#locator-button").click();

    await expect(page.url()).resolves.toBe(activeFixtureServer.url);
    await expect(page.title()).resolves.toBe("Stagehand SDK Smoke");
    await expect(page.locator("#locator-output").textContent()).resolves.toBe(
      "clicked:user@example.com",
    );
  });
});

function requireStagehand(value: Stagehand | undefined): Stagehand {
  if (!value) {
    throw new Error("Stagehand was not initialized");
  }

  return value;
}

function requireFixtureServer(value: FixtureServer | undefined): FixtureServer {
  if (!value) {
    throw new Error("Fixture server was not initialized");
  }

  return value;
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
    <title>Stagehand SDK Smoke</title>
  </head>
  <body>
    <label for="locator-input">Email</label>
    <input id="locator-input" name="email" />
    <button
      id="locator-button"
      onclick="document.querySelector('#locator-output').textContent = 'clicked:' + document.querySelector('#locator-input').value;"
    >
      Submit
    </button>
    <p id="locator-output">waiting</p>
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
