import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod/v4";
import type { LLMGenerateResult } from "../../../protocol/types.js";
import { Stagehand, type BrowserContext, type Page } from "../../src/index.js";

type FixtureServer = {
  url: string;
  close(): Promise<void>;
};

describe("Stagehand TS SDK launch/connect smoke", () => {
  let fixtureServer: FixtureServer | undefined;
  let stagehand: Stagehand | undefined;
  let restoreConsole: (() => void) | undefined;

  beforeAll(async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    restoreConsole = () => {
      debug.mockRestore();
      info.mockRestore();
    };

    fixtureServer = await startFixtureServer();
    stagehand = new Stagehand({
      browser: {
        type: "local",
        headless: true,
      },
      model: {
        generate: async (params): Promise<LLMGenerateResult> => {
          if (params.responseFormat?.type !== "json_schema") {
            throw new Error("The smoke LLM only supports structured generation");
          }

          if (params.responseFormat.name === "Metadata") {
            return {
              role: "assistant",
              content: { type: "text", text: "complete" },
              outputFormat: "json_schema",
              structuredContent: {
                progress: "The requested heading was extracted",
                completed: true,
              },
            };
          }

          if (params.responseFormat.name === "Observation") {
            const promptText = params.messages
              .flatMap((message) =>
                Array.isArray(message.content) ? message.content : [message.content],
              )
              .filter((content) => content.type === "text")
              .map((content) => content.text)
              .join("\n");
            const submitLine = promptText
              .split("\n")
              .find((line) => line.includes("Submit") && line.includes("["));
            const elementId = submitLine?.match(/\[(\d+-\d+)\]/)?.[1];
            if (!elementId) {
              throw new Error("The smoke observation prompt did not contain the Submit button ID");
            }

            return {
              role: "assistant",
              content: { type: "text", text: "structured observation" },
              outputFormat: "json_schema",
              structuredContent: {
                elements: [
                  {
                    elementId,
                    description: "Submit button",
                    method: "click",
                    arguments: [],
                  },
                ],
              },
            };
          }

          if (params.responseFormat.name === "Act") {
            const promptText = params.messages
              .flatMap((message) =>
                Array.isArray(message.content) ? message.content : [message.content],
              )
              .filter((content) => content.type === "text")
              .map((content) => content.text)
              .join("\n");
            const submitLine = promptText
              .split("\n")
              .find((line) => line.includes("Submit") && line.includes("["));
            const elementId = submitLine?.match(/\[(\d+-\d+)\]/)?.[1];
            if (!elementId) {
              throw new Error("The smoke action prompt did not contain the Submit button ID");
            }

            return {
              role: "assistant",
              content: { type: "text", text: "structured action" },
              outputFormat: "json_schema",
              structuredContent: {
                action: {
                  elementId,
                  description: "Submit button",
                  method: "click",
                  arguments: [],
                },
                twoStep: false,
              },
            };
          }

          return {
            role: "assistant",
            content: { type: "text", text: "structured extraction" },
            outputFormat: "json_schema",
            structuredContent: { heading: "Stagehand SDK Smoke" },
          };
        },
      },
    });
    await stagehand.init();
  }, 45_000);

  afterAll(async () => {
    try {
      await stagehand?.close();
      await fixtureServer?.close();
    } finally {
      restoreConsole?.();
    }
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
    await expect(page.locator("#locator-input").inputValue()).resolves.toBe("user@example.com");
    await expect(page.locator("#locator-checkbox").isChecked()).resolves.toBe(true);
    await expect(page.locator(".locator-item").count()).resolves.toBe(3);
    await expect(page.locator(".locator-item").first().innerText()).resolves.toBe("first");
    await expect(page.locator(".locator-item").nth(1).innerText()).resolves.toBe("second");
    await expect(page.locator("#locator-html").innerHtml()).resolves.toBe(
      "<span>nested html</span>",
    );
    await expect(page.locator("#locator-select").selectOption("pro")).resolves.toStrictEqual([
      "pro",
    ]);
    await expect(page.locator("#locator-select").inputValue()).resolves.toBe("pro");
    await expect(page.locator("#locator-output").textContent()).resolves.toBe(
      "clicked:user@example.com",
    );
  });

  it("navigates and runs scripts through the page wrapper", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const page = await activeStagehand.context.newPage();
    const secondUrl = new URL("/second", activeFixtureServer.url).href;

    await page.addInitScript({
      content: "globalThis.__stagehandSmokeInit = 'ready';",
    });
    await page.goto(activeFixtureServer.url, { waitUntil: "load" });

    await expect(
      page.evaluate(
        (arg: { suffix: string }) => ({
          title: document.title + arg.suffix,
          init: (
            globalThis as typeof globalThis & {
              __stagehandSmokeInit?: string;
            }
          ).__stagehandSmokeInit,
        }),
        { suffix: "!" },
      ),
    ).resolves.toStrictEqual({ title: "Stagehand SDK Smoke!", init: "ready" });

    await page.goto(secondUrl, { waitUntil: "load" });
    await expect(page.url()).resolves.toBe(secondUrl);
    await expect(page.evaluate("globalThis.__stagehandSmokeInit")).resolves.toBe("ready");

    await page.goBack({ waitUntil: "load" });
    await expect(page.url()).resolves.toBe(activeFixtureServer.url);
    await page.goForward({ waitUntil: "load" });
    await expect(page.url()).resolves.toBe(secondUrl);
    await page.reload({ waitUntil: "load" });
    await expect(page.title()).resolves.toBe("Stagehand SDK Smoke Second");
  });

  it("uses page-level interactions and waits", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const page = await activeStagehand.context.newPage({ url: activeFixtureServer.url });

    await page.waitForLoadState("load");
    await expect(
      page.waitForSelector("#locator-button", { state: "visible", timeout: 5_000 }),
    ).resolves.toBe(true);

    const buttonCenter = await page.evaluate<{ x: number; y: number }>(`(() => {
      const rect = document.querySelector("#locator-button").getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    await expect(
      page.click(buttonCenter.x, buttonCenter.y, { returnXpath: true }),
    ).resolves.not.toBe("");
    await expect(page.locator("#locator-output").textContent()).resolves.toBe("clicked:");

    await page.evaluate(`document.querySelector("#locator-input").focus()`);
    await page.type("smoke");
    await page.keyPress("!");
    await expect(page.locator("#locator-input").inputValue()).resolves.toBe("smoke!");
    await page.waitForTimeout(1);
  });

  it("applies page configuration and captures browser state", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const page = await activeStagehand.context.newPage();
    const headersUrl = new URL("/headers", activeFixtureServer.url).href;

    await page.setExtraHTTPHeaders({ "X-Stagehand-Smoke": "header-value" });
    await page.setViewportSize(800, 600, { deviceScaleFactor: 1 });
    await page.goto(headersUrl, { waitUntil: "load" });

    await expect(page.locator("#request-header").textContent()).resolves.toBe("header-value");
    await expect(
      page.evaluate("({ width: globalThis.innerWidth, height: globalThis.innerHeight })"),
    ).resolves.toStrictEqual({ width: 800, height: 600 });

    const screenshot = await page.screenshot();
    expect([...screenshot.subarray(0, 8)]).toStrictEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    const snapshot = await page.snapshot();
    expect(snapshot.formattedTree.length).toBeGreaterThan(0);
    expect(snapshot.xpathMap).toBeTypeOf("object");
    expect(snapshot.urlMap).toBeTypeOf("object");
  });

  it("extracts structured data from a real page through the connected SDK", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const page =
      (await activeStagehand.context.pages())[0] ?? (await activeStagehand.context.newPage());
    await page.goto(activeFixtureServer.url);

    await expect(
      activeStagehand.extract("Extract the page heading", z.object({ heading: z.string() }), {
        page,
      }),
    ).resolves.toStrictEqual({ heading: "Stagehand SDK Smoke" });
  });

  it("observes actionable elements on a real page through the connected SDK", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const page =
      (await activeStagehand.context.pages())[0] ?? (await activeStagehand.context.newPage());
    await page.goto(activeFixtureServer.url);

    const actions = await activeStagehand.observe("Find the Submit button", { page });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      selector: expect.stringMatching(/^xpath=/),
      description: "Submit button",
      method: "click",
      arguments: [],
    });
  });

  it("tracks four identical Chrome tabs across rapid selection and closure", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const createdPages: Page[] = [];

    try {
      for (const marker of ["one", "two", "three", "four"]) {
        const page = await activeStagehand.context.newPage({ url: activeFixtureServer.url });
        createdPages.push(page);
        await page.evaluate((value: string) => {
          (
            globalThis as typeof globalThis & {
              __stagehandActivePageMarker?: string;
            }
          ).__stagehandActivePageMarker = value;
        }, marker);
        await waitForActivePageId(activeStagehand.context, page.pageId);
      }

      expect(new Set(createdPages.map((page) => page.pageId)).size).toBe(4);
      await expect(Promise.all(createdPages.map((page) => page.url()))).resolves.toStrictEqual(
        Array.from({ length: 4 }, () => activeFixtureServer.url),
      );
      await expect(Promise.all(createdPages.map((page) => page.title()))).resolves.toStrictEqual(
        Array.from({ length: 4 }, () => "Stagehand SDK Smoke"),
      );

      const selectionOrder = [
        createdPages[2]!,
        createdPages[0]!,
        createdPages[3]!,
        createdPages[1]!,
      ];
      for (const page of selectionOrder) {
        await activeStagehand.context.setActivePage(page);
      }

      const selectedPage = await waitForActivePageId(
        activeStagehand.context,
        createdPages[1]!.pageId,
      );
      await expect(selectedPage.evaluate("globalThis.__stagehandActivePageMarker")).resolves.toBe(
        "two",
      );

      await createdPages[0]!.close();
      await waitForPageRemoval(activeStagehand.context, createdPages[0]!.pageId);
      await waitForActivePageId(activeStagehand.context, createdPages[1]!.pageId);

      const closedActivePageId = createdPages[1]!.pageId;
      await createdPages[1]!.close();
      await waitForPageRemoval(activeStagehand.context, closedActivePageId);
      const replacement = await waitForActivePageOtherThan(
        activeStagehand.context,
        closedActivePageId,
      );
      const livePageIds = new Set(
        (await activeStagehand.context.pages()).map((page) => page.pageId),
      );
      expect(livePageIds.has(replacement.pageId)).toBe(true);
    } finally {
      await closePages(createdPages);
    }
  }, 20_000);

  it("tracks a user-gesture popup as it opens, activates, and closes", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const createdPages: Page[] = [];

    try {
      const opener = await activeStagehand.context.newPage({ url: activeFixtureServer.url });
      createdPages.push(opener);
      await activeStagehand.context.setActivePage(opener);
      await waitForActivePageId(activeStagehand.context, opener.pageId);

      const pageIdsBeforePopup = new Set(
        (await activeStagehand.context.pages()).map((page) => page.pageId),
      );
      await opener.locator("#popup-button").click();

      const popup = await waitForNewPage(activeStagehand.context, pageIdsBeforePopup);
      createdPages.push(popup);
      await popup.waitForLoadState("load");

      expect(popup.pageId).not.toBe(opener.pageId);
      await expect(popup.url()).resolves.toBe(activeFixtureServer.url);
      await expect(popup.title()).resolves.toBe("Stagehand SDK Smoke");
      await waitForActivePageId(activeStagehand.context, popup.pageId);

      await popup.close();
      await waitForPageRemoval(activeStagehand.context, popup.pageId);
      const replacement = await waitForActivePageOtherThan(activeStagehand.context, popup.pageId);
      const livePageIds = new Set(
        (await activeStagehand.context.pages()).map((page) => page.pageId),
      );
      expect(livePageIds.has(replacement.pageId)).toBe(true);

      await activeStagehand.context.setActivePage(opener);
      await waitForActivePageId(activeStagehand.context, opener.pageId);
    } finally {
      await closePages(createdPages);
    }
  }, 20_000);

  it("applies context scripts and headers to a new page", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const headersUrl = new URL("/headers", activeFixtureServer.url).href;

    await activeStagehand.context.addInitScript({
      content: "globalThis.__stagehandContextSmokeInit = 'context-ready';",
    });
    await activeStagehand.context.setExtraHTTPHeaders({
      "X-Stagehand-Context-Smoke": "context-header-value",
    });
    const page = await activeStagehand.context.newPage();
    await page.goto(headersUrl, { waitUntil: "load" });

    await expect(page.evaluate("globalThis.__stagehandContextSmokeInit")).resolves.toBe(
      "context-ready",
    );
    await expect(page.locator("#context-request-header").textContent()).resolves.toBe(
      "context-header-value",
    );
  });

  it("adds, filters, and clears context cookies", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const keepCookieName = "stagehand-context-keep";
    const removeCookieName = "stagehand-context-remove";
    const cookieNames = [keepCookieName, removeCookieName];

    await activeStagehand.context.addCookies([
      {
        name: keepCookieName,
        value: "keep",
        url: activeFixtureServer.url,
        sameSite: "Lax",
      },
      {
        name: removeCookieName,
        value: "remove",
        url: activeFixtureServer.url,
        sameSite: "Lax",
      },
    ]);

    const addedCookies = await activeStagehand.context.cookies(activeFixtureServer.url);
    expect(
      addedCookies
        .filter((cookie) => cookieNames.includes(cookie.name))
        .map((cookie) => cookie.name)
        .sort(),
    ).toStrictEqual([...cookieNames].sort());

    await activeStagehand.context.clearCookies({ name: /-remove$/ });
    const filteredCookies = await activeStagehand.context.cookies(activeFixtureServer.url);
    expect(filteredCookies.find((cookie) => cookie.name === keepCookieName)?.value).toBe("keep");
    expect(filteredCookies.some((cookie) => cookie.name === removeCookieName)).toBe(false);

    await activeStagehand.context.clearCookies({ name: /^stagehand-context-/ });
    const clearedCookies = await activeStagehand.context.cookies(activeFixtureServer.url);
    expect(clearedCookies.some((cookie) => cookieNames.includes(cookie.name))).toBe(false);
  });

  it("reads, writes, and clears clipboard text against an explicit page", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const page = await activeStagehand.context.newPage({ url: activeFixtureServer.url });

    await activeStagehand.context.clipboard.writeText("stagehand clipboard smoke", { page });
    await expect(activeStagehand.context.clipboard.readText({ page })).resolves.toBe(
      "stagehand clipboard smoke",
    );
    await activeStagehand.context.clipboard.clear({ page });
    await expect(activeStagehand.context.clipboard.readText({ page })).resolves.toBe("");
  });

  it("acts on a real page through the connected SDK", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const page =
      (await activeStagehand.context.pages())[0] ?? (await activeStagehand.context.newPage());
    await page.goto(activeFixtureServer.url);

    const result = await activeStagehand.act("Click the Submit button", { page });

    expect(result).toMatchObject({
      success: true,
      actionDescription: "Submit button",
      actions: [
        {
          selector: expect.stringMatching(/^xpath=/),
          description: "Submit button",
          method: "click",
          arguments: [],
        },
      ],
    });
    await expect(page.locator("#locator-output").textContent()).resolves.toBe("clicked:");
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
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html>
  <head>
    <title>Stagehand SDK Smoke</title>
  </head>
  <body>
    <label for="locator-input">Email</label>
    <input id="locator-input" name="email" />
    <label for="locator-checkbox">Subscribed</label>
    <input id="locator-checkbox" type="checkbox" checked />
    <label for="locator-select">Plan</label>
    <select id="locator-select">
      <option value="starter">Starter</option>
      <option value="pro">Pro</option>
    </select>
    <button
      id="locator-button"
      onclick="document.querySelector('#locator-output').textContent = 'clicked:' + document.querySelector('#locator-input').value;"
    >
      Submit
    </button>
    <button id="popup-button" onclick="window.open(window.location.href, '_blank')">
      Open popup
    </button>
    <ul>
      <li class="locator-item">first</li>
      <li class="locator-item">second</li>
      <li class="locator-item">third</li>
    </ul>
    <div id="locator-html"><span>nested html</span></div>
    <p id="locator-output">waiting</p>
  </body>
</html>`);
      return;
    }

    if (request.url === "/second") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html>
  <head>
    <title>Stagehand SDK Smoke Second</title>
  </head>
  <body>
    <p id="second-page">second page</p>
  </body>
