import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActHandler } from "../lib/v3/handlers/actHandler";
import { ExtractHandler } from "../lib/v3/handlers/extractHandler";
import { ObserveHandler } from "../lib/v3/handlers/observeHandler";
import type { Page } from "../lib/v3/understudy/page";
import type { ClientOptions } from "../lib/v3/types/public/model";
import type { LLMClient } from "../lib/v3/llm/LLMClient";
import { createTimeoutGuard } from "../lib/v3/handlers/handlerUtils/timeoutGuard";
import { waitForDomNetworkQuiet } from "../lib/v3/handlers/handlerUtils/actHandlerUtils";
import { captureHybridSnapshot } from "../lib/v3/understudy/a11y/snapshot";
import {
  ActTimeoutError,
  ExtractTimeoutError,
  ObserveTimeoutError,
} from "../lib/v3/types/public/sdkErrors";
import {
  act as actInference,
  extract as extractInference,
  observe as observeInference,
} from "../lib/inference";
import { V3FunctionName } from "../lib/v3/types/public/methods";

vi.mock("../lib/v3/handlers/handlerUtils/timeoutGuard", () => ({
  createTimeoutGuard: vi.fn(),
}));

vi.mock("../lib/v3/handlers/handlerUtils/actHandlerUtils", () => ({
  waitForDomNetworkQuiet: vi.fn(),
  performUnderstudyMethod: vi.fn(),
}));

vi.mock("../lib/v3/understudy/a11y/snapshot", () => ({
  captureHybridSnapshot: vi.fn(),
  diffCombinedTrees: vi.fn(),
}));

vi.mock("../lib/inference", () => ({
  act: vi.fn(),
  extract: vi.fn(),
  observe: vi.fn(),
}));

describe("ActHandler timeout guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws ActTimeoutError when timeout expires before snapshot", async () => {
    const waitForDomNetworkQuietMock = vi.mocked(waitForDomNetworkQuiet);
    waitForDomNetworkQuietMock.mockResolvedValue(undefined);

    const captureHybridSnapshotMock = vi.mocked(captureHybridSnapshot);
    captureHybridSnapshotMock.mockResolvedValue({
      combinedTree: "",
      combinedXpathMap: {},
      combinedUrlMap: {},
    });

    // Make createTimeoutGuard return a guard that throws on call #2
    vi.mocked(createTimeoutGuard).mockImplementation(
      (timeoutMs, errorFactory) => {
        let calls = 0;
        return vi.fn(() => {
          calls += 1;
          if (calls >= 2) {
            throw errorFactory
              ? errorFactory(timeoutMs!)
              : new ActTimeoutError(timeoutMs!);
          }
        });
      },
    );

    const handler = buildActHandler();
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    await expect(
      handler.act({
        instruction: "do something",
        page: fakePage,
        timeout: 5,
      }),
    ).rejects.toThrow(ActTimeoutError);

    // Verify pre-timeout helper ran
    expect(waitForDomNetworkQuietMock).toHaveBeenCalledTimes(1);
    // Verify snapshot was NOT called (timeout fired before it)
    expect(captureHybridSnapshotMock).not.toHaveBeenCalled();
  });

  it("throws ActTimeoutError when timeout expires before LLM call", async () => {
    const waitForDomNetworkQuietMock = vi.mocked(waitForDomNetworkQuiet);
    waitForDomNetworkQuietMock.mockResolvedValue(undefined);

    const captureHybridSnapshotMock = vi.mocked(captureHybridSnapshot);
    captureHybridSnapshotMock.mockResolvedValue({
      combinedTree: "tree content",
      combinedXpathMap: {},
      combinedUrlMap: {},
    });

    const actInferenceMock = vi.mocked(actInference);

    // Throw on call #3 (after snapshot but before LLM)
    vi.mocked(createTimeoutGuard).mockImplementation(
      (timeoutMs, errorFactory) => {
        let calls = 0;
        return vi.fn(() => {
          calls += 1;
          if (calls >= 3) {
            throw errorFactory
              ? errorFactory(timeoutMs!)
              : new ActTimeoutError(timeoutMs!);
          }
        });
      },
    );

    const handler = buildActHandler();
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    await expect(
      handler.act({
        instruction: "do something",
        page: fakePage,
        timeout: 5,
      }),
    ).rejects.toThrow(ActTimeoutError);

    // Snapshot should have been called
    expect(captureHybridSnapshotMock).toHaveBeenCalledTimes(1);
    // LLM inference should NOT have been called
    expect(actInferenceMock).not.toHaveBeenCalled();
  });

  it("throws ActTimeoutError with correct message format", async () => {
    const waitForDomNetworkQuietMock = vi.mocked(waitForDomNetworkQuiet);
    waitForDomNetworkQuietMock.mockResolvedValue(undefined);

    const timeoutMs = 100;

    vi.mocked(createTimeoutGuard).mockImplementation((ms, errorFactory) => {
      return vi.fn(() => {
        throw errorFactory ? errorFactory(ms!) : new ActTimeoutError(ms!);
      });
    });

    const handler = buildActHandler();
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    try {
      await handler.act({
        instruction: "do something",
        page: fakePage,
        timeout: timeoutMs,
      });
      throw new Error("Expected ActTimeoutError to be thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ActTimeoutError);
      expect((error as ActTimeoutError).message).toContain("act()");
      expect((error as ActTimeoutError).message).toContain(`${timeoutMs}ms`);
      expect((error as ActTimeoutError).name).toBe("ActTimeoutError");
    }
  });
});

