/**
 * Tests for xpath lookup failure logging (STG-1209)
 *
 * When the LLM returns an element ID that has no corresponding xpath in the map,
 * we should:
 * - Log a level 0 message: "LLM returned ID x, there is no xpath keyed by this ID"
 * - act() should return success: false
 * - observe() should filter out Actions where xpath lookup failed
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActHandler } from "../lib/v3/handlers/actHandler";
import { ObserveHandler } from "../lib/v3/handlers/observeHandler";
import type { Page } from "../lib/v3/understudy/page";
import type { ClientOptions } from "../lib/v3/types/public/model";
import type { LLMClient } from "../lib/v3/llm/LLMClient";
import { createTimeoutGuard } from "../lib/v3/handlers/handlerUtils/timeoutGuard";
import { waitForDomNetworkQuiet } from "../lib/v3/handlers/handlerUtils/actHandlerUtils";
import { captureHybridSnapshot } from "../lib/v3/understudy/a11y/snapshot";
import {
  act as actInference,
  observe as observeInference,
} from "../lib/inference";
import * as logger from "../lib/v3/logger";

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
  observe: vi.fn(),
}));

describe("ActHandler xpath lookup failure logging", () => {
  let loggerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    loggerSpy = vi.spyOn(logger, "v3Logger").mockImplementation(() => {});
  });

  it("should log level 0 message and return success: false when LLM returns element ID with no xpath", async () => {
    const waitForDomNetworkQuietMock = vi.mocked(waitForDomNetworkQuiet);
    waitForDomNetworkQuietMock.mockResolvedValue(undefined);

    const captureHybridSnapshotMock = vi.mocked(captureHybridSnapshot);
    // Note: xpathMap does NOT contain "1-999" - this simulates a missing xpath
    captureHybridSnapshotMock.mockResolvedValue({
      combinedTree: "tree content",
      combinedXpathMap: {
        "1-0": "/html/body/div[1]",
        "1-1": "/html/body/div[2]",
        // "1-999" is NOT in the map - this is the element ID the LLM will return
      },
      combinedUrlMap: {},
    });

    const actInferenceMock = vi.mocked(actInference);
    // LLM returns an element with ID "1-999" which doesn't exist in the xpath map
    actInferenceMock.mockResolvedValue({
      element: {
        elementId: "1-999", // This ID is NOT in combinedXpathMap
        description: "click missing button",
        method: "click",
        arguments: [],
      },
      twoStep: false,
      prompt_tokens: 100,
      completion_tokens: 50,
      inference_time_ms: 500,
    } as ReturnType<typeof actInference> extends Promise<infer T> ? T : never);

    // No timeout - guard never throws
    vi.mocked(createTimeoutGuard).mockImplementation(() => {
      return vi.fn(() => {});
    });

    const handler = buildActHandler();
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    const result = await handler.act({
      instruction: "click the missing button",
      page: fakePage,
    });

    // act should return success: false
    expect(result.success).toBe(false);

    // Should log a level 0 message about the xpath lookup failure
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 0,
        message: expect.stringMatching(
          /LLM returned ID.*1-999.*no xpath keyed by this ID/i
        ),
      })
    );
  });

  it("should return success: false with descriptive message when xpath lookup fails", async () => {
    const waitForDomNetworkQuietMock = vi.mocked(waitForDomNetworkQuiet);
    waitForDomNetworkQuietMock.mockResolvedValue(undefined);

    const captureHybridSnapshotMock = vi.mocked(captureHybridSnapshot);
    captureHybridSnapshotMock.mockResolvedValue({
      combinedTree: "tree content",
      combinedXpathMap: {},  // Empty map - no xpaths at all
      combinedUrlMap: {},
    });

    const actInferenceMock = vi.mocked(actInference);
    actInferenceMock.mockResolvedValue({
      element: {
        elementId: "0-42",
        description: "click button",
        method: "click",
        arguments: [],
      },
      twoStep: false,
      prompt_tokens: 100,
      completion_tokens: 50,
      inference_time_ms: 500,
    } as ReturnType<typeof actInference> extends Promise<infer T> ? T : never);

    vi.mocked(createTimeoutGuard).mockImplementation(() => {
      return vi.fn(() => {});
    });

    const handler = buildActHandler();
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    const result = await handler.act({
      instruction: "click button",
      page: fakePage,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("No action found");
  });
});

describe("ObserveHandler xpath lookup failure logging", () => {
  let loggerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    loggerSpy = vi.spyOn(logger, "v3Logger").mockImplementation(() => {});
  });

  it("should log level 0 message and filter out actions when element ID has no xpath", async () => {
    const captureHybridSnapshotMock = vi.mocked(captureHybridSnapshot);
    // xpath map only contains "1-0", but LLM will also return "1-999"
    captureHybridSnapshotMock.mockResolvedValue({
      combinedTree: "tree content",
      combinedXpathMap: {
        "1-0": "/html/body/button[1]",
        // "1-999" is NOT in the map
      },
      combinedUrlMap: {},
    });

    const observeInferenceMock = vi.mocked(observeInference);
    // LLM returns two elements - one valid, one with missing xpath
    observeInferenceMock.mockResolvedValue({
      elements: [
        {
          elementId: "1-0",  // This one has a valid xpath
          description: "Valid button",
          method: "click",
          arguments: [],
        },
        {
          elementId: "1-999",  // This one does NOT have a valid xpath
          description: "Missing button",
          method: "click",
          arguments: [],
        },
      ],
      prompt_tokens: 150,
      completion_tokens: 75,
      inference_time_ms: 600,
    } as ReturnType<typeof observeInference> extends Promise<infer T>
      ? T
      : never);

    vi.mocked(createTimeoutGuard).mockImplementation(() => {
      return vi.fn(() => {});
    });

    const handler = buildObserveHandler();
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    const result = await handler.observe({
      instruction: "find buttons",
      page: fakePage,
    });

    // Should only return the valid element (1-0), filtering out the missing one (1-999)
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe("Valid button");
    expect(result[0].selector).toBe("xpath=/html/body/button[1]");

    // Should log a level 0 message about the xpath lookup failure
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 0,
        message: expect.stringMatching(
          /LLM returned ID.*1-999.*no xpath keyed by this ID/i
        ),
      })
    );
  });

  it("should filter out all elements when none have valid xpaths", async () => {
    const captureHybridSnapshotMock = vi.mocked(captureHybridSnapshot);
    captureHybridSnapshotMock.mockResolvedValue({
      combinedTree: "tree content",
      combinedXpathMap: {},  // Empty - no valid xpaths
      combinedUrlMap: {},
    });

    const observeInferenceMock = vi.mocked(observeInference);
    observeInferenceMock.mockResolvedValue({
      elements: [
        {
          elementId: "1-100",
          description: "Button 1",
          method: "click",
          arguments: [],
        },
        {
          elementId: "1-200",
          description: "Button 2",
          method: "click",
          arguments: [],
        },
      ],
      prompt_tokens: 150,
      completion_tokens: 75,
      inference_time_ms: 600,
    } as ReturnType<typeof observeInference> extends Promise<infer T>
      ? T
      : never);

    vi.mocked(createTimeoutGuard).mockImplementation(() => {
      return vi.fn(() => {});
    });

    const handler = buildObserveHandler();
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    const result = await handler.observe({
      instruction: "find buttons",
      page: fakePage,
    });

    // Should return empty array since no elements have valid xpaths
    expect(result).toHaveLength(0);

    // Should log level 0 messages for both elements
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 0,
        message: expect.stringMatching(
          /LLM returned ID.*1-100.*no xpath keyed by this ID/i
        ),
      })
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 0,
        message: expect.stringMatching(
          /LLM returned ID.*1-200.*no xpath keyed by this ID/i
        ),
      })
    );
  });
});

function buildActHandler(): ActHandler {
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
    false,  // selfHeal
    undefined,  // onMetrics
    undefined,  // defaultDomSettleTimeoutMs
  );
}

function buildObserveHandler(): ObserveHandler {
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
    undefined,  // systemPrompt
    false,  // logInferenceToFile
    false,  // experimental
    undefined,  // onMetrics
  );
}
