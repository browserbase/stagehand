import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Stagehand } from "@browserbasehq/stagehand";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_SESSION_LOST_ERROR_PREFIX,
  type FacadeSessionLoss,
} from "../src/facade/contract.js";
import {
  StagehandFacadeSessionLostError,
  StagehandFacadeTools,
  type StagehandFacadeRunReport,
} from "../src/facade/tools.js";

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
  const context = {
    activePage: vi.fn(async (): Promise<FakePage | undefined> => page),
    newPage: vi.fn(async () => page),
    pages: vi.fn(async () => [page]),
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
    stagehand: { browser: { context }, experimentalBatch } as unknown as Stagehand,
    context,
    experimentalBatch,
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

  it("retries without a page target when the batch page vanished", async () => {
    const page = createFakePage();
    const { stagehand, context, experimentalBatch } = createFakeStagehand(page);
    experimentalBatch.mockRejectedValueOnce(
      new Error("Stagehand callback batch page was not found"),
    );
    // First activePage() feeds the batch target; the second (inside the
    // fallback) sees the tab gone.
    context.activePage.mockResolvedValueOnce(page).mockResolvedValueOnce(undefined);
    const tools = new StagehandFacadeTools(stagehand);

    await expect(tools.run(`return 42;`)).resolves.toBe(42);
    expect(context.newPage).toHaveBeenCalledTimes(1);
    expect(experimentalBatch).toHaveBeenCalledTimes(2);
    expect(experimentalBatch.mock.calls[1][2]).toStrictEqual({ timeout: 60_000 });
  });

  it("propagates other batch failures unchanged", async () => {
    const { stagehand, experimentalBatch, context } = createFakeStagehand(createFakePage());
    experimentalBatch.mockRejectedValueOnce(new Error("extension disconnected"));
    const tools = new StagehandFacadeTools(stagehand);

    await expect(tools.run(`return 1;`)).rejects.toThrow("extension disconnected");
    expect(context.newPage).not.toHaveBeenCalled();
  });
});