describe("ActHandler two-step timeout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws ActTimeoutError during step 2; step 2 action does not run", async () => {
    const waitForDomNetworkQuietMock = vi.mocked(waitForDomNetworkQuiet);
    waitForDomNetworkQuietMock.mockResolvedValue(undefined);

    const captureHybridSnapshotMock = vi.mocked(captureHybridSnapshot);
    captureHybridSnapshotMock.mockResolvedValue({
      combinedTree: "tree content",
      combinedXpathMap: { "1-0": "/html/body/button" },
      combinedUrlMap: {},
    });

    const { performUnderstudyMethod } = await import(
      "../lib/v3/handlers/handlerUtils/actHandlerUtils"
    );
    const performUnderstudyMethodMock = vi.mocked(performUnderstudyMethod);
    performUnderstudyMethodMock.mockResolvedValue(undefined);

    const actInferenceMock = vi.mocked(actInference);
    // First call returns a two-step action
    actInferenceMock.mockResolvedValueOnce({
      element: {
        elementId: "1-0",
        description: "click button",
        method: "click",
        arguments: [],
      },
      twoStep: true,
      prompt_tokens: 100,
      completion_tokens: 50,
      inference_time_ms: 500,
    } as ReturnType<typeof actInference> extends Promise<infer T> ? T : never);

    const diffCombinedTreesMock = vi.mocked(
      (await import("../lib/v3/understudy/a11y/snapshot")).diffCombinedTrees,
    );
    diffCombinedTreesMock.mockReturnValue("diff tree");

    // Timeout fires after step 1 completes, during step 2 snapshot
    // ensureTimeRemaining calls: 1=before wait, 2=after wait/before snap1, 3=before LLM1,
    // 4=before action1, 5=inside takeDeterministicAction, 6=performUnderstudy,
    // 7=before snap2 (this one should throw)
    let callCount = 0;
    vi.mocked(createTimeoutGuard).mockImplementation(
      (timeoutMs, errorFactory) => {
        return vi.fn(() => {
          callCount += 1;
          if (callCount >= 7) {
            throw errorFactory
              ? errorFactory(timeoutMs!)
              : new ActTimeoutError(timeoutMs!);
          }
        });
      },
    );

    const handler = buildActHandler();
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    await expect(
      handler.act({
        instruction: "click then type",
        page: fakePage,
        timeout: 50,
      }),
    ).rejects.toThrow(ActTimeoutError);

    // Step 1 action should have been executed
    expect(performUnderstudyMethodMock).toHaveBeenCalledTimes(1);
    // Step 2 LLM call should NOT have happened
    expect(actInferenceMock).toHaveBeenCalledTimes(1);
  });
});

