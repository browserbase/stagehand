import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type Stagehand } from "@browserbasehq/stagehand";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StagehandFacadeTools, type StagehandFacadeRunReport } from "../src/facade/tools.js";

type FakePage = ReturnType<typeof createFakePage>;

type FakeRawLocator = {
  selector: string;
  nthIndex?: number;
  click: ReturnType<typeof vi.fn>;
  hover: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  type: ReturnType<typeof vi.fn>;
  selectOption: ReturnType<typeof vi.fn>;
  setInputFiles: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  nth: (index: number) => FakeRawLocator;
  isVisible: ReturnType<typeof vi.fn>;
  isChecked: ReturnType<typeof vi.fn>;
  inputValue: ReturnType<typeof vi.fn>;
  innerText: ReturnType<typeof vi.fn>;
  innerHtml: ReturnType<typeof vi.fn>;
  textContent: ReturnType<typeof vi.fn>;
  scrollTo: ReturnType<typeof vi.fn>;
};

type FakeFrameWorld = {
  /** Match count per raw selector (default 1). */
  counts: Record<string, number>;
  /** Error thrown by click() per raw selector. */
  clickErrors: Record<string, Error>;
  /** Absolute XPath returned for the first-hop iframe host. */
  iframeXPath: string | null;
  snapshot: { formattedTree: string; xpathMap: Record<string, string> };
  locators: FakeRawLocator[];
};

function createFakeWorld(): FakeFrameWorld {
  return {
    counts: {},
    clickErrors: {},
    iframeXPath: "/html[1]/body[1]/div[2]/iframe[1]",
    snapshot: { formattedTree: "", xpathMap: {} },
    locators: [],
  };
}

function createFakePage(initialUrl = "about:blank", world: FakeFrameWorld = createFakeWorld()) {
  let currentUrl = initialUrl;
  const makeLocator = (selector: string, nthIndex?: number): FakeRawLocator => {
    const locator: FakeRawLocator = {
      selector,
      ...(nthIndex === undefined ? {} : { nthIndex }),
      click: vi.fn(async () => {
        const error = world.clickErrors[selector];
        if (error) throw error;
      }),
      hover: vi.fn(async () => undefined),
      fill: vi.fn(async () => undefined),
      type: vi.fn(async () => undefined),
      selectOption: vi.fn(async (values: string | string[]) =>
        Array.isArray(values) ? values : [values],
      ),
      setInputFiles: vi.fn(async () => undefined),
      count: vi.fn(async () => world.counts[selector] ?? 1),
      nth: (index: number) => makeLocator(selector, index),
      isVisible: vi.fn(async () => true),
      isChecked: vi.fn(async () => false),
      inputValue: vi.fn(async () => "value"),
      innerText: vi.fn(async () => "inner"),
      innerHtml: vi.fn(async () => "<b>inner</b>"),
      textContent: vi.fn(async () => "text"),
      scrollTo: vi.fn(async () => undefined),
    };
    world.locators.push(locator);
    return locator;
  };
  return {
    pageId: "page-1",
    locator: vi.fn((selector: string) => makeLocator(selector)),
    keyPress: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    goto: vi.fn(async (url: string) => {
      currentUrl = url;
      return null;
    }),
    url: vi.fn(async () => currentUrl),
    title: vi.fn(async () => "Example Domain"),
    evaluate: vi.fn(async (expression: unknown) => {
      if (typeof expression === "string" && expression.includes("innerWidth")) {
        return { width: 1280, height: 720 };
      }
      if (typeof expression === "string" && expression.includes("previousElementSibling")) {
        return world.iframeXPath;
      }
      return undefined;
    }),
    screenshot: vi.fn(async () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47])),
    close: vi.fn(async () => undefined),
    on: vi.fn(async () => ({ unsubscribe: async () => undefined })),
    onCDP: vi.fn(async () => ({ unsubscribe: async () => undefined })),
    sendCDP: vi.fn(async () => ({})),
    snapshot: vi.fn(async () => world.snapshot),
  };
}

