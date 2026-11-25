import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupActiveRunResources } from "../framework/activeRunCleanup.js";
import { EVAL_SYSTEM_PROMPT } from "../framework/evalSystemPrompt.js";
import { initStagehand } from "../initStagehand.js";
import type { EvalLogger } from "../logger.js";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  connectBrowserbase: vi.fn(),
  launchLocal: vi.fn(),
  launchRemote: vi.fn(),
  resolveKey: vi.fn(),
}));

vi.mock("@browserbasehq/stagehand", () => ({
  Stagehand: { create: mocks.create },
  browserbase: { connect: mocks.connectBrowserbase },
  localBrowser: { launch: mocks.launchLocal },
}));
vi.mock("../core/targets/browserbase.js", () => ({
  launchRunnerProvidedBrowserbaseChrome: mocks.launchRemote,
}));
vi.mock("../tui/welcomeStatus.js", () => ({ resolveKey: mocks.resolveKey }));

describe("native Stagehand evaluation initialization", () => {
  const page = { id: "test-page" };
  const browser = { close: vi.fn() };
  const stagehand = {
    close: vi.fn(),
    browser: { context: { activePage: vi.fn() } },
  };
  const releaseSession = vi.fn();
  const logger = { log: vi.fn() } as unknown as EvalLogger;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveKey.mockImplementation((name: string) => ({
      value:
        name === "OPENAI_API_KEY"
          ? "test-model-key"
          : name === "BROWSERBASE_API_KEY"
            ? "test-browser-key"
            : "",
      source: "process-env",
    }));
    mocks.launchLocal.mockResolvedValue(browser);
    mocks.connectBrowserbase.mockResolvedValue(browser);
    mocks.launchRemote.mockResolvedValue({
      sessionId: "test-session",
      sessionUrl: "https://browserbase.test/sessions/test-session",
      debugUrl: "https://browserbase.test/debug/test-session",
      cleanup: releaseSession,
    });
    mocks.create.mockResolvedValue(stagehand);
    stagehand.browser.context.activePage.mockResolvedValue(page);
    stagehand.close.mockResolvedValue(undefined);
    browser.close.mockResolvedValue(undefined);
    releaseSession.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await cleanupActiveRunResources();
  });

  it.each(["LOCAL", "BROWSERBASE"] as const)(
    "passes the shared system prompt through %s initialization and preserves cleanup",
    async (environment) => {
      const result = await initStagehand({
        logger,
        modelName: "openai/gpt-6-astra",
        environment,
      });

      expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
        browser,
        selfHeal: true,
        model: { modelName: "openai/gpt-6-astra", apiKey: "test-model-key" },
        systemPrompt: EVAL_SYSTEM_PROMPT,
        logging: { onLog: expect.any(Function) },
      });
      expect(result.stagehand).toBe(stagehand);
      expect(result.page).toBe(page);
      expect(stagehand.browser.context.activePage).toHaveBeenCalledOnce();
      if (environment === "LOCAL") {
        expect(mocks.launchLocal).toHaveBeenCalledExactlyOnceWith({ headless: false });
        expect(mocks.launchRemote).not.toHaveBeenCalled();
        expect(mocks.connectBrowserbase).not.toHaveBeenCalled();
        expect(result.sessionUrl).toBe("");
        expect(result.debugUrl).toBe("");
      } else {
        expect(mocks.launchLocal).not.toHaveBeenCalled();
        expect(mocks.launchRemote).toHaveBeenCalledOnce();
        expect(mocks.connectBrowserbase).toHaveBeenCalledExactlyOnceWith({
          apiKey: "test-browser-key",
          sessionId: "test-session",
        });
        expect(result.sessionUrl).toBe("https://browserbase.test/sessions/test-session");
        expect(result.debugUrl).toBe("https://browserbase.test/debug/test-session");
      }

      await result.cleanup();
      await result.cleanup();
      await cleanupActiveRunResources();
      expect(stagehand.close).toHaveBeenCalledOnce();
      expect(browser.close).toHaveBeenCalledOnce();
      expect(releaseSession).toHaveBeenCalledTimes(environment === "BROWSERBASE" ? 1 : 0);
    },
  );

  it.each([false, true])(
    "releases the remote session after create failure even if browser close fails (%s)",
    async (closeFails) => {
      if (closeFails) browser.close.mockRejectedValue(new Error("close failed"));
      const error = new Error("synthetic initialization failure");
      mocks.create.mockRejectedValue(error);

      await expect(
        initStagehand({ logger, modelName: "openai/gpt-6-astra", environment: "BROWSERBASE" }),
      ).rejects.toBe(error);

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ systemPrompt: EVAL_SYSTEM_PROMPT }),
      );
      expect(browser.close).toHaveBeenCalledOnce();
      expect(releaseSession).toHaveBeenCalledOnce();
      expect(stagehand.close).not.toHaveBeenCalled();
      expect(stagehand.browser.context.activePage).not.toHaveBeenCalled();
    },
  );

  describe("EVAL_DECISIONS provider routing", () => {
    const keys: Record<string, string> = {
      OPENAI_API_KEY: "test-model-key",
      TYPESAFE_API_KEY: "test-typesafe-key",
      CLOUDFLARE_API_TOKEN: "test-cloudflare-token",
      PERPLEXITY_API_KEY: "test-perplexity-key",
    };
    const init = () =>
      initStagehand({ logger, modelName: "openai/gpt-6-astra", environment: "LOCAL" });
    const sentDecisions = async () => {
      mocks.create.mockResolvedValue({
        ...stagehand,
        act: vi.fn(),
        experimentalDecisions: { act: vi.fn() },
      });
      await init();
      return (mocks.create.mock.calls[0][0].experimentalDecisions ?? null) as Record<
        string,
        unknown
      > | null;
    };

    beforeEach(() => {
      mocks.resolveKey.mockImplementation((name: string) => ({
        value: keys[name] ?? "",
        source: "process-env",
      }));
      vi.stubEnv("EVAL_DECISIONS", "1");
      vi.stubEnv("EVAL_DECISIONS_PROVIDER", undefined);
      vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", undefined);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("defaults to TypeSafe without naming a provider", async () => {
      const sent = await sentDecisions();
      expect(sent).toMatchObject({ apiKey: "test-typesafe-key" });
      expect(sent).not.toHaveProperty("provider");
      expect(sent).not.toHaveProperty("accountId");
    });

    it.each([
      ["cloudflare", { apiKey: "test-cloudflare-token", accountId: "acct123" }],
      ["perplexity", { apiKey: "test-perplexity-key" }],
      ["openai", { apiKey: "test-model-key" }],
    ])("sends %s its own key", async (provider, expected) => {
      vi.stubEnv("EVAL_DECISIONS_PROVIDER", provider);
      vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct123");
      const sent = await sentDecisions();
      expect(sent).toMatchObject({ provider, ...expected });
      if (provider !== "cloudflare") expect(sent).not.toHaveProperty("accountId");
    });

    it("rejects an unknown provider before anything is launched", async () => {
      vi.stubEnv("EVAL_DECISIONS_PROVIDER", "nope");
      await expect(init()).rejects.toThrow('unknown EVAL_DECISIONS_PROVIDER "nope"');
      expect(mocks.launchLocal).not.toHaveBeenCalled();
    });

    it("names the key a provider is missing", async () => {
      vi.stubEnv("EVAL_DECISIONS_PROVIDER", "perplexity");
      mocks.resolveKey.mockImplementation((name: string) => ({
        value: name === "PERPLEXITY_API_KEY" ? "" : (keys[name] ?? ""),
        source: "process-env",
      }));
      await expect(init()).rejects.toThrow('provider "perplexity" requires PERPLEXITY_API_KEY');
      expect(mocks.launchLocal).not.toHaveBeenCalled();
    });

    it("requires CLOUDFLARE_ACCOUNT_ID for Cloudflare", async () => {
      vi.stubEnv("EVAL_DECISIONS_PROVIDER", "cloudflare");
      await expect(init()).rejects.toThrow('provider "cloudflare" requires CLOUDFLARE_ACCOUNT_ID');
      expect(mocks.launchLocal).not.toHaveBeenCalled();
    });
  });
});