describe("ActHandler self-heal timeout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws ActTimeoutError during self-heal snapshot; no retry action executes", async () => {
    const waitForDomNetworkQuietMock = vi.mocked(waitForDomNetworkQuiet);
    waitForDomNetworkQuietMock.mockResolvedValue(undefined);

    const captureHybridSnapshotMock = vi.mocked(captureHybridSnapshot);
    captureHybridSnapshotMock.mockResolvedValue({
      combinedTree: "tree content",
      combinedXpathMap: { "1-0": "/html/body/button" },
      combinedUrlMap: {},
    });

    const { performUnderstudyMethod } = await import(
      "../lib/v3/handlers/handlerUtils/actHandlerUtils"
    );
    const performUnderstudyMethodMock = vi.mocked(performUnderstudyMethod);
    // First call fails, triggering self-heal
    performUnderstudyMethodMock.mockRejectedValueOnce(
      new Error("Element not found"),
    );

    const actInferenceMock = vi.mocked(actInference);
    actInferenceMock.mockResolvedValue({
      element: {
        elementId: "1-0",
        description: "click button",
        method: "click",
        arguments: [],
      },
      twoStep: false,
      prompt_tokens: 100,
      completion_tokens: 50,
      inference_time_ms: 500,
    } as ReturnType<typeof actInference> extends Promise<infer T> ? T : never);

    // Timeout during self-heal snapshot (call 7 or later)
    let callCount = 0;
    vi.mocked(createTimeoutGuard).mockImplementation(
      (timeoutMs, errorFactory) => {
        return vi.fn(() => {
          callCount += 1;
          // Timeout during self-heal snapshot call
          if (callCount >= 7) {
            throw errorFactory
              ? errorFactory(timeoutMs!)
              : new ActTimeoutError(timeoutMs!);
          }
        });
      },
    );

    const handler = buildActHandler({ selfHeal: true });
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    await expect(
      handler.act({
        instruction: "click button",
        page: fakePage,
        timeout: 50,
      }),
    ).rejects.toThrow(ActTimeoutError);

    // First action attempt should have been tried
    expect(performUnderstudyMethodMock).toHaveBeenCalledTimes(1);
    // First LLM call should have happened
    expect(actInferenceMock).toHaveBeenCalledTimes(1);
    // Self-heal snapshot should have been started (call happened)
    expect(captureHybridSnapshotMock).toHaveBeenCalled();
  });

  it("throws ActTimeoutError during self-heal LLM inference; no retry action executes", async () => {
    const waitForDomNetworkQuietMock = vi.mocked(waitForDomNetworkQuiet);
    waitForDomNetworkQuietMock.mockResolvedValue(undefined);

    const captureHybridSnapshotMock = vi.mocked(captureHybridSnapshot);
    captureHybridSnapshotMock.mockResolvedValue({
      combinedTree: "tree content",
      combinedXpathMap: { "1-0": "/html/body/button" },
      combinedUrlMap: {},
    });

    const { performUnderstudyMethod } = await import(
      "../lib/v3/handlers/handlerUtils/actHandlerUtils"
    );
    const performUnderstudyMethodMock = vi.mocked(performUnderstudyMethod);
    // First call fails, triggering self-heal
    performUnderstudyMethodMock.mockRejectedValueOnce(
      new Error("Element not found"),
    );

    const actInferenceMock = vi.mocked(actInference);
    actInferenceMock.mockResolvedValueOnce({
      element: {
        elementId: "1-0",
        description: "click button",
        method: "click",
        arguments: [],
      },
      twoStep: false,
      prompt_tokens: 100,
      completion_tokens: 50,
      inference_time_ms: 500,
    } as ReturnType<typeof actInference> extends Promise<infer T> ? T : never);

    // Timeout during self-heal LLM inference (call 8)
    let callCount = 0;
    vi.mocked(createTimeoutGuard).mockImplementation(
      (timeoutMs, errorFactory) => {
        return vi.fn(() => {
          callCount += 1;
          // Timeout during self-heal LLM call
          if (callCount >= 8) {
            throw errorFactory
              ? errorFactory(timeoutMs!)
              : new ActTimeoutError(timeoutMs!);
          }
        });
      },
    );

    const handler = buildActHandler({ selfHeal: true });
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    await expect(
      handler.act({
        instruction: "click button",
        page: fakePage,
        timeout: 50,
      }),
    ).rejects.toThrow(ActTimeoutError);

    // Self-heal snapshot was captured
    expect(captureHybridSnapshotMock).toHaveBeenCalledTimes(2);
    // Only one LLM inference (the retry inference was aborted by timeout)
    expect(actInferenceMock).toHaveBeenCalledTimes(1);
  });
});

