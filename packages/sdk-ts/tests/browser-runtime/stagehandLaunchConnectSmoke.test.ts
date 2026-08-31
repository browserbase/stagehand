import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import type {
  LLMGenerateResult,
  LLMImageContent,
  StagehandMetrics,
  StagehandResultUsage,
} from "@browserbasehq/stagehand-protocol/types";
import {
  localBrowser,
  Stagehand,
  type BrowserContext,
  type Page,
  type StagehandBrowser,
} from "../../src/index.js";

type FixtureServer = {
  url: string;
  close(): Promise<void>;
};

const SMOKE_LLM_USAGE = {
  inputTokens: 11,
  outputTokens: 4,
  totalTokens: 15,
  reasoningTokens: 2,
  cachedInputTokens: 3,
} satisfies NonNullable<LLMGenerateResult["usage"]>;

type ExpectedOperationUsage = Omit<StagehandResultUsage, "inferenceTimeMs">;

describe("Stagehand TS SDK launch/connect smoke", () => {
  let fixtureServer: FixtureServer | undefined;
  let stagehand: Stagehand | undefined;
  let browser: StagehandBrowser | undefined;
  const extractionScreenshots: LLMImageContent[] = [];
  const rawOperationUsages: Record<string, unknown>[] = [];
  const rawMetricsSnapshots: Record<string, unknown>[] = [];

  beforeAll(async () => {
    fixtureServer = await startFixtureServer();
    browser = await localBrowser.launch({ headless: true });
    stagehand = await Stagehand.create({
      browser,
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
              usage: SMOKE_LLM_USAGE,
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
              usage: SMOKE_LLM_USAGE,
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
              usage: SMOKE_LLM_USAGE,
            };
          }

          const extractionBlocks = params.messages.flatMap((message) =>
            Array.isArray(message.content) ? message.content : [message.content],
          );
          const extractionScreenshot = extractionBlocks.find(
            (block): block is LLMImageContent => block.type === "image",
          );
          if (extractionScreenshot) extractionScreenshots.push(extractionScreenshot);
          return {
            role: "assistant",
            content: { type: "text", text: "structured extraction" },
            outputFormat: "json_schema",
            structuredContent: { heading: "Stagehand SDK Smoke" },
            usage: SMOKE_LLM_USAGE,
          };
        },
      },
      logging: {
        level: "off",
      },
    });
    const rpcClient = stagehand.rpcClient;
    if (!rpcClient) throw new Error("Stagehand initialized without an RPC client");
    const transport = rpcClient.cdp;
    const receive = transport.onmessage;
    if (!receive) throw new Error("Stagehand RPC transport has no message receiver");
    transport.onmessage = async (message) => {
      const usage = operationUsageFromRawRpcMessage(message);
      if (usage) rawOperationUsages.push(usage);
      const metrics = metricsFromRawRpcMessage(message);
      if (metrics) rawMetricsSnapshots.push(metrics);
      await receive(message);
    };
  }, 45_000);

  afterAll(async () => {
    try {
      await stagehand?.close();
    } finally {
      try {
        await browser?.close();
      } finally {
        await fixtureServer?.close();
      }
    }
  });

  it("drives a real browser through the public TS object model", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const page =
      (await activeStagehand.browser.context.pages())[0] ??
      (await activeStagehand.browser.context.newPage());

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
    const page = await activeStagehand.browser.context.newPage();
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
    const page = await activeStagehand.browser.context.newPage(activeFixtureServer.url);

    await page.waitForLoadState("load");
    await expect(
      page.waitForSelector("#locator-button", { state: "visible", timeout: 5_000 }),
    ).resolves.toBe(true);

    const buttonCenter = await page.evaluate<{ x: number; y: number }>(`(() => {
      const rect = document.querySelector("#locator-button").getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    await expect(page.click(buttonCenter.x, buttonCenter.y)).resolves.toBeUndefined();
    await expect(page.locator("#locator-output").textContent()).resolves.toBe("clicked:");

    await page.evaluate(`document.querySelector("#locator-input").focus()`);
    await page.type("smoke");
    await page.keyPress("!");
    await expect(page.locator("#locator-input").inputValue()).resolves.toBe("smoke!");
    await page.waitForTimeout(1);
  });

  it("preserves custom drag routes through the page wrapper", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const page = await activeStagehand.browser.context.newPage();

    try {
      await page.evaluate(`(() => {
        globalThis.__stagehandDragMoves = [];
        document.addEventListener("mousemove", (event) => {
          if (event.buttons === 1) {
            globalThis.__stagehandDragMoves.push({ x: event.clientX, y: event.clientY });
          }
        });
      })()`);

      await expect(
        page.dragAndDrop(10, 10, 90, 90, {
          steps: 99,
          route: [
            { x: 10, y: 10 },
            { x: 25, y: 60 },
            { x: 70, y: 20 },
            { x: 90, y: 90 },
          ],
        }),
      ).resolves.toBeUndefined();

      await expect(page.evaluate("globalThis.__stagehandDragMoves")).resolves.toStrictEqual([
        { x: 25, y: 60 },
        { x: 70, y: 20 },
        { x: 90, y: 90 },
      ]);
    } finally {
      await page.close();
    }
  });

  it("applies page configuration and captures browser state", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const page = await activeStagehand.browser.context.newPage();
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
      (await activeStagehand.browser.context.pages())[0] ??
      (await activeStagehand.browser.context.newPage());
    await page.goto(activeFixtureServer.url);
    extractionScreenshots.length = 0;
    rawOperationUsages.length = 0;

    const result = await activeStagehand.extract(
      "Extract the page heading",
      z.object({ heading: z.string() }),
      {
        page,
        screenshot: true,
      },
    );

    expect(result).toStrictEqual({
      data: { heading: "Stagehand SDK Smoke" },
      metadata: {
        cache: { status: "DISABLED" },
        usage: {
          inputTokens: 22,
          outputTokens: 8,
          reasoningTokens: 4,
          cachedInputTokens: 6,
          inferenceTimeMs: expect.any(Number),
        },
      },
    });
    expectUsageCrossedRpc(
      result.metadata.usage,
      {
        inputTokens: 22,
        outputTokens: 8,
        reasoningTokens: 4,
        cachedInputTokens: 6,
      },
      rawOperationUsages,
    );
    const extractionScreenshot = extractionScreenshots[0];
    expect(extractionScreenshot).toMatchObject({
      type: "image",
      mimeType: "image/png",
    });
    if (!extractionScreenshot) throw new Error("Extraction screenshot was not received");
    expect([...Buffer.from(extractionScreenshot.data, "base64").subarray(0, 8)]).toStrictEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });

  it("observes actionable elements on a real page through the connected SDK", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const page =
      (await activeStagehand.browser.context.pages())[0] ??
      (await activeStagehand.browser.context.newPage());
    await page.goto(activeFixtureServer.url);
    rawOperationUsages.length = 0;

    const actions = await activeStagehand.observe("Find the Submit button", { page });

    expect(actions.data).toHaveLength(1);
    expect(actions.data[0]).toMatchObject({
      selector: expect.stringMatching(/^xpath=/),
      description: "Submit button",
      method: "click",
      arguments: [],
    });
    expectUsageCrossedRpc(
      actions.metadata.usage,
      {
        inputTokens: 11,
        outputTokens: 4,
        reasoningTokens: 2,
        cachedInputTokens: 3,
      },
      rawOperationUsages,
    );
  });

  it("tracks four identical Chrome tabs across rapid selection and closure", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const createdPages: Page[] = [];

    try {
      for (const marker of ["one", "two", "three", "four"]) {
        const page = await activeStagehand.browser.context.newPage(activeFixtureServer.url);
        createdPages.push(page);
        await page.evaluate((value: string) => {
          (
            globalThis as typeof globalThis & {
              __stagehandActivePageMarker?: string;
            }
          ).__stagehandActivePageMarker = value;
        }, marker);
        await waitForActivePageId(activeStagehand.browser.context, page.pageId);
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
        await activeStagehand.browser.context.setActivePage(page);
      }

      const selectedPage = await waitForActivePageId(
        activeStagehand.browser.context,
        createdPages[1]!.pageId,
      );
      await expect(selectedPage.evaluate("globalThis.__stagehandActivePageMarker")).resolves.toBe(
        "two",
      );

      await createdPages[0]!.close();
      await waitForPageRemoval(activeStagehand.browser.context, createdPages[0]!.pageId);
      await waitForActivePageId(activeStagehand.browser.context, createdPages[1]!.pageId);

      const closedActivePageId = createdPages[1]!.pageId;
      await createdPages[1]!.close();
      await waitForPageRemoval(activeStagehand.browser.context, closedActivePageId);
      const replacement = await waitForActivePageOtherThan(
        activeStagehand.browser.context,
        closedActivePageId,
      );
      const livePageIds = new Set(
        (await activeStagehand.browser.context.pages()).map((page) => page.pageId),
      );
      expect(livePageIds.has(replacement.pageId)).toBe(true);
    } finally {
      await closePages(createdPages);
    }
  }, 20_000);

  it("waits for an active popup to be registered before returning it", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const createdPages: Page[] = [];

    try {
      const opener = await activeStagehand.browser.context.newPage(activeFixtureServer.url);
      createdPages.push(opener);
      await activeStagehand.browser.context.setActivePage(opener);
      await waitForActivePageId(activeStagehand.browser.context, opener.pageId);

      const pageIdsBeforePopup = new Set(
        (await activeStagehand.browser.context.pages()).map((page) => page.pageId),
      );
      await opener.locator("#popup-button").click();

      const popup = await activeStagehand.browser.context.activePage();
      if (!popup) {
        throw new Error("Stagehand did not resolve the active popup");
      }
      createdPages.push(popup);
      await popup.waitForLoadState("load");

      expect(popup.pageId).not.toBe(opener.pageId);
      expect(pageIdsBeforePopup.has(popup.pageId)).toBe(false);
      await expect(popup.url()).resolves.toBe(activeFixtureServer.url);
      await expect(popup.title()).resolves.toBe("Stagehand SDK Smoke");

      await popup.close();
      await waitForPageRemoval(activeStagehand.browser.context, popup.pageId);
      const replacement = await waitForActivePageOtherThan(
        activeStagehand.browser.context,
        popup.pageId,
      );
      const livePageIds = new Set(
        (await activeStagehand.browser.context.pages()).map((page) => page.pageId),
      );
      expect(livePageIds.has(replacement.pageId)).toBe(true);

      await activeStagehand.browser.context.setActivePage(opener);
      await waitForActivePageId(activeStagehand.browser.context, opener.pageId);
    } finally {
      await closePages(createdPages);
    }
  }, 20_000);

  it("applies context scripts and headers to a new page", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const headersUrl = new URL("/headers", activeFixtureServer.url).href;

    await activeStagehand.browser.context.addInitScript({
      content: "globalThis.__stagehandContextSmokeInit = 'context-ready';",
    });
    await activeStagehand.browser.context.setExtraHTTPHeaders({
      "X-Stagehand-Context-Smoke": "context-header-value",
    });
    const page = await activeStagehand.browser.context.newPage();
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

    await activeStagehand.browser.context.addCookies([
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

    const addedCookies = await activeStagehand.browser.context.cookies(activeFixtureServer.url);
    expect(
      addedCookies
        .filter((cookie) => cookieNames.includes(cookie.name))
        .map((cookie) => cookie.name)
        .sort(),
    ).toStrictEqual([...cookieNames].sort());

    await activeStagehand.browser.context.clearCookies({ name: /-remove$/ });
    const filteredCookies = await activeStagehand.browser.context.cookies(activeFixtureServer.url);
    expect(filteredCookies.find((cookie) => cookie.name === keepCookieName)?.value).toBe("keep");
    expect(filteredCookies.some((cookie) => cookie.name === removeCookieName)).toBe(false);

    await activeStagehand.browser.context.clearCookies({ name: /^stagehand-context-/ });
    const clearedCookies = await activeStagehand.browser.context.cookies(activeFixtureServer.url);
    expect(clearedCookies.some((cookie) => cookieNames.includes(cookie.name))).toBe(false);
  });

  it("reads, writes, and clears clipboard text against an explicit page", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const page = await activeStagehand.browser.context.newPage(activeFixtureServer.url);

    await activeStagehand.browser.context.clipboard.writeText("stagehand clipboard smoke", {
      page,
    });
    await expect(activeStagehand.browser.context.clipboard.readText({ page })).resolves.toBe(
      "stagehand clipboard smoke",
    );
    await activeStagehand.browser.context.clipboard.clear({ page });
    await expect(activeStagehand.browser.context.clipboard.readText({ page })).resolves.toBe("");
  });

  it("acts on a real page through the connected SDK", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const page =
      (await activeStagehand.browser.context.pages())[0] ??
      (await activeStagehand.browser.context.newPage());
    await page.goto(activeFixtureServer.url);
    rawOperationUsages.length = 0;

    const result = await activeStagehand.act("Click the Submit button", { page });

    expect(result).toMatchObject({
      data: {
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
      },
      metadata: {
        cache: { status: "DISABLED" },
        usage: {
          inputTokens: 11,
          outputTokens: 4,
          reasoningTokens: 2,
          cachedInputTokens: 3,
          inferenceTimeMs: expect.any(Number),
        },
      },
    });
    expectUsageCrossedRpc(
      result.metadata.usage,
      {
        inputTokens: 11,
        outputTokens: 4,
        reasoningTokens: 2,
        cachedInputTokens: 3,
      },
      rawOperationUsages,
    );
    await expect(page.locator("#locator-output").textContent()).resolves.toBe("clicked:");
  });

  it("returns zero usage when a deterministic action avoids inference", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const page =
      (await activeStagehand.browser.context.pages())[0] ??
      (await activeStagehand.browser.context.newPage());
    await page.goto(activeFixtureServer.url);
    rawOperationUsages.length = 0;

    const result = await activeStagehand.act(
      {
        selector: "xpath=//*[@id='locator-button']",
        description: "Submit button",
        method: "click",
        arguments: [],
      },
      { page },
    );

    expect(result.data.success).toBe(true);
    expectUsageCrossedRpc(
      result.metadata.usage,
      {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
      },
      rawOperationUsages,
    );
    await expect(page.locator("#locator-output").textContent()).resolves.toBe("clicked:");
  });

  it("returns a read-only session metrics snapshot without double-counting operation usage", async () => {
    const activeStagehand = requireStagehand(stagehand);
    const activeFixtureServer = requireFixtureServer(fixtureServer);
    const page =
      (await activeStagehand.browser.context.pages())[0] ??
      (await activeStagehand.browser.context.newPage());
    await page.goto(activeFixtureServer.url);
    rawMetricsSnapshots.length = 0;

    const before = await activeStagehand.metrics();
    const observed = await activeStagehand.observe("Find the Submit button", { page });
    const action = observed.data[0];
    if (!action) throw new Error("Expected the smoke LLM to observe the Submit button");

    const deterministicAct = await activeStagehand.act(action, { page });
    expect(deterministicAct.metadata.usage).toStrictEqual({
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      inferenceTimeMs: 0,
    });

    const acted = await activeStagehand.act("Click the Submit button", { page });
    const extracted = await activeStagehand.extract(
      "Extract the page heading",
      z.object({ heading: z.string() }),
      { page },
    );
    const after = await activeStagehand.metrics();

    expectMetricsDelta(after, before, {
      act: acted.metadata.usage,
      extract: extracted.metadata.usage,
      observe: observed.metadata.usage,
    });

    await expect(activeStagehand.metrics()).resolves.toStrictEqual(after);
    expect(rawMetricsSnapshots.at(-1)).toStrictEqual(metricsToWire(after));
  });

  it("closes and reattaches Stagehand without closing the local browser or its pages", async () => {
    const firstStagehand = requireStagehand(stagehand);
    const activeBrowser = firstStagehand.browser;
    const page =
      (await activeBrowser.context.pages())[0] ?? (await activeBrowser.context.newPage());
    await page.goto(requireFixtureServer(fixtureServer).url, { waitUntil: "load" });
    const pageId = page.pageId;

    await expect(firstStagehand.close()).resolves.toBeUndefined();
    expect(activeBrowser.closed).toBe(false);

    const nextStagehand = await Stagehand.create({
      browser: activeBrowser,
      logging: { level: "off" },
    });
    stagehand = nextStagehand;
    const reattachedPage = (await activeBrowser.context.pages()).find(
      (candidate) => candidate.pageId === pageId,
    );

    expect(reattachedPage).toBeDefined();
    if (!reattachedPage) throw new Error("Reattached Stagehand did not retain the existing page");
    await expect(reattachedPage.title()).resolves.toBe("Stagehand SDK Smoke");

    await nextStagehand.close();
    stagehand = undefined;
    await activeBrowser.close();
    expect(activeBrowser.closed).toBe(true);
  });
});

function operationUsageFromRawRpcMessage(message: unknown): Record<string, unknown> | undefined {
  if (typeof message !== "string") return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed)) return undefined;
  const result = parsed.result;
  if (!isRecord(result)) return undefined;
  const metadata = result.metadata;
  if (!isRecord(metadata)) return undefined;
  const usage = metadata.usage;
  return isRecord(usage) ? usage : undefined;
}

function metricsFromRawRpcMessage(message: unknown): Record<string, unknown> | undefined {
  if (typeof message !== "string") return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || !isRecord(parsed.result)) return undefined;
  return "total_prompt_tokens" in parsed.result ? parsed.result : undefined;
}

function expectUsageCrossedRpc(
  apiUsage: StagehandResultUsage,
  expected: ExpectedOperationUsage,
  rawUsages: Record<string, unknown>[],
): void {
  expect(apiUsage).toStrictEqual({
    ...expected,
    inferenceTimeMs: expect.any(Number),
  });
  expect(apiUsage.inferenceTimeMs).toBeGreaterThanOrEqual(0);

  expect(rawUsages).toHaveLength(1);
  const rawUsage = rawUsages[0];
  expect(rawUsage).toStrictEqual({
    input_tokens: expected.inputTokens,
    output_tokens: expected.outputTokens,
    reasoning_tokens: expected.reasoningTokens,
    cached_input_tokens: expected.cachedInputTokens,
    inference_time_ms: expect.any(Number),
  });
  if (!rawUsage) throw new Error("Expected usage in the raw JSON-RPC response");
  expect(rawUsage.inference_time_ms).toBeGreaterThanOrEqual(0);
  for (const camelCaseKey of [
    "inputTokens",
    "outputTokens",
    "reasoningTokens",
    "cachedInputTokens",
    "inferenceTimeMs",
  ]) {
    expect(rawUsage).not.toHaveProperty(camelCaseKey);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectMetricsDelta(
  after: StagehandMetrics,
  before: StagehandMetrics,
  usage: Record<"act" | "extract" | "observe", StagehandResultUsage>,
): void {
  expect(after.actPromptTokens - before.actPromptTokens).toBe(usage.act.inputTokens);
  expect(after.actCompletionTokens - before.actCompletionTokens).toBe(usage.act.outputTokens);
  expect(after.actReasoningTokens - before.actReasoningTokens).toBe(usage.act.reasoningTokens);
  expect(after.actCachedInputTokens - before.actCachedInputTokens).toBe(
    usage.act.cachedInputTokens,
  );
  expect(after.actInferenceTimeMs - before.actInferenceTimeMs).toBe(usage.act.inferenceTimeMs);
  expect(after.extractPromptTokens - before.extractPromptTokens).toBe(usage.extract.inputTokens);
  expect(after.extractCompletionTokens - before.extractCompletionTokens).toBe(
    usage.extract.outputTokens,
  );
  expect(after.extractReasoningTokens - before.extractReasoningTokens).toBe(
    usage.extract.reasoningTokens,
  );
  expect(after.extractCachedInputTokens - before.extractCachedInputTokens).toBe(
    usage.extract.cachedInputTokens,
  );
  expect(after.extractInferenceTimeMs - before.extractInferenceTimeMs).toBe(
    usage.extract.inferenceTimeMs,
  );
  expect(after.observePromptTokens - before.observePromptTokens).toBe(usage.observe.inputTokens);
  expect(after.observeCompletionTokens - before.observeCompletionTokens).toBe(
    usage.observe.outputTokens,
  );
  expect(after.observeReasoningTokens - before.observeReasoningTokens).toBe(
    usage.observe.reasoningTokens,
  );
  expect(after.observeCachedInputTokens - before.observeCachedInputTokens).toBe(
    usage.observe.cachedInputTokens,
  );
  expect(after.observeInferenceTimeMs - before.observeInferenceTimeMs).toBe(
    usage.observe.inferenceTimeMs,
  );
  expect(after.totalPromptTokens - before.totalPromptTokens).toBe(
    usage.act.inputTokens + usage.extract.inputTokens + usage.observe.inputTokens,
  );
  expect(after.totalCompletionTokens - before.totalCompletionTokens).toBe(
    usage.act.outputTokens + usage.extract.outputTokens + usage.observe.outputTokens,
  );
  expect(after.totalReasoningTokens - before.totalReasoningTokens).toBe(
    usage.act.reasoningTokens + usage.extract.reasoningTokens + usage.observe.reasoningTokens,
  );
  expect(after.totalCachedInputTokens - before.totalCachedInputTokens).toBe(
    usage.act.cachedInputTokens + usage.extract.cachedInputTokens + usage.observe.cachedInputTokens,
  );
  expect(after.totalInferenceTimeMs - before.totalInferenceTimeMs).toBe(
    usage.act.inferenceTimeMs + usage.extract.inferenceTimeMs + usage.observe.inferenceTimeMs,
  );
}

function metricsToWire(metrics: StagehandMetrics): Record<string, number> {
  return Object.fromEntries(
    Object.entries(metrics).map(([key, value]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      value,
    ]),
  );
}

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