</html>`);
      return;
    }

    if (request.url === "/headers") {
      const header = String(request.headers["x-stagehand-smoke"] ?? "missing");
      const contextHeader = String(request.headers["x-stagehand-context-smoke"] ?? "missing");
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html>
  <head>
    <title>Stagehand SDK Smoke Headers</title>
  </head>
  <body>
    <p id="request-header">${escapeHtml(header)}</p>
    <p id="context-request-header">${escapeHtml(contextHeader)}</p>
  </body>
</html>`);
      return;
    }

    response.writeHead(404);
    response.end("not found");
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

async function waitForActivePageId(
  context: BrowserContext,
  pageId: string,
  timeoutMs = 10_000,
): Promise<Page> {
  return await pollUntil(
    () => context.activePage(),
    (page): page is Page => page?.pageId === pageId,
    `active page ${pageId}`,
    timeoutMs,
  );
}

async function waitForActivePageOtherThan(
  context: BrowserContext,
  excludedPageId: string,
  timeoutMs = 10_000,
): Promise<Page> {
  return await pollUntil(
    () => context.activePage(),
    (page): page is Page => page !== undefined && page.pageId !== excludedPageId,
    `an active page other than ${excludedPageId}`,
    timeoutMs,
  );
}

async function waitForNewPage(
  context: BrowserContext,
  existingPageIds: ReadonlySet<string>,
  timeoutMs = 10_000,
): Promise<Page> {
  return await pollUntil(
    async () => (await context.pages()).find((page) => !existingPageIds.has(page.pageId)),
    (page): page is Page => page !== undefined,
    "a newly opened popup page",
    timeoutMs,
  );
}

async function waitForPageRemoval(
  context: BrowserContext,
  pageId: string,
  timeoutMs = 10_000,
): Promise<void> {
  await pollUntil(
    async () => (await context.pages()).some((page) => page.pageId === pageId),
    (isPresent) => !isPresent,
    `page ${pageId} to close`,
    timeoutMs,
  );
}

async function pollUntil<Value, Result extends Value>(
  read: () => Promise<Value>,
  matches: (value: Value) => value is Result,
  description: string,
  timeoutMs: number,
): Promise<Result>;
async function pollUntil<Value>(
  read: () => Promise<Value>,
  matches: (value: Value) => boolean,
  description: string,
  timeoutMs: number,
): Promise<Value>;
async function pollUntil<Value>(
  read: () => Promise<Value>,
  matches: (value: Value) => boolean,
  description: string,
  timeoutMs: number,
): Promise<Value> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!matches(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    value = await read();
  }
  if (!matches(value)) {
    throw new Error(`Timed out waiting for ${description}`);
  }
  return value;
}

async function closePages(pages: Page[]): Promise<void> {
  for (const page of [...pages].reverse()) {
    await page.close().catch(() => {});
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
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