describe("ExtractHandler timeout guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws ExtractTimeoutError when timeout expires before snapshot", async () => {
    const captureHybridSnapshotMock = vi.mocked(captureHybridSnapshot);
    captureHybridSnapshotMock.mockResolvedValue({
      combinedTree: "tree content",
      combinedXpathMap: {},
      combinedUrlMap: {},
    });

    const extractInferenceMock = vi.mocked(extractInference);

    // Throw immediately on first call
    vi.mocked(createTimeoutGuard).mockImplementation(
      (timeoutMs, errorFactory) => {
        return vi.fn(() => {
          throw errorFactory
            ? errorFactory(timeoutMs!)
            : new ExtractTimeoutError(timeoutMs!);
        });
      },
    );

    const handler = buildExtractHandler();
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    await expect(
      handler.extract({
        instruction: "extract title",
        page: fakePage,
        timeout: 5,
      }),
    ).rejects.toThrow(ExtractTimeoutError);

    // Snapshot should NOT have been called
    expect(captureHybridSnapshotMock).not.toHaveBeenCalled();
    // LLM inference should NOT have been called
    expect(extractInferenceMock).not.toHaveBeenCalled();
  });

  it("throws ExtractTimeoutError when timeout expires before LLM call", async () => {
    const captureHybridSnapshotMock = vi.mocked(captureHybridSnapshot);
    captureHybridSnapshotMock.mockResolvedValue({
      combinedTree: "tree content",
      combinedXpathMap: {},
      combinedUrlMap: {},
    });

    const extractInferenceMock = vi.mocked(extractInference);

    // Throw on call #2 (after snapshot but before LLM)
    vi.mocked(createTimeoutGuard).mockImplementation(
      (timeoutMs, errorFactory) => {
        let calls = 0;
        return vi.fn(() => {
          calls += 1;
          if (calls >= 2) {
            throw errorFactory
              ? errorFactory(timeoutMs!)
              : new ExtractTimeoutError(timeoutMs!);
          }
        });
      },
    );

    const handler = buildExtractHandler();
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    await expect(
      handler.extract({
        instruction: "extract title",
        page: fakePage,
        timeout: 5,
      }),
    ).rejects.toThrow(ExtractTimeoutError);

    // Snapshot should have been called
    expect(captureHybridSnapshotMock).toHaveBeenCalledTimes(1);
    // LLM inference should NOT have been called
    expect(extractInferenceMock).not.toHaveBeenCalled();
  });

  it("throws ExtractTimeoutError with correct message format", async () => {
    const timeoutMs = 200;

    vi.mocked(createTimeoutGuard).mockImplementation((ms, errorFactory) => {
      return vi.fn(() => {
        throw errorFactory ? errorFactory(ms!) : new ExtractTimeoutError(ms!);
      });
    });

    const handler = buildExtractHandler();
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    try {
      await handler.extract({
        instruction: "extract title",
        page: fakePage,
        timeout: timeoutMs,
      });
      throw new Error("Expected ExtractTimeoutError to be thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ExtractTimeoutError);
      expect((error as ExtractTimeoutError).message).toContain("extract()");
      expect((error as ExtractTimeoutError).message).toContain(
        `${timeoutMs}ms`,
      );
      expect((error as ExtractTimeoutError).name).toBe("ExtractTimeoutError");
    }
  });

  it("stops LLM and post-processing when timeout expires", async () => {
    const captureHybridSnapshotMock = vi.mocked(captureHybridSnapshot);
    captureHybridSnapshotMock.mockResolvedValue({
      combinedTree: "tree content",
      combinedXpathMap: {},
      combinedUrlMap: { "1-0": "https://example.com" },
    });

    const extractInferenceMock = vi.mocked(extractInference);

    // Allow snapshot but timeout before LLM
    vi.mocked(createTimeoutGuard).mockImplementation(
      (timeoutMs, errorFactory) => {
        let calls = 0;
        return vi.fn(() => {
          calls += 1;
          if (calls >= 2) {
            throw errorFactory
              ? errorFactory(timeoutMs!)
              : new ExtractTimeoutError(timeoutMs!);
          }
        });
      },
    );

    const handler = buildExtractHandler();
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    await expect(
      handler.extract({
        instruction: "extract links",
        page: fakePage,
        timeout: 5,
      }),
    ).rejects.toThrow(ExtractTimeoutError);

    // Post-processing (URL injection) never runs because LLM was never called
    expect(extractInferenceMock).not.toHaveBeenCalled();
  });
});

