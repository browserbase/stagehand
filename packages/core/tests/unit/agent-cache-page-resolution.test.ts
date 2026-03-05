import { describe, expect, it, vi } from "vitest";
import { AgentCache } from "../../lib/v3/cache/AgentCache.js";
import type { CacheStorage } from "../../lib/v3/cache/CacheStorage.js";
import type { ActHandler } from "../../lib/v3/handlers/actHandler.js";
import type { LLMClient } from "../../lib/v3/llm/LLMClient.js";
import type { Page } from "../../lib/v3/understudy/page.js";
import type { V3Context } from "../../lib/v3/understudy/context.js";
import type {
  CachedAgentEntry,
  AgentCacheContext,
  AgentReplayActStep,
} from "../../lib/v3/types/private/index.js";
import type {
  Action,
  AgentResult,
  AvailableModel,
} from "../../lib/v3/types/public/index.js";

function fakeAgentResult(): AgentResult {
  return {
    success: true,
    message: "ok",
    completed: true,
    actions: [],
  } as AgentResult;
}

function createAgentCache(opts: {
  entry: CachedAgentEntry;
  handler: ActHandler;
  ctx: V3Context;
  act?: ReturnType<typeof vi.fn>;
}) {
  const storage = {
    enabled: true,
    readJson: vi.fn().mockResolvedValue({ value: opts.entry }),
    writeJson: vi.fn().mockResolvedValue({}),
    directory: "/tmp/cache",
  } as unknown as CacheStorage;

  return new AgentCache({
    storage,
    logger: vi.fn(),
    getActHandler: () => opts.handler,
    getContext: () => opts.ctx,
    getDefaultLlmClient: () => ({ id: "default" }) as unknown as LLMClient,
    getBaseModelName: () => "openai/gpt-4.1-mini" as AvailableModel,
    getSystemPrompt: () => undefined,
    domSettleTimeoutMs: undefined,
    act: (opts.act ?? vi.fn()) as any,
  });
}

const cacheCtx = (
  key: string,
  overrides?: Partial<AgentCacheContext>,
): AgentCacheContext => ({
  instruction: "test",
  startUrl: "https://example.com",
  options: {},
  configSignature: "sig",
  cacheKey: key,
  variableKeys: [],
  ...overrides,
});

describe("AgentCache replay page resolution", () => {
  const action: Action = {
    selector: "xpath=/html/body/input",
    description: "type email",
    method: "type",
    arguments: ["test@example.com"],
  };

  function makeActEntry(actions: Action[]): CachedAgentEntry {
    const step: AgentReplayActStep = {
      type: "act",
      instruction: "type email",
      actions,
    };
    return {
      version: 1,
      instruction: "fill form",
      startUrl: "https://example.com",
      options: {},
      configSignature: "sig",
      steps: [step],
      result: fakeAgentResult(),
      timestamp: new Date().toISOString(),
    };
  }

  function makeGotoEntry(): CachedAgentEntry {
    return {
      version: 1,
      instruction: "navigate home",
      startUrl: "https://example.com/source",
      options: {},
      configSignature: "sig",
      steps: [
        { type: "goto", url: "https://example.com/target", waitUntil: "load" },
      ],
      result: fakeAgentResult(),
      timestamp: new Date().toISOString(),
    };
  }

  it("uses explicit page for act replay (with actions)", async () => {
    const globalPage = { id: "global" } as unknown as Page;
    const explicitPage = { id: "explicit" } as unknown as Page;
    const ctx = {
      awaitActivePage: vi.fn().mockResolvedValue(globalPage),
    } as unknown as V3Context;
    const handler = {
      takeDeterministicAction: vi.fn().mockResolvedValue({
        success: true,
        actions: [action],
      }),
    } as unknown as ActHandler;

    const cache = createAgentCache({
      entry: makeActEntry([action]),
      handler,
      ctx,
    });

    const result = await cache.tryReplay(
      cacheCtx("act-page"),
      undefined,
      explicitPage,
    );

    expect(result?.success).toBe(true);
    const call = vi.mocked(handler.takeDeterministicAction).mock.calls[0];
    expect(call?.[1]).toBe(explicitPage);
    expect(ctx.awaitActivePage).not.toHaveBeenCalled();
  });

  it("uses explicit page for act replay (no-actions fallback)", async () => {
    const explicitPage = { id: "explicit" } as unknown as Page;
    const ctx = {
      awaitActivePage: vi.fn().mockResolvedValue({ id: "global" }),
    } as unknown as V3Context;
    const handler = {
      takeDeterministicAction: vi.fn(),
    } as unknown as ActHandler;
    const actFn = vi.fn().mockResolvedValue({ success: true, actions: [] });

    const cache = createAgentCache({
      entry: makeActEntry([]),
      handler,
      ctx,
      act: actFn,
    });

    const result = await cache.tryReplay(
      cacheCtx("act-fallback"),
      undefined,
      explicitPage,
    );

    expect(result?.success).toBe(true);
    expect(actFn).toHaveBeenCalledTimes(1);
    expect(actFn.mock.calls[0][1].page).toBe(explicitPage);
    expect(ctx.awaitActivePage).not.toHaveBeenCalled();
  });

  it("uses explicit page for goto replay", async () => {
    const globalPage = { id: "global", goto: vi.fn() } as unknown as Page;
    const explicitPage = { id: "explicit", goto: vi.fn() } as unknown as Page;
    const ctx = {
      awaitActivePage: vi.fn().mockResolvedValue(globalPage),
    } as unknown as V3Context;
    const handler = {
      takeDeterministicAction: vi.fn(),
    } as unknown as ActHandler;

    const cache = createAgentCache({ entry: makeGotoEntry(), handler, ctx });

    const result = await cache.tryReplay(
      cacheCtx("goto-page"),
      undefined,
      explicitPage,
    );

    expect(result?.success).toBe(true);
    expect((explicitPage as any).goto).toHaveBeenCalledWith(
      "https://example.com/target",
      { waitUntil: "load" },
    );
    expect((globalPage as any).goto).not.toHaveBeenCalled();
    expect(ctx.awaitActivePage).not.toHaveBeenCalled();
  });

  it("falls back to awaitActivePage when no explicit page", async () => {
    const globalPage = { id: "global", goto: vi.fn() } as unknown as Page;
    const ctx = {
      awaitActivePage: vi.fn().mockResolvedValue(globalPage),
    } as unknown as V3Context;
    const handler = {
      takeDeterministicAction: vi.fn(),
    } as unknown as ActHandler;

    const cache = createAgentCache({ entry: makeGotoEntry(), handler, ctx });

    const result = await cache.tryReplay(cacheCtx("goto-fallback"));

    expect(result?.success).toBe(true);
    expect(ctx.awaitActivePage).toHaveBeenCalled();
    expect((globalPage as any).goto).toHaveBeenCalledWith(
      "https://example.com/target",
      { waitUntil: "load" },
    );
  });
});