/**
 * Stands in for Stagehand: experimentalBatch() invokes the callback in-process
 * with a batch-shaped { page, context } so the Playwright compat runtime runs
 * exactly as it would inside the extension, minus the browser.
 */
function createFakeStagehand(page: FakePage) {
  // The facade opens a hidden about:blank keeper tab on first use; give it its
  // own identity so tests can tell it apart from the agent's page.
  const keeper = { ...createFakePage("about:blank"), pageId: "keeper-page" };
  const context = {
    activePage: vi.fn(async (): Promise<FakePage | undefined> => page),
    newPage: vi.fn(async (url?: string) => (url === "about:blank" ? keeper : page)),
    pages: vi.fn(async () => [page, keeper]),
    setActivePage: vi.fn(async () => undefined),
  };
  const experimentalBatch = vi.fn(
    async (
      callback: (stagehand: unknown, input: unknown) => Promise<unknown>,
      input: unknown,
      _options: { page?: unknown; timeout: number },
    ) => callback({ page, context }, input),
  );
  return {
    stagehand: {
      browser: { context, close: vi.fn(async () => undefined) },
      close: vi.fn(async () => undefined),
      experimentalBatch,
    } as unknown as Stagehand,
    context,
    experimentalBatch,
    keeper,
  };
}

describe("StagehandFacadeTools.run (Playwright batch surface)", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fsp.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("executes Playwright-style code with page, context, and browser in scope", async () => {
    const page = createFakePage();
    const { stagehand, experimentalBatch } = createFakeStagehand(page);
    const reports: StagehandFacadeRunReport[] = [];
    const tools = new StagehandFacadeTools(stagehand, { onRunReport: (r) => reports.push(r) });

    const result = await tools.run(`
      await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
      return {
        url: page.url(),
        title: await page.title(),
        contexts: browser.contexts().length,
        sameContext: browser.contexts()[0] === context,
        connected: browser.isConnected(),
      };
    `);

    expect(result).toStrictEqual({
      url: "https://example.com",
      title: "Example Domain",
      contexts: 1,
      sameContext: true,
      connected: true,
    });
    expect(page.goto).toHaveBeenCalledWith("https://example.com", {
      waitUntil: "domcontentloaded",
    });
    expect(experimentalBatch).toHaveBeenCalledTimes(1);
    expect(experimentalBatch.mock.calls[0][2]).toStrictEqual({ page, timeout: 60_000 });
    expect(reports).toHaveLength(1);
    expect(reports[0].telemetry.calls["page.goto"]).toBe(1);
    expect(reports[0].closeRequested).toBe(false);
    expect(reports[0].batchRuntimeMs).toBeGreaterThanOrEqual(0);
    expect(reports[0].batchRoundTripMs).toBeGreaterThanOrEqual(reports[0].batchRuntimeMs);
  });

  it("does not expose Stagehand AI methods or the raw client to the snippet", async () => {
    const { stagehand } = createFakeStagehand(createFakePage());
    const tools = new StagehandFacadeTools(stagehand);

    // Unknown members of the guarded page are throwing stubs, so a snippet
    // that reaches for Stagehand's AI methods fails loudly instead of silently.
    await expect(tools.run(`await page.act("click the button");`)).rejects.toThrow(/act/u);
    await expect(tools.run(`return typeof stagehand;`)).resolves.toBe("undefined");
  });

  it("rethrows snippet errors with their name and message", async () => {
    const { stagehand } = createFakeStagehand(createFakePage());
    const reports: StagehandFacadeRunReport[] = [];
    const tools = new StagehandFacadeTools(stagehand, { onRunReport: (r) => reports.push(r) });

    await expect(
      tools.run(`const error = new TypeError("boom"); throw error;`),
    ).rejects.toMatchObject({ name: "TypeError", message: "boom" });
    // The report still fires so hosts can see telemetry for failed batches.
    expect(reports).toHaveLength(1);
  });

  it("writes page.screenshot({ path }) artifacts under artifactRoot", async () => {
    const page = createFakePage();
    const { stagehand } = createFakeStagehand(page);
    const artifactRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "facade-tools-"));
    tempDirs.push(artifactRoot);
    const tools = new StagehandFacadeTools(stagehand, { artifactRoot });

    await tools.run(`await page.screenshot({ path: "shots/first.png" }); return "ok";`);

    const written = await fsp.readFile(path.join(artifactRoot, "shots", "first.png"));
    expect([...written]).toStrictEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(page.screenshot).toHaveBeenCalledTimes(1);
  });

  it("reports browser.close() without closing the page inside the batch", async () => {
    const page = createFakePage();
    const { stagehand } = createFakeStagehand(page);
    const reports: StagehandFacadeRunReport[] = [];
    const tools = new StagehandFacadeTools(stagehand, { onRunReport: (r) => reports.push(r) });

    await expect(tools.run(`await browser.close(); return browser.isConnected();`)).resolves.toBe(
      false,
    );
    expect(page.close).not.toHaveBeenCalled();
    expect(reports[0].closeRequested).toBe(true);
    expect(reports[0].telemetry.calls["browser.close"]).toBe(1);
  });

  it("closes owned resources only after the batch finishes and refuses later calls", async () => {
    const { stagehand, experimentalBatch } = createFakeStagehand(createFakePage());
    const tools = new StagehandFacadeTools(stagehand);
    await expect(tools.run(`await browser.close(); return "finished";`)).resolves.toBe("finished");
    expect(stagehand.close).toHaveBeenCalledOnce();
    expect(stagehand.browser.close).toHaveBeenCalledOnce();
    await tools.close();
    await expect(tools.snapshot()).rejects.toThrow("browser is closed");
    expect(experimentalBatch).toHaveBeenCalledOnce();
    expect(stagehand.browser.close).toHaveBeenCalledOnce();
  });

  it("still releases the browser when client cleanup fails", async () => {
    const { stagehand } = createFakeStagehand(createFakePage());
    vi.mocked(stagehand.close).mockRejectedValue(new Error("apiKey=private-key"));
    const tools = new StagehandFacadeTools(stagehand);
    await expect(tools.run(`await browser.close();`)).rejects.toThrow(
      "Failed to close the Stagehand facade browser.",
    );
    expect(stagehand.browser.close).toHaveBeenCalledOnce();
    await expect(tools.run("return 1")).rejects.toThrow("browser is closed");
  });

  it("honors browser.close even when subsequent agent code throws", async () => {
    const { stagehand } = createFakeStagehand(createFakePage());
    const tools = new StagehandFacadeTools(stagehand);
    await expect(
      tools.run(`await browser.close(); throw new Error("agent failure");`),
    ).rejects.toThrow("agent failure");
    expect(stagehand.browser.close).toHaveBeenCalledOnce();
  });

  it("confines artifacts across traversal, absolute paths, and symlinks", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "facade-paths-"));
    tempDirs.push(root);
    const artifactRoot = path.join(root, "artifacts");
    await fsp.mkdir(artifactRoot);
    const outside = path.join(root, "outside");
    await fsp.mkdir(outside);
    const existing = path.join(outside, "existing.png");
    await fsp.writeFile(existing, "preserve");
    await fsp.symlink(outside, path.join(artifactRoot, "linked-directory"));
    await fsp.symlink(existing, path.join(artifactRoot, "linked-file.png"));
    const { stagehand } = createFakeStagehand(createFakePage());
    const tools = new StagehandFacadeTools(stagehand, { artifactRoot });
    for (const requestedPath of [
      "../escape.png",
      path.join(outside, "absolute.png"),
      "linked-directory/created/sub.png",
      "linked-file.png",
    ]) {
      await expect(
        tools.run(`await page.screenshot({ path: ${JSON.stringify(requestedPath)} });`),
      ).rejects.toThrow();
    }
    expect(await fsp.readdir(outside)).toEqual(["existing.png"]);
    expect(await fsp.readFile(existing, "utf8")).toBe("preserve");
    expect(await fsp.readdir(root)).toEqual(["artifacts", "outside"]);
  });

  it("retries without a page target when the batch page vanished", async () => {
    const page = createFakePage();
    const { stagehand, context, experimentalBatch, keeper } = createFakeStagehand(page);
    experimentalBatch.mockRejectedValueOnce(
      new Error("Stagehand callback batch page was not found"),
    );
    // activePage(): keeper setup, then the batch target, then (inside the
    // fallback) the tab is gone and only the keeper is left.
    context.activePage
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce(undefined);
    context.pages.mockResolvedValueOnce([keeper]);
    const tools = new StagehandFacadeTools(stagehand);

    await expect(tools.run(`return 42;`)).resolves.toBe(42);
    // One newPage for the keeper, one for the replacement tab.
    expect(context.newPage).toHaveBeenCalledTimes(2);
    expect(context.newPage.mock.calls[1]).toStrictEqual([]);
    expect(experimentalBatch).toHaveBeenCalledTimes(2);
    expect(experimentalBatch.mock.calls[1][2]).toStrictEqual({ page, timeout: 60_000 });
  });

  it("propagates other batch failures unchanged", async () => {
    const { stagehand, experimentalBatch, context } = createFakeStagehand(createFakePage());
    experimentalBatch.mockRejectedValueOnce(new Error("extension disconnected"));
    const tools = new StagehandFacadeTools(stagehand);

    await expect(tools.run(`return 1;`)).rejects.toThrow("extension disconnected");
    // Only the keeper tab was opened; no replacement page for an ordinary failure.
    expect(context.newPage).toHaveBeenCalledTimes(1);
    expect(context.newPage).toHaveBeenCalledWith("about:blank");
  });
});