describe("ObserveHandler timeout guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws ObserveTimeoutError when timeout expires before snapshot", async () => {
    const captureHybridSnapshotMock = vi.mocked(captureHybridSnapshot);
    captureHybridSnapshotMock.mockResolvedValue({
      combinedTree: "tree content",
      combinedXpathMap: {},
      combinedUrlMap: {},
    });

    const observeInferenceMock = vi.mocked(observeInference);

    // Throw immediately on first call
    vi.mocked(createTimeoutGuard).mockImplementation(
      (timeoutMs, errorFactory) => {
        return vi.fn(() => {
          throw errorFactory
            ? errorFactory(timeoutMs!)
            : new ObserveTimeoutError(timeoutMs!);
        });
      },
    );

    const handler = buildObserveHandler();
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    await expect(
      handler.observe({
        instruction: "find buttons",
        page: fakePage,
        timeout: 5,
      }),
    ).rejects.toThrow(ObserveTimeoutError);

    // Snapshot should NOT have been called
    expect(captureHybridSnapshotMock).not.toHaveBeenCalled();
    // LLM inference should NOT have been called
    expect(observeInferenceMock).not.toHaveBeenCalled();
  });

  it("throws ObserveTimeoutError when timeout expires before LLM call", async () => {
    const captureHybridSnapshotMock = vi.mocked(captureHybridSnapshot);
    captureHybridSnapshotMock.mockResolvedValue({
      combinedTree: "tree content",
      combinedXpathMap: {},
      combinedUrlMap: {},
    });

    const observeInferenceMock = vi.mocked(observeInference);

    // Throw on call #2 (after snapshot but before LLM)
    vi.mocked(createTimeoutGuard).mockImplementation(
      (timeoutMs, errorFactory) => {
        let calls = 0;
        return vi.fn(() => {
          calls += 1;
          if (calls >= 2) {
            throw errorFactory
              ? errorFactory(timeoutMs!)
              : new ObserveTimeoutError(timeoutMs!);
          }
        });
      },
    );

    const handler = buildObserveHandler();
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    await expect(
      handler.observe({
        instruction: "find buttons",
        page: fakePage,
        timeout: 5,
      }),
    ).rejects.toThrow(ObserveTimeoutError);

    // Snapshot should have been called
    expect(captureHybridSnapshotMock).toHaveBeenCalledTimes(1);
    // LLM inference should NOT have been called
    expect(observeInferenceMock).not.toHaveBeenCalled();
  });

  it("throws ObserveTimeoutError with correct message format", async () => {
    const timeoutMs = 150;

    vi.mocked(createTimeoutGuard).mockImplementation((ms, errorFactory) => {
      return vi.fn(() => {
        throw errorFactory ? errorFactory(ms!) : new ObserveTimeoutError(ms!);
      });
    });

    const handler = buildObserveHandler();
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    try {
      await handler.observe({
        instruction: "find buttons",
        page: fakePage,
        timeout: timeoutMs,
      });
      throw new Error("Expected ObserveTimeoutError to be thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ObserveTimeoutError);
      expect((error as ObserveTimeoutError).message).toContain("observe()");
      expect((error as ObserveTimeoutError).message).toContain(
        `${timeoutMs}ms`,
      );
      expect((error as ObserveTimeoutError).name).toBe("ObserveTimeoutError");
    }
  });

  it("aborts result processing when timeout expires", async () => {
    const captureHybridSnapshotMock = vi.mocked(captureHybridSnapshot);
    captureHybridSnapshotMock.mockResolvedValue({
      combinedTree: "tree content",
      combinedXpathMap: { "1-0": "/html/body/button" },
      combinedUrlMap: {},
    });

    const observeInferenceMock = vi.mocked(observeInference);

    // Timeout before LLM call
    vi.mocked(createTimeoutGuard).mockImplementation(
      (timeoutMs, errorFactory) => {
        let calls = 0;
        return vi.fn(() => {
          calls += 1;
          if (calls >= 2) {
            throw errorFactory
              ? errorFactory(timeoutMs!)
              : new ObserveTimeoutError(timeoutMs!);
          }
        });
      },
    );

    const handler = buildObserveHandler();
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    await expect(
      handler.observe({
        instruction: "find all interactive elements",
        page: fakePage,
        timeout: 5,
      }),
    ).rejects.toThrow(ObserveTimeoutError);

    // Result mapping/processing never happens
    expect(observeInferenceMock).not.toHaveBeenCalled();
  });
});

