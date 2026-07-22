import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createV4DeterministicFacades,
  executeV4DeterministicSnippet,
  initializeV4DeterministicRuntime,
  loadV4StagehandConstructor,
  resolveV4SdkPath,
  STAGEHAND_V4_SDK_PATH_ENV,
} from "../../framework/v4CodeRuntime.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeSdkEntry(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evals-v4-sdk-"));
  tempDirs.push(dir);
  const entry = path.join(dir, "index.ts");
  fs.writeFileSync(entry, "export class Stagehand {}\n");
  return entry;
}

function createRawRuntime() {
  class RawLocator {
    readonly rpcClient = { secret: true };
    constructor(
      readonly selector: string,
      readonly index?: number,
    ) {}
    async click() {}
    async hover() {}
    async fill() {}
    async count() {
      return 1;
    }
    async isChecked() {
      return false;
    }
    async inputValue() {
      return "value";
    }
    async isVisible() {
      return true;
    }
    async innerText() {
      return "inner";
    }
    async innerHtml() {
      return "<span>inner</span>";
    }
    async textContent() {
      return "inner";
    }
    async scrollTo() {}
    async centroid() {
      return { x: 1, y: 2 };
    }
    async highlight() {}
    async sendClickEvent() {}
    async type() {}
    async selectOption() {
      return ["one"];
    }
    first() {
      return new RawLocator(this.selector, 0);
    }
    nth(index: number) {
      return new RawLocator(this.selector, index);
    }
  }

  class RawPage {
    readonly rpcClient = { secret: true };
    readonly pageId: string;
    readonly act = vi.fn();
    readonly extract = vi.fn();
    readonly observe = vi.fn();
    currentUrl = "about:blank";

    constructor(pageId: string) {
      this.pageId = pageId;
    }

    async goto(url: unknown) {
      this.currentUrl = String(url);
      return this;
    }
    async reload() {
      return this;
    }
    async goBack() {
      return this;
    }
    async goForward() {
      return this;
    }
    async click() {
      return "clicked";
    }
    async hover() {
      return "hovered";
    }
    async scroll() {
      return "scrolled";
    }
    async dragAndDrop() {
      return ["from", "to"];
    }
    async type() {}
    async keyPress() {}
    async evaluate() {
      return "evaluated";
    }
    async addInitScript() {}
    async setExtraHTTPHeaders() {}
    async setViewportSize() {}
    async waitForLoadState() {}
    async waitForTimeout() {}
    async waitForSelector() {
      return true;
    }
    async screenshot() {
      return Buffer.from("image");
    }
    async snapshot() {
      return { tree: "snapshot" };
    }
    async url() {
      return this.currentUrl;
    }
    async title() {
      return "Fake title";
    }
    async close() {}
    locator(selector: string) {
      return new RawLocator(selector);
    }
  }

  class RawContext {
    readonly rpcClient = { secret: true };
    readonly clipboard = {
      rpcClient: { secret: true },
      readText: vi.fn(async () => "clipboard text"),
      writeText: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
      paste: vi.fn(async () => {}),
      copy: vi.fn(async () => {}),
      cut: vi.fn(async () => {}),
    };
    readonly pagesList = [new RawPage("page-1")];
    active = this.pagesList[0];
    async pages() {
      return this.pagesList;
    }
    async newPage() {
      const page = new RawPage(`page-${this.pagesList.length + 1}`);
      this.pagesList.push(page);
      return page;
    }
    async activePage() {
      return this.active;
    }
    async setActivePage(page: RawPage) {
      this.active = page;
    }
    async addInitScript() {}
    async setExtraHTTPHeaders() {}
    async getDomainPolicy(): Promise<null> {
      return null;
    }
    async setDomainPolicy() {}
    async cookies(): Promise<unknown[]> {
      return [];
    }
    async addCookies() {}
    async clearCookies() {}
  }

  return { context: new RawContext() };
}