describe("StagehandFacadeTools keeper tab", () => {
  it("opens a hidden about:blank keeper once and hands focus back to the agent's page", async () => {
    const page = createFakePage("https://example.com");
    const { stagehand, context, keeper } = createFakeStagehand(page);
    const tools = new StagehandFacadeTools(stagehand);

    await tools.run(`return 1;`);
    await tools.run(`return 2;`);

    expect(context.newPage).toHaveBeenCalledTimes(1);
    expect(context.newPage).toHaveBeenCalledWith("about:blank");
    expect(context.setActivePage).toHaveBeenCalledWith(page);
    // The keeper never reaches agent code.
    await expect(tools.run(`return context.pages().length;`)).resolves.toBe(1);
    expect(keeper.pageId).toBe("keeper-page");
  });

  it("keeps the keeper hidden after navigation and timeout rediscovery", async () => {
    const { stagehand } = createFakeStagehand(createFakePage());
    const tools = new StagehandFacadeTools(stagehand);
    await expect(
      tools.run(
        `await page.goto("https://example.com"); await page.waitForTimeout(1); return context.pages().length;`,
      ),
    ).resolves.toBe(1);
  });

  it("gives the agent a fresh page when its only tab is gone and the keeper remains", async () => {
    const page = createFakePage("https://example.com");
    const { stagehand, context, keeper } = createFakeStagehand(page);
    const tools = new StagehandFacadeTools(stagehand);
    await tools.run(`return 1;`);

    // Renderer crash closed the agent's tab: only the keeper is left and active.
    context.activePage.mockResolvedValueOnce(keeper);
    context.pages.mockResolvedValueOnce([keeper]);
    const replacement = createFakePage("about:blank");
    context.newPage.mockResolvedValueOnce(replacement);

    await tools.snapshot();
    expect(context.newPage).toHaveBeenLastCalledWith();
    expect(context.setActivePage).toHaveBeenLastCalledWith(replacement);
  });

  it("does not emit the hidden keeper as a new page event", async () => {
    const page = createFakePage();
    const { stagehand } = createFakeStagehand(page);
    const tools = new StagehandFacadeTools(stagehand);
    await expect(tools.run('await context.waitForEvent("page", { timeout: 1 });')).rejects.toThrow(
      /timed out|timeout/iu,
    );
  });

  it("can be disabled", async () => {
    const { stagehand, context } = createFakeStagehand(createFakePage());
    const tools = new StagehandFacadeTools(stagehand, { keeperPage: false });
    await tools.run(`return 1;`);
    expect(context.newPage).not.toHaveBeenCalled();
  });
});