describe("No-timeout success paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("act() completes successfully without timeout and records metrics", async () => {
    const waitForDomNetworkQuietMock = vi.mocked(waitForDomNetworkQuiet);
    waitForDomNetworkQuietMock.mockResolvedValue(undefined);

    const captureHybridSnapshotMock = vi.mocked(captureHybridSnapshot);
    captureHybridSnapshotMock.mockResolvedValue({
      combinedTree: "tree content",
      combinedXpathMap: { "1-0": "/html/body/button" },
      combinedUrlMap: {},
    });

    const { performUnderstudyMethod } = await import(
      "../lib/v3/handlers/handlerUtils/actHandlerUtils"
    );
    const performUnderstudyMethodMock = vi.mocked(performUnderstudyMethod);
    performUnderstudyMethodMock.mockResolvedValue(undefined);

    const actInferenceMock = vi.mocked(actInference);
    actInferenceMock.mockResolvedValue({
      element: {
        elementId: "1-0",
        description: "click button",
        method: "click",
        arguments: [],
      },
      twoStep: false,
      prompt_tokens: 100,
      completion_tokens: 50,
      reasoning_tokens: 10,
      cached_input_tokens: 5,
      inference_time_ms: 500,
    } as ReturnType<typeof actInference> extends Promise<infer T> ? T : never);

    // No timeout - guard never throws
    vi.mocked(createTimeoutGuard).mockImplementation(() => {
      return vi.fn(() => {
        // No-op - never throws
      });
    });

    const metricsCallback = vi.fn();
    const handler = buildActHandler({ onMetrics: metricsCallback });
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    const result = await handler.act({
      instruction: "click button",
      page: fakePage,
      // No timeout specified
    });

    expect(result.success).toBe(true);
    expect(metricsCallback).toHaveBeenCalledWith(
      V3FunctionName.ACT,
      100,
      50,
      10,
      5,
      500,
    );
  });

  it("extract() completes successfully without timeout and records metrics", async () => {
    const captureHybridSnapshotMock = vi.mocked(captureHybridSnapshot);
    captureHybridSnapshotMock.mockResolvedValue({
      combinedTree: "tree content",
      combinedXpathMap: {},
      combinedUrlMap: {},
    });

    const extractInferenceMock = vi.mocked(extractInference);
    extractInferenceMock.mockResolvedValue({
      title: "Test Title",
      metadata: { completed: true, progress: "100%" },
      prompt_tokens: 200,
      completion_tokens: 100,
      reasoning_tokens: 20,
      cached_input_tokens: 10,
      inference_time_ms: 800,
    } as ReturnType<typeof extractInference> extends Promise<infer T>
      ? T
      : never);

    // No timeout - guard never throws
    vi.mocked(createTimeoutGuard).mockImplementation(() => {
      return vi.fn(() => {
        // No-op - never throws
      });
    });

    const metricsCallback = vi.fn();
    const handler = buildExtractHandler({ onMetrics: metricsCallback });
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    const result = await handler.extract({
      instruction: "extract title",
      page: fakePage,
      // No timeout specified
    });

    expect(result).toHaveProperty("title", "Test Title");
    expect(metricsCallback).toHaveBeenCalledWith(
      V3FunctionName.EXTRACT,
      200,
      100,
      20,
      10,
      800,
    );
  });

  it("observe() completes successfully without timeout and records metrics", async () => {
    const captureHybridSnapshotMock = vi.mocked(captureHybridSnapshot);
    captureHybridSnapshotMock.mockResolvedValue({
      combinedTree: "tree content",
      combinedXpathMap: { "1-0": "/html/body/button" },
      combinedUrlMap: {},
    });

    const observeInferenceMock = vi.mocked(observeInference);
    observeInferenceMock.mockResolvedValue({
      elements: [
        {
          elementId: "1-0",
          description: "Submit button",
        },
      ],
      prompt_tokens: 150,
      completion_tokens: 75,
      reasoning_tokens: 15,
      cached_input_tokens: 8,
      inference_time_ms: 600,
    } as ReturnType<typeof observeInference> extends Promise<infer T>
      ? T
      : never);

    // No timeout - guard never throws
    vi.mocked(createTimeoutGuard).mockImplementation(() => {
      return vi.fn(() => {
        // No-op - never throws
      });
    });

    const metricsCallback = vi.fn();
    const handler = buildObserveHandler({ onMetrics: metricsCallback });
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    const result = await handler.observe({
      instruction: "find buttons",
      page: fakePage,
      // No timeout specified
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty("description", "Submit button");
    expect(metricsCallback).toHaveBeenCalledWith(
      V3FunctionName.OBSERVE,
      150,
      75,
      15,
      8,
      600,
    );
  });

  it("act() with zero timeout behaves as no timeout", async () => {
    const waitForDomNetworkQuietMock = vi.mocked(waitForDomNetworkQuiet);
    waitForDomNetworkQuietMock.mockResolvedValue(undefined);

    const captureHybridSnapshotMock = vi.mocked(captureHybridSnapshot);
    captureHybridSnapshotMock.mockResolvedValue({
      combinedTree: "tree content",
      combinedXpathMap: { "1-0": "/html/body/button" },
      combinedUrlMap: {},
    });

    const { performUnderstudyMethod } = await import(
      "../lib/v3/handlers/handlerUtils/actHandlerUtils"
    );
    const performUnderstudyMethodMock = vi.mocked(performUnderstudyMethod);
    performUnderstudyMethodMock.mockResolvedValue(undefined);

    const actInferenceMock = vi.mocked(actInference);
    actInferenceMock.mockResolvedValue({
      element: {
        elementId: "1-0",
        description: "click button",
        method: "click",
        arguments: [],
      },
      twoStep: false,
      prompt_tokens: 100,
      completion_tokens: 50,
      inference_time_ms: 500,
    } as ReturnType<typeof actInference> extends Promise<infer T> ? T : never);

    // When timeout is 0 or negative, createTimeoutGuard returns a no-op
    vi.mocked(createTimeoutGuard).mockImplementation((timeoutMs) => {
      if (!timeoutMs || timeoutMs <= 0) {
        return vi.fn(() => {
          // No-op
        });
      }
      return vi.fn(() => {
        throw new ActTimeoutError(timeoutMs);
      });
    });

    const handler = buildActHandler();
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    const result = await handler.act({
      instruction: "click button",
      page: fakePage,
      timeout: 0, // Zero timeout should be treated as "no timeout"
    });

    expect(result.success).toBe(true);
  });

  it("act() with negative timeout behaves as no timeout", async () => {
    const waitForDomNetworkQuietMock = vi.mocked(waitForDomNetworkQuiet);
    waitForDomNetworkQuietMock.mockResolvedValue(undefined);

    const captureHybridSnapshotMock = vi.mocked(captureHybridSnapshot);
    captureHybridSnapshotMock.mockResolvedValue({
      combinedTree: "tree content",
      combinedXpathMap: { "1-0": "/html/body/button" },
      combinedUrlMap: {},
    });

    const { performUnderstudyMethod } = await import(
      "../lib/v3/handlers/handlerUtils/actHandlerUtils"
    );
    const performUnderstudyMethodMock = vi.mocked(performUnderstudyMethod);
    performUnderstudyMethodMock.mockResolvedValue(undefined);

    const actInferenceMock = vi.mocked(actInference);
    actInferenceMock.mockResolvedValue({
      element: {
        elementId: "1-0",
        description: "click button",
        method: "click",
        arguments: [],
      },
      twoStep: false,
      prompt_tokens: 100,
      completion_tokens: 50,
      inference_time_ms: 500,
    } as ReturnType<typeof actInference> extends Promise<infer T> ? T : never);

    vi.mocked(createTimeoutGuard).mockImplementation((timeoutMs) => {
      if (!timeoutMs || timeoutMs <= 0) {
        return vi.fn(() => {
          // No-op
        });
      }
      return vi.fn(() => {
        throw new ActTimeoutError(timeoutMs);
      });
    });

    const handler = buildActHandler();
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    const result = await handler.act({
      instruction: "click button",
      page: fakePage,
      timeout: -100, // Negative timeout should be treated as "no timeout"
    });

    expect(result.success).toBe(true);
  });
});

