/**
 * Regression tests for act() model override (issues #1263 / #1347).
 *
 * stagehand.act() must forward the per-call `model` option to resolveLlmClient,
 * just as observe() does.  The tests here exercise ActHandler directly so they
 * are fast (no real browser / LLM) and document the exact call-path that was
 * broken.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActHandler } from "../../lib/v3/handlers/actHandler.js";
import type { Page } from "../../lib/v3/understudy/page.js";
import type { ClientOptions } from "../../lib/v3/types/public/model.js";
import type { LLMClient } from "../../lib/v3/llm/LLMClient.js";
import { waitForDomNetworkQuiet } from "../../lib/v3/handlers/handlerUtils/actHandlerUtils.js";
import { captureHybridSnapshot } from "../../lib/v3/understudy/a11y/snapshot/index.js";
import { act as actInference } from "../../lib/inference.js";
import { createTimeoutGuard } from "../../lib/v3/handlers/handlerUtils/timeoutGuard.js";

vi.mock("../../lib/v3/handlers/handlerUtils/timeoutGuard", () => ({
  createTimeoutGuard: vi.fn(),
}));

vi.mock("../../lib/v3/handlers/handlerUtils/actHandlerUtils", () => ({
  waitForDomNetworkQuiet: vi.fn(),
  performUnderstudyMethod: vi.fn(),
}));

vi.mock("../../lib/v3/understudy/a11y/snapshot", () => ({
  captureHybridSnapshot: vi.fn(),
  diffCombinedTrees: vi.fn(),
}));

vi.mock("../../lib/inference", () => ({
  act: vi.fn(),
}));

// ── shared helpers ─────────────────────────────────────────────────────────────

const defaultClientOptions = {} as ClientOptions;
const defaultClient: LLMClient = {
  type: "aisdk",
  modelName: "openai/gpt-4.1-mini" as LLMClient["modelName"],
  clientOptions: defaultClientOptions,
} as LLMClient;

function buildHandler(resolveLlmClient: (model?: unknown) => LLMClient) {
  return new ActHandler(
    defaultClient,
    "openai/gpt-4.1-mini",
    defaultClientOptions,
    resolveLlmClient as (
      model?: import("../../lib/v3/types/public/model.js").ModelConfiguration,
    ) => LLMClient,
    /* systemPrompt */ undefined,
    /* logInferenceToFile */ false,
    /* selfHeal */ false,
    /* onMetrics */ undefined,
    /* defaultDomSettleTimeoutMs */ undefined,
  );
}

const fakePage = {
  mainFrame: vi.fn().mockReturnValue({}),
} as unknown as Page;

// ── setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // timeout guard that never fires
  vi.mocked(createTimeoutGuard).mockImplementation(() => vi.fn());

  // network-quiet helper resolves immediately
  vi.mocked(waitForDomNetworkQuiet).mockResolvedValue(undefined);

  // snapshot returns empty tree → no element found → act returns { success: false }
  vi.mocked(captureHybridSnapshot).mockResolvedValue({
    combinedTree: "",
    combinedXpathMap: {},
    combinedUrlMap: {},
  });

  // LLM inference returns no element (safe default)
  vi.mocked(actInference).mockResolvedValue({
    element: undefined,
    prompt_tokens: 0,
    completion_tokens: 0,
    reasoning_tokens: 0,
    cached_input_tokens: 0,
    inference_time_ms: 0,
    twoStep: false,
  });
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("ActHandler model override", () => {
  it("passes a string model override to resolveLlmClient", async () => {
    const resolveLlmClient = vi.fn().mockReturnValue(defaultClient);
    const handler = buildHandler(resolveLlmClient);

    const result = await handler.act({
      instruction: "click the login button",
      model: "anthropic/claude-sonnet-4-20250514",
      page: fakePage,
    });

    expect(resolveLlmClient).toHaveBeenCalledWith(
      "anthropic/claude-sonnet-4-20250514",
    );
    expect(result).toBeDefined();
    // No action found in the empty snapshot, but no error thrown
    expect(result.success).toBe(false);
    expect(result.message).toContain("No action found");
  });

  it("passes an object model override to resolveLlmClient", async () => {
    const resolveLlmClient = vi.fn().mockReturnValue(defaultClient);
    const handler = buildHandler(resolveLlmClient);

    const modelOverride = {
      modelName: "anthropic/claude-sonnet-4-20250514",
      apiKey: "sk-ant-test",
    };

    const result = await handler.act({
      instruction: "click the login button",
      model: modelOverride,
      page: fakePage,
    });

    expect(resolveLlmClient).toHaveBeenCalledWith(modelOverride);
    expect(result).toBeDefined();
  });

  it("passes undefined to resolveLlmClient when no model override is given", async () => {
    const resolveLlmClient = vi.fn().mockReturnValue(defaultClient);
    const handler = buildHandler(resolveLlmClient);

    await handler.act({
      instruction: "click the login button",
      page: fakePage,
    });

    expect(resolveLlmClient).toHaveBeenCalledWith(undefined);
  });

  it("uses the resolved override client for actInference, not the default client", async () => {
    const overrideClient: LLMClient = {
      type: "aisdk",
      modelName: "anthropic/claude-sonnet-4-20250514" as LLMClient["modelName"],
      clientOptions: {},
    } as LLMClient;

    const resolveLlmClient = vi.fn((model?: unknown) =>
      model ? overrideClient : defaultClient,
    );

    // Provide a snapshot with a real element so actInference is actually called
    vi.mocked(captureHybridSnapshot).mockResolvedValue({
      combinedTree: "[0-1] button 'Login'",
      combinedXpathMap: { "0-1": "/html/body/button" },
      combinedUrlMap: {},
    });

    const handler = buildHandler(resolveLlmClient);

    await handler.act({
      instruction: "click the login button",
      model: "anthropic/claude-sonnet-4-20250514",
      page: fakePage,
    });

    // actInference must have been invoked with the override client, not the default
    expect(actInference).toHaveBeenCalledWith(
      expect.objectContaining({ llmClient: overrideClient }),
    );
    expect(actInference).not.toHaveBeenCalledWith(
      expect.objectContaining({ llmClient: defaultClient }),
    );
  });
});