describe("deterministic V4 runtime", () => {
  it("resolves the unpublished SDK only from the neutral environment variable", () => {
    const entry = makeSdkEntry();
    expect(resolveV4SdkPath({ [STAGEHAND_V4_SDK_PATH_ENV]: entry })).toBe(
      entry,
    );
    expect(() => resolveV4SdkPath({})).toThrow(
      `${STAGEHAND_V4_SDK_PATH_ENV} must point to`,
    );
    expect(() =>
      resolveV4SdkPath({
        [STAGEHAND_V4_SDK_PATH_ENV]: path.join(entry, "missing"),
      }),
    ).toThrow(/does not point to a file/);
  });

  it("loads the Stagehand constructor through an injectable dynamic importer", async () => {
    const entry = makeSdkEntry();
    class FakeStagehand {}
    const importer = vi.fn(async () => ({ Stagehand: FakeStagehand }));

    const Stagehand = await loadV4StagehandConstructor(entry, importer);

    expect(Stagehand).toBe(FakeStagehand);
    expect(importer).toHaveBeenCalledWith(expect.stringMatching(/^file:/));
  });

  it("initializes local headless V4 without a model and closes exactly once", async () => {
    const raw = createRawRuntime();
    const init = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const constructorOptions: unknown[] = [];
    class FakeStagehand {
      readonly context = raw.context;
      constructor(options: unknown) {
        constructorOptions.push(options);
      }
      init = init;
      close = close;
    }

    const runtime = await initializeV4DeterministicRuntime({
      sdkPath: makeSdkEntry(),
      importModule: async () => ({ Stagehand: FakeStagehand }),
    });
    await runtime.close();
    await runtime.close();

    expect(constructorOptions).toEqual([
      { browser: { type: "local", headless: true } },
    ]);
    expect(init).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("makes concurrent close callers await the same teardown", async () => {
    const raw = createRawRuntime();
    let finishClose: (() => void) | undefined;
    const close = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishClose = resolve;
        }),
    );
    class FakeStagehand {
      readonly context = raw.context;
      async init() {}
      close = close;
    }

    const runtime = await initializeV4DeterministicRuntime({
      sdkPath: makeSdkEntry(),
      importModule: async () => ({ Stagehand: FakeStagehand }),
    });
    const firstClose = runtime.close();
    const secondClose = runtime.close();

    expect(firstClose).toBe(secondClose);
    expect(close).toHaveBeenCalledTimes(1);
    finishClose?.();
    await Promise.all([firstClose, secondClose]);
  });

  it("uses the controller-owned Chrome profile directory when provided", async () => {
    const raw = createRawRuntime();
    const constructorOptions: unknown[] = [];
    class FakeStagehand {
      readonly context = raw.context;
      constructor(options: unknown) {
        constructorOptions.push(options);
      }
      async init() {}
      async close() {}
    }

    const runtime = await initializeV4DeterministicRuntime({
      sdkPath: makeSdkEntry(),
      userDataDir: "/tmp/v4-controller-profile",
      importModule: async () => ({ Stagehand: FakeStagehand }),
    });
    await runtime.close();

    expect(constructorOptions).toEqual([
      {
        browser: {
          type: "local",
          headless: true,
          userDataDir: "/tmp/v4-controller-profile",
        },
      },
    ]);
  });

  it("executes snippets with wrapped pages and contexts", async () => {
    const raw = createRawRuntime();
    const { context, wrapPage } = createV4DeterministicFacades(raw.context);
    const page = wrapPage(await raw.context.activePage());

    const result = await executeV4DeterministicSnippet({
      code: `
        await page.goto(startUrl);
        const second = await context.newPage();
        await context.setActivePage(second);
        return {
          firstUrl: await page.url(),
          pages: (await context.pages()).map((candidate) => candidate.pageId),
          active: (await context.activePage()).pageId,
        title: await page.title(),
          clipboard: await context.clipboard.readText({ page: second }),
          taskId: task.id,
        };
      `,
      runtime: { page, context },
      startUrl: "https://example.com",
      task: { id: "task-1" },
      console,
    });

    expect(result).toEqual({
      firstUrl: "https://example.com",
      pages: ["page-1", "page-2"],
      active: "page-2",
      title: "Fake title",
      clipboard: "clipboard text",
      taskId: "task-1",
    });
    expect(raw.context.clipboard.readText).toHaveBeenCalledWith({
      page: raw.context.pagesList[1],
    });
  });

  it("does not expose AI methods, Stagehand, or RPC objects", async () => {
    const raw = createRawRuntime();
    const { context, wrapPage } = createV4DeterministicFacades(raw.context);
    const page = wrapPage(await raw.context.activePage());

    const result = await executeV4DeterministicSnippet({
      code: `return {
        pageAct: typeof page.act,
        pageExtract: typeof page.extract,
        pageObserve: typeof page.observe,
        pageRpc: typeof page.rpcClient,
        contextRpc: typeof context.rpcClient,
        contextClose: typeof context.close,
        clipboardRpc: typeof context.clipboard.rpcClient,
        stagehand: typeof stagehand,
        locatorRpc: typeof page.locator("button").rpcClient,
      };`,
      runtime: { page, context },
      startUrl: "https://example.com",
      task: {},
      console,
    });

    expect(result).toEqual({
      pageAct: "undefined",
      pageExtract: "undefined",
      pageObserve: "undefined",
      pageRpc: "undefined",
      contextRpc: "undefined",
      contextClose: "undefined",
      clipboardRpc: "undefined",
      stagehand: "undefined",
      locatorRpc: "undefined",
    });
  });

  it("cleans up when V4 initialization fails", async () => {
    const close = vi.fn(async () => {});
    class FailingStagehand {
      readonly context = createRawRuntime().context;
      async init() {
        throw new Error("init failed");
      }
      close = close;
    }

    await expect(
      initializeV4DeterministicRuntime({
        sdkPath: makeSdkEntry(),
        importModule: async () => ({ Stagehand: FailingStagehand }),
      }),
    ).rejects.toThrow("init failed");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