describe("StagehandFacadeTools.run frameLocator", () => {
  function setup(world = createFakeWorld()) {
    const page = createFakePage("https://imgur.com/memegen", world);
    const { stagehand } = createFakeStagehand(page);
    return { page, world, tools: new StagehandFacadeTools(stagehand) };
  }

  it("compiles css tails onto iframe hop selectors", async () => {
    const { page, world, tools } = setup();
    await tools.run(`
      const frame = page.frameLocator('iframe[src*="picsart"]');
      await frame.locator("button.background").click();
      await frame.getByPlaceholder("Search").fill("frog");
      await frame.getByTestId("apply").hover();
      return "ok";
    `);
    const selectors = page.locator.mock.calls.map(([selector]) => selector);
    expect(selectors).toContain('iframe[src*="picsart"] >> button.background');
    expect(selectors).toContain('iframe[src*="picsart"] >> [placeholder*="Search" i]');
    expect(selectors).toContain('iframe[src*="picsart"] >> [data-testid="apply"]');
    const clicked = world.locators.find((l) => l.selector.endsWith("button.background"));
    expect(clicked?.click).toHaveBeenCalledTimes(1);
    const filled = world.locators.find((l) => l.selector.includes("placeholder"));
    expect(filled?.fill).toHaveBeenCalledWith("frog");
  });

  it("chains nested frameLocator hops and descendant selectors", async () => {
    const { page, tools } = setup();
    await tools.run(`
      await page.frameLocator("#outer").frameLocator("#inner").locator("form").locator("input[name=q]").fill("x");
      await page.locator("iframe.editor").contentFrame().getByText("Add text").click();
      return await page.frameLocator("#outer").locator("li").count();
    `);
    const selectors = page.locator.mock.calls.map(([selector]) => selector);
    expect(selectors).toContain("#outer >> #inner >> form input[name=q]");
    expect(selectors).toContain("iframe.editor >> text=Add text");
    expect(selectors).toContain("#outer >> li");
  });

  it("applies first()/nth()/last() through the raw locator", async () => {
    const world = createFakeWorld();
    world.counts["#editor >> button"] = 3;
    const { world: w, tools } = setup(world);
    await tools
      .run(`
      const buttons = page.frameLocator("#editor").locator("button");
      await buttons.first().click();
      await buttons.last().hover();
      await buttons.nth(1).click();
      return await buttons.count();
    `)
      .then((count) => expect(count).toBe(3));
    const used = w.locators.filter((l) => l.nthIndex !== undefined);
    expect(used.map((l) => l.nthIndex).sort()).toStrictEqual([0, 1, 2]);
  });

  it("resolves getByRole inside a cross-origin frame through the accessibility snapshot", async () => {
    const world = createFakeWorld();
    world.snapshot = {
      formattedTree: [
        "[0-1] RootWebArea: imgur",
        "  [0-9] button: Upload",
        "  [1-4] button: Background",
        "  [1-5] textbox: Meme text",
        "  [1-6] StaticText: Enjoy your life",
      ].join("\n"),
      xpathMap: {
        "0-9": "/html[1]/body[1]/div[1]/button[1]",
        "1-4": "/html[1]/body[1]/div[2]/iframe[1]/html[1]/body[1]/div[1]/button[2]",
        "1-5": "/html[1]/body[1]/div[2]/iframe[1]/html[1]/body[1]/div[1]/input[1]",
        "1-6": "/html[1]/body[1]/div[2]/iframe[1]/html[1]/body[1]/p[1]/text()[1]",
      },
    };
    const { page, world: w, tools } = setup(world);
    const result = await tools.run(`
      const frame = page.frameLocator("iframe");
      await frame.getByRole("button", { name: "Background" }).click();
      await frame.getByLabel("Meme text").fill("Enjoy your life");
      return {
        exact: await frame.getByText("Enjoy your life", { exact: true }).count(),
        uploadInsideFrame: await frame.getByRole("button", { name: "Upload" }).count(),
      };
    `);
    expect(result).toStrictEqual({ exact: 1, uploadInsideFrame: 0 });
    const selectors = page.locator.mock.calls.map(([selector]) => selector);
    expect(selectors).toContain(
      "xpath=/html[1]/body[1]/div[2]/iframe[1]/html[1]/body[1]/div[1]/button[2]",
    );
    expect(selectors).toContain(
      "xpath=/html[1]/body[1]/div[2]/iframe[1]/html[1]/body[1]/div[1]/input[1]",
    );
    expect(w.locators.find((l) => l.selector.endsWith("button[2]"))?.click).toHaveBeenCalled();
    expect(page.snapshot).toHaveBeenCalledWith({ includeIframes: true });
  });

  it("reports strict-mode violations inside frames with candidate names", async () => {
    const world = createFakeWorld();
    world.snapshot = {
      formattedTree: ["[1-4] button: Save", "[1-7] button: Save draft"].join("\n"),
      xpathMap: {
        "1-4": "/html[1]/body[1]/div[2]/iframe[1]/html[1]/body[1]/button[1]",
        "1-7": "/html[1]/body[1]/div[2]/iframe[1]/html[1]/body[1]/button[2]",
      },
    };
    const { tools } = setup(world);
    await expect(
      tools.run(`await page.frameLocator("iframe").getByRole("button", { name: "Save" }).click();`),
    ).rejects.toThrow(
      /strict mode violation: 2 elements matched\. Candidates: \[0\] button "Save"; \[1\] button "Save draft"\..*\.first\(\)/u,
    );
  });

  it("explains layout-object failures instead of surfacing the CDP code", async () => {
    const world = createFakeWorld();
    world.clickErrors["#editor >> .hidden"] = new Error(
      "-32000 Node does not have a layout object",
    );
    const { tools } = setup(world);
    await expect(
      tools.run(`await page.frameLocator("#editor").locator(".hidden").click({ timeout: 700 });`),
    ).rejects.toThrow(
      /not rendered \(no layout box.*Original: -32000 Node does not have a layout object/u,
    );
  });

  it("rejects operations that cannot cross the frame boundary with guidance", async () => {
    const { tools } = setup();
    await expect(
      tools.run(
        `await page.frameLocator("#editor").locator("div").filter({ hasText: "x" }).click();`,
      ),
    ).rejects.toThrow(/locator\.filter is not supported inside frameLocator\(\)/u);
    await expect(
      tools.run(`await page.frameLocator("#editor").locator("div").evaluate(() => 1);`),
    ).rejects.toThrow(/locator\.evaluate is not supported inside frameLocator\(\)/u);
    await expect(
      tools.run(`await page.frameLocator("#editor").locator("input").getAttribute("placeholder");`),
    ).rejects.toThrow(
      /locator\.getAttribute is not supported inside frameLocator\(\).*snapshot tool/u,
    );
    await expect(tools.run(`page.frameLocator("#editor").nth(2);`)).rejects.toThrow(
      /nth is not supported inside frameLocator/u,
    );
  });
});

describe("StagehandFacadeTools.runActions", () => {
  it("accepts a snapshot id without its frame-ordinal prefix when unambiguous", async () => {
    const world = createFakeWorld();
    world.snapshot = {
      formattedTree: "[0-7812] textbox: Location\n[0-9000] button: Go",
      xpathMap: { "0-7812": "/html[1]/body[1]/input[1]", "0-9000": "/html[1]/body[1]/button[1]" },
    };
    const page = createFakePage("https://example.com", world);
    const { stagehand, experimentalBatch } = createFakeStagehand(page);
    const tools = new StagehandFacadeTools(stagehand);
    await tools.snapshot();
    await expect(tools.runActions([{ op: "click", id: "7812" }])).resolves.toStrictEqual({
      completed: 1,
      url: "https://example.com",
    });
    expect(experimentalBatch.mock.calls.at(-1)?.[1]).toStrictEqual({
      actions: [{ op: "click", id: "7812", selector: "xpath=/html[1]/body[1]/input[1]" }],
    });
  });

  it("still rejects ids that are missing or ambiguous", async () => {
    const world = createFakeWorld();
    world.snapshot = {
      formattedTree: "[0-12] button: A\n[1-12] button: B",
      xpathMap: {
        "0-12": "/html[1]/body[1]/button[1]",
        "1-12": "/html[1]/body[1]/iframe[1]/html[1]/body[1]/button[1]",
      },
    };
    const page = createFakePage("https://example.com", world);
    const { stagehand } = createFakeStagehand(page);
    const tools = new StagehandFacadeTools(stagehand);
    await tools.snapshot();
    await expect(tools.runActions([{ op: "click", id: "12" }])).rejects.toThrow(
      'Snapshot ID "12" is stale or not actionable',
    );
    await expect(tools.runActions([{ op: "click", id: "99" }])).rejects.toThrow(
      'Snapshot ID "99" is stale or not actionable',
    );
  });

  it("retries a snapshot action once when the node has no layout box yet", async () => {
    const world = createFakeWorld();
    world.snapshot = {
      formattedTree: "[0-1] button: Go",
      xpathMap: { "0-1": "/html[1]/body[1]/button[1]" },
    };
    const page = createFakePage("https://example.com", world);
    const { stagehand, experimentalBatch } = createFakeStagehand(page);
    const tools = new StagehandFacadeTools(stagehand);
    await tools.snapshot();
    experimentalBatch.mockRejectedValueOnce(new Error("-32000 Node does not have a layout object"));
    experimentalBatch.mockResolvedValueOnce({ completed: 1 });
    await expect(tools.runActions([{ op: "click", id: "0-1" }])).resolves.toStrictEqual({
      completed: 1,
      url: "https://example.com",
    });
    expect(page.waitForTimeout).toHaveBeenCalledWith(250);
    expect(experimentalBatch).toHaveBeenCalledTimes(2);
  });
});

describe("StagehandFacadeTools session loss", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function batchTimeoutError() {
    const error = new Error("stagehand.experimentalBatch() received no response within 75000ms");
    error.name = "StagehandBatchTimeoutError";
    Object.assign(error, { timeout: 60_000, clientTimeout: 75_000 });
    return error;
  }

  it("turns a batch client deadline into the terminal error and stays dead", async () => {
    const page = createFakePage();
    const { stagehand, experimentalBatch, context } = createFakeStagehand(page);
    experimentalBatch.mockRejectedValueOnce(batchTimeoutError());
    const losses: FacadeSessionLoss[] = [];
    const tools = new StagehandFacadeTools(stagehand, {
      onSessionLost: (loss) => losses.push(loss),
    });

    const first = tools.run("await page.getByRole('button', { name: 'Search now' }).click();");
    await expect(first).rejects.toBeInstanceOf(StagehandFacadeSessionLostError);
    await expect(first).rejects.toThrow(
      "Browser session lost (batch received no response within 75000ms). The task cannot continue; report your final result now.",
    );
    expect(losses).toEqual([
      { cause: "batch received no response within 75000ms", tool: "run", at: expect.any(String) },
    ]);
    expect(tools.sessionLoss).toBe(losses[0]);

    // Every later call gets the same terminal answer without touching the browser.
    const callsBefore = context.activePage.mock.calls.length;
    await expect(tools.snapshot()).rejects.toThrow(BROWSER_SESSION_LOST_ERROR_PREFIX);
    await expect(tools.run("return 1;")).rejects.toThrow(BROWSER_SESSION_LOST_ERROR_PREFIX);
    await expect(tools.screenshot()).rejects.toThrow(BROWSER_SESSION_LOST_ERROR_PREFIX);
    expect(context.activePage.mock.calls.length).toBe(callsBefore);
    expect(experimentalBatch).toHaveBeenCalledTimes(1);
    expect(losses).toHaveLength(1);
  });

  it("treats a closed RPC/CDP transport as session loss", async () => {
    const page = createFakePage();
    const { stagehand, context } = createFakeStagehand(page);
    context.activePage.mockRejectedValueOnce(new Error("RPC client is closed"));
    const tools = new StagehandFacadeTools(stagehand);

    await expect(tools.snapshot()).rejects.toThrow("Browser session lost (RPC client closed).");
    expect(tools.sessionLoss?.tool).toBe("snapshot");
  });

  it("does not treat an executor-side batch timeout or agent code errors as session loss", async () => {
    const page = createFakePage();
    const { stagehand, experimentalBatch } = createFakeStagehand(page);
    experimentalBatch.mockRejectedValueOnce(
      new Error("Stagehand callback batch timed out after 60000ms"),
    );
    const tools = new StagehandFacadeTools(stagehand);

    await expect(tools.run("return 1;")).rejects.toThrow("callback batch timed out");
    expect(tools.sessionLoss).toBeUndefined();
    await expect(tools.run("throw new Error('RPC client is closed');")).rejects.toThrow(
      "RPC client is closed",
    );
    expect(tools.sessionLoss).toBeUndefined();
    await expect(tools.run("return 2;")).resolves.toBe(2);
  });

  it("bounds a snapshot that never answers and marks the session lost", async () => {
    vi.useFakeTimers();
    const page = createFakePage();
    page.snapshot.mockImplementationOnce(() => new Promise(() => undefined));
    const { stagehand } = createFakeStagehand(page);
    const tools = new StagehandFacadeTools(stagehand);

    const pending = tools.snapshot();
    const rejection = expect(pending).rejects.toThrow(
      "Browser session lost (page.snapshot received no response within 120000ms).",
    );
    await vi.advanceTimersByTimeAsync(120_000);
    await rejection;
    expect(tools.sessionLoss?.cause).toBe("page.snapshot received no response within 120000ms");
  });
});