interface BuildActHandlerOptions {
  selfHeal?: boolean;
  onMetrics?: (
    functionName: V3FunctionName,
    promptTokens: number,
    completionTokens: number,
    reasoningTokens: number,
    cachedInputTokens: number,
    inferenceTimeMs: number,
  ) => void;
}

function buildActHandler(options: BuildActHandlerOptions = {}): ActHandler {
  const defaultClientOptions = {} as ClientOptions;
  const fakeClient = {
    type: "openai",
    modelName: "gpt-4o",
    clientOptions: defaultClientOptions,
  } as LLMClient;
  const resolveLlmClient = vi.fn().mockReturnValue(fakeClient);

  return new ActHandler(
    fakeClient,
    "gpt-4o",
    defaultClientOptions,
    resolveLlmClient,
    undefined,
    false,
    options.selfHeal ?? false,
    options.onMetrics,
    undefined,
  );
}

interface BuildExtractHandlerOptions {
  onMetrics?: (
    functionName: V3FunctionName,
    promptTokens: number,
    completionTokens: number,
    reasoningTokens: number,
    cachedInputTokens: number,
    inferenceTimeMs: number,
  ) => void;
}

function buildExtractHandler(
  options: BuildExtractHandlerOptions = {},
): ExtractHandler {
  const defaultClientOptions = {} as ClientOptions;
  const fakeClient = {
    type: "openai",
    modelName: "gpt-4o",
    clientOptions: defaultClientOptions,
  } as LLMClient;
  const resolveLlmClient = vi.fn().mockReturnValue(fakeClient);

  return new ExtractHandler(
    fakeClient,
    "gpt-4o",
    defaultClientOptions,
    resolveLlmClient,
    undefined,
    false,
    false,
    options.onMetrics,
  );
}

interface BuildObserveHandlerOptions {
  onMetrics?: (
    functionName: V3FunctionName,
    promptTokens: number,
    completionTokens: number,
    reasoningTokens: number,
    cachedInputTokens: number,
    inferenceTimeMs: number,
  ) => void;
}

function buildObserveHandler(
  options: BuildObserveHandlerOptions = {},
): ObserveHandler {
  const defaultClientOptions = {} as ClientOptions;
  const fakeClient = {
    type: "openai",
    modelName: "gpt-4o",
    clientOptions: defaultClientOptions,
  } as LLMClient;
  const resolveLlmClient = vi.fn().mockReturnValue(fakeClient);

  return new ObserveHandler(
    fakeClient,
    "gpt-4o",
    defaultClientOptions,
    resolveLlmClient,
    undefined,
    false,
    false,
    options.onMetrics,
  );
}
