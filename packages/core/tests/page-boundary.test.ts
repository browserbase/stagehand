import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v3";
import {
  Stagehand,
  StagehandInvalidArgumentError,
  type ActResult,
  type AgentResult,
  type AnyPage,
  type Page,
  type V3Options,
} from "../dist/index.js";

const baseOptions: Pick<V3Options, "env" | "disableAPI" | "disablePino"> = {
  env: "LOCAL",
  disableAPI: true,
  disablePino: true,
};

const defaultActResult: ActResult = {
  success: true,
  message: "ok",
  actionDescription: "",
  actions: [],
};
const defaultAgentResult: AgentResult = {
  success: true,
  message: "",
  actions: [],
  completed: true,
};

function createStagehand(overrides: Partial<V3Options> = {}): Stagehand {
  return new Stagehand({ ...baseOptions, ...overrides });
}

function createInternalPage(frameId: string): Page {
  return {
    mainFrameId: () => frameId,
  } as unknown as Page;
}

function stubActCache(instance: Stagehand): void {
  Reflect.set(instance, "actCache", {
    enabled: false,
    prepareContext: vi.fn(),
    tryReplay: vi.fn(),
    store: vi.fn(),
  });
}

function stubActHandler(instance: Stagehand): void {
  Reflect.set(instance, "actHandler", {
    act: vi.fn(),
    actFromObserveResult: vi.fn(),
  });
}

function stubExtractHandler(instance: Stagehand): void {
  Reflect.set(instance, "extractHandler", {
    extract: vi.fn(),
  });
}

function stubObserveHandler(instance: Stagehand): void {
  Reflect.set(instance, "observeHandler", {
    observe: vi.fn(),
  });
}

function stubAgentCache(instance: Stagehand): void {
  Reflect.set(instance, "agentCache", {
    isRecording: vi.fn().mockReturnValue(false),
    isReplayActive: vi.fn().mockReturnValue(false),
    beginRecording: vi.fn(),
    endRecording: vi.fn().mockReturnValue([]),
    discardRecording: vi.fn(),
    buildConfigSignature: vi.fn().mockReturnValue("signature"),
    sanitizeExecuteOptions: vi.fn().mockImplementation((opts) => opts),
    shouldAttemptCache: vi.fn().mockReturnValue(false),
    prepareContext: vi.fn(),
    tryReplay: vi.fn(),
    store: vi.fn(),
  });
}

function createApiClient() {
  return {
    act: vi.fn().mockResolvedValue(defaultActResult),
    extract: vi.fn().mockResolvedValue({ pageText: "" }),
    observe: vi.fn().mockResolvedValue([]),
    agentExecute: vi.fn().mockResolvedValue(defaultAgentResult),
    end: vi.fn(),
  };
}

