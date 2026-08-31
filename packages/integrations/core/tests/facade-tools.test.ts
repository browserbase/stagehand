import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Stagehand } from "@browserbasehq/stagehand";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StagehandFacadeTools, type StagehandFacadeRunReport } from "../src/facade/tools.js";

type FakePage = ReturnType<typeof createFakePage>;

function createFakePage(initialUrl = "about:blank") {
  let currentUrl = initialUrl;
  return {
    pageId: "page-1",
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
      return undefined;
    }),
    screenshot: vi.fn(async () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47])),
    close: vi.fn(async () => undefined),
    on: vi.fn(async () => ({ unsubscribe: async () => undefined })),
    onCDP: vi.fn(async () => ({ unsubscribe: async () => undefined })),
    sendCDP: vi.fn(async () => ({})),
    snapshot: vi.fn(async () => ({ formattedTree: "", xpathMap: {} })),
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