describe("EVAL_DECISIONS namespace routing", () => {
  const logger = { log: vi.fn() } as unknown as EvalLogger;
  const newStagehand = () => ({
    close: vi.fn().mockResolvedValue(undefined),
    browser: { context: { activePage: vi.fn().mockResolvedValue({ id: "test-page" }) } },
    act: vi.fn().mockResolvedValue("llm-act"),
    observe: vi.fn().mockResolvedValue("llm-observe"),
    extract: vi.fn().mockResolvedValue("llm-extract"),
    experimentalDecisions: {
      act: vi.fn().mockResolvedValue("decisions-act"),
      observe: vi.fn().mockResolvedValue("decisions-observe"),
      extract: vi.fn().mockResolvedValue("decisions-extract"),
    },
  });
  let created: ReturnType<typeof newStagehand>;
  const init = async () => {
    await initStagehand({ logger, modelName: "openai/gpt-6-astra", environment: "LOCAL" });
    return {
      config: mocks.create.mock.calls[0][0].experimentalDecisions,
      act: await created.act("click"),
      observe: await created.observe("find"),
      extract: await created.extract("read"),
    };
  };

  beforeEach(() => {
    vi.resetAllMocks();
    created = newStagehand();
    mocks.create.mockResolvedValue(created);
    mocks.launchLocal.mockResolvedValue({ close: vi.fn().mockResolvedValue(undefined) });
    mocks.resolveKey.mockImplementation((name: string) => ({
      value: name === "OPENAI_API_KEY" ? "test-model-key" : "test-typesafe-key",
      source: "process-env",
    }));
    for (const name of Object.keys(process.env)) {
      if (name.startsWith("EVAL_DECISIONS")) vi.stubEnv(name, undefined);
    }
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupActiveRunResources();
  });

  it("leaves act, observe, and extract on the LLM path without EVAL_DECISIONS", async () => {
    expect(await init()).toEqual({
      config: undefined,
      act: "llm-act",
      observe: "llm-observe",
      extract: "llm-extract",
    });
  });

  it("routes only act through the namespace by default", async () => {
    vi.stubEnv("EVAL_DECISIONS", "1");

    expect(await init()).toEqual({
      config: { apiKey: "test-typesafe-key" },
      act: "decisions-act",
      observe: "llm-observe",
      extract: "llm-extract",
    });
    expect(created.experimentalDecisions.act).toHaveBeenCalledExactlyOnceWith("click");
    expect(created.experimentalDecisions.act.mock.contexts[0]).toBe(created.experimentalDecisions);
  });

  it("routes observe through the namespace with EVAL_DECISIONS_OBSERVE=1", async () => {
    vi.stubEnv("EVAL_DECISIONS", "1");
    vi.stubEnv("EVAL_DECISIONS_OBSERVE", "1");

    expect(await init()).toMatchObject({
      act: "decisions-act",
      observe: "decisions-observe",
      extract: "llm-extract",
    });
  });

  it.each(["pick", "judge"] as const)(
    "routes extract through the namespace with EVAL_DECISIONS_EXTRACT=%s",
    async (mode) => {
      vi.stubEnv("EVAL_DECISIONS", "1");
      vi.stubEnv("EVAL_DECISIONS_EXTRACT", mode);

      expect(await init()).toEqual({
        config: { apiKey: "test-typesafe-key", extract: mode },
        act: "decisions-act",
        observe: "llm-observe",
        extract: "decisions-extract",
      });
    },
  );

  it("ignores an unknown EVAL_DECISIONS_EXTRACT value", async () => {
    vi.stubEnv("EVAL_DECISIONS", "1");
    vi.stubEnv("EVAL_DECISIONS_EXTRACT", "1");

    expect(await init()).toEqual({
      config: { apiKey: "test-typesafe-key" },
      act: "decisions-act",
      observe: "llm-observe",
      extract: "llm-extract",
    });
  });

  it("ignores the observe and extract switches without EVAL_DECISIONS", async () => {
    vi.stubEnv("EVAL_DECISIONS_OBSERVE", "1");
    vi.stubEnv("EVAL_DECISIONS_EXTRACT", "pick");

    expect(await init()).toEqual({
      config: undefined,
      act: "llm-act",
      observe: "llm-observe",
      extract: "llm-extract",
    });
  });

  it("configures the instrument-only baseline without routing any call", async () => {
    vi.stubEnv("EVAL_DECISIONS_INSTRUMENT", "1");

    expect(await init()).toEqual({
      config: { apiKey: "instrument-only" },
      act: "llm-act",
      observe: "llm-observe",
      extract: "llm-extract",
    });
    expect(created.experimentalDecisions.act).not.toHaveBeenCalled();
  });
});