describe("Page boundary contracts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("resolvePage", () => {
    it("uses ctx.awaitActivePage when options.page is undefined", async () => {
      const stagehand = createStagehand();
      const fakePage = createInternalPage("frame-default");
      const awaitActivePage = vi.fn().mockResolvedValue(fakePage);
      Reflect.set(stagehand, "ctx", { awaitActivePage });

      const resolvePage = Reflect.get(stagehand, "resolvePage") as (
        page?: AnyPage,
      ) => Promise<Page>;

      const resolved = await resolvePage.call(stagehand);

      expect(awaitActivePage).toHaveBeenCalledTimes(1);
      expect(resolved).toBe(fakePage);
    });

    it("rejects inputs outside the AnyPage union", async () => {
      const stagehand = createStagehand();

      const resolvePage = Reflect.get(stagehand, "resolvePage") as (
        page?: AnyPage,
      ) => Promise<Page>;

      await expect(
        resolvePage.call(stagehand, {} as AnyPage),
      ).rejects.toBeInstanceOf(StagehandInvalidArgumentError);
    });
  });

  describe("normalizeToV3Page", () => {
    it("bridges Playwright pages via frameId lookup", async () => {
      const stagehand = createStagehand();
      const internalPage = createInternalPage("internal-frame");
      const resolvePageByMainFrameId = vi.fn().mockReturnValue(internalPage);
      const frameId = "frame-playwright";

      Reflect.set(stagehand, "ctx", { resolvePageByMainFrameId });
      Reflect.set(
        stagehand,
        "resolveTopFrameId",
        vi.fn().mockResolvedValue(frameId),
      );

      const normalize = Reflect.get(stagehand, "normalizeToV3Page") as (
        page: AnyPage,
      ) => Promise<Page>;

      const playwrightPage = {
        context: () => ({}),
      } as unknown as AnyPage;

      const result = await normalize.call(stagehand, playwrightPage);

      expect(resolvePageByMainFrameId).toHaveBeenCalledWith(frameId);
      expect(result).toBe(internalPage);
    });

    it("bridges Patchright pages when the guard matches", async () => {
      const stagehand = createStagehand();
      const internalPage = createInternalPage("internal-frame");
      const resolvePageByMainFrameId = vi.fn().mockReturnValue(internalPage);
      const frameId = "frame-patchright";

      Reflect.set(stagehand, "ctx", { resolvePageByMainFrameId });
      Reflect.set(
        stagehand,
        "resolveTopFrameId",
        vi.fn().mockResolvedValue(frameId),
      );
      Reflect.set(
        stagehand,
        "isPlaywrightPage",
        vi.fn().mockReturnValue(false),
      );
      Reflect.set(stagehand, "isPatchrightPage", vi.fn().mockReturnValue(true));

      const normalize = Reflect.get(stagehand, "normalizeToV3Page") as (
        page: AnyPage,
      ) => Promise<Page>;

      const patchrightPage = {} as AnyPage;

      const result = await normalize.call(stagehand, patchrightPage);

      expect(resolvePageByMainFrameId).toHaveBeenCalledWith(frameId);
      expect(result).toBe(internalPage);
    });

    it("bridges Puppeteer pages via frameId lookup", async () => {
      const stagehand = createStagehand();
      const internalPage = createInternalPage("internal-frame");
      const resolvePageByMainFrameId = vi.fn().mockReturnValue(internalPage);
      const frameId = "frame-puppeteer";

      Reflect.set(stagehand, "ctx", { resolvePageByMainFrameId });
      Reflect.set(
        stagehand,
        "resolveTopFrameId",
        vi.fn().mockResolvedValue(frameId),
      );

      const normalize = Reflect.get(stagehand, "normalizeToV3Page") as (
        page: AnyPage,
      ) => Promise<Page>;

      const puppeteerPage = {
        target: () => ({}),
      } as unknown as AnyPage;

      const result = await normalize.call(stagehand, puppeteerPage);

      expect(resolvePageByMainFrameId).toHaveBeenCalledWith(frameId);
      expect(result).toBe(internalPage);
    });
  });

  describe("API payload serialization", () => {
    it("act forwards only the frameId to StagehandAPI", async () => {
      const stagehand = createStagehand();
      stubActHandler(stagehand);
      stubActCache(stagehand);
      stubAgentCache(stagehand);

      const frameId = "frame-act";
      const fakePage = createInternalPage(frameId);
      Reflect.set(
        stagehand,
        "resolvePage",
        vi.fn().mockResolvedValue(fakePage),
      );

      const apiClient = createApiClient();
      Reflect.set(stagehand, "apiClient", apiClient);

      const options = {};

      await stagehand.act("Click button", options);

      expect(apiClient.act).toHaveBeenCalledWith({
        input: "Click button",
        options,
        frameId: "frame-act",
      });
    });

    it("extract forwards frameId and JSON-safe payload", async () => {
      const stagehand = createStagehand();
      stubExtractHandler(stagehand);
      stubAgentCache(stagehand);

      const frameId = "frame-extract";
      const fakePage = createInternalPage(frameId);
      Reflect.set(
        stagehand,
        "resolvePage",
        vi.fn().mockResolvedValue(fakePage),
      );

      const apiClient = createApiClient();
      Reflect.set(stagehand, "apiClient", apiClient);

      const schema = z.object({ value: z.string() });
      const options = {};

      await stagehand.extract("Summarize", schema, options);

      expect(apiClient.extract).toHaveBeenCalledWith({
        instruction: "Summarize",
        schema,
        options,
        frameId: "frame-extract",
      });
    });

    it("observe forwards frameId without leaking the page object", async () => {
      const stagehand = createStagehand();
      stubObserveHandler(stagehand);
      stubAgentCache(stagehand);

      const frameId = "frame-observe";
      const fakePage = createInternalPage(frameId);
      Reflect.set(
        stagehand,
        "resolvePage",
        vi.fn().mockResolvedValue(fakePage),
      );

      const apiClient = createApiClient();
      Reflect.set(stagehand, "apiClient", apiClient);

      const options = {};

      await stagehand.observe("Check", options);

      expect(apiClient.observe).toHaveBeenCalledWith({
        instruction: "Check",
        options,
        frameId: "frame-observe",
      });
    });

    it("agent.execute obtains frameId from ctx.awaitActivePage", async () => {
      const stagehand = createStagehand();
      stubAgentCache(stagehand);

      const fakePage = createInternalPage("frame-agent");
      const awaitActivePage = vi.fn().mockResolvedValue(fakePage);
      const setActivePage = vi.fn();
      Reflect.set(stagehand, "ctx", { awaitActivePage, setActivePage });

      const apiClient = createApiClient();
      Reflect.set(stagehand, "apiClient", apiClient);

      const agent = stagehand.agent();
      const result = await agent.execute("Do something");

      expect(apiClient.agentExecute).toHaveBeenCalledWith(
        undefined,
        { instruction: "Do something" },
        "frame-agent",
      );
      expect(result).toEqual(defaultAgentResult);
    });
  });
});
