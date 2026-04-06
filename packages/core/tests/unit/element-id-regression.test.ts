import { beforeEach, describe, expect, it, vi } from "vitest";
import { act as runAct, observe as runObserve } from "../../lib/inference.js";
import { ActHandler } from "../../lib/v3/handlers/actHandler.js";
import { ObserveHandler } from "../../lib/v3/handlers/observeHandler.js";
import type { LLMClient } from "../../lib/v3/llm/LLMClient.js";
import type { Page } from "../../lib/v3/understudy/page.js";
import { waitForDomNetworkQuiet } from "../../lib/v3/handlers/handlerUtils/actHandlerUtils.js";
import { captureHybridSnapshot } from "../../lib/v3/understudy/a11y/snapshot/index.js";

vi.mock("../../lib/v3/handlers/handlerUtils/actHandlerUtils", () => ({
  waitForDomNetworkQuiet: vi.fn(),
  performUnderstudyMethod: vi.fn(),
}));

vi.mock("../../lib/v3/understudy/a11y/snapshot/index.js", () => ({
  captureHybridSnapshot: vi.fn(),
  diffCombinedTrees: vi.fn(),
}));

const usage = {
  prompt_tokens: 1,
  completion_tokens: 1,
  total_tokens: 2,
};

function buildSchemaValidatingLlmClient(
  payloads: Record<string, unknown>,
): LLMClient {
  return {
    type: "aisdk",
    modelName: "google/gemini-3-flash-preview",
    hasVision: false,
    clientOptions: {},
    createChatCompletion: async <T = unknown>({
      options,
    }: {
      options: {
        response_model?: {
          name: string;
          schema: {
            safeParseAsync: (data: unknown) => Promise<{
              success: boolean;
              data?: unknown;
              error?: unknown;
            }>;
          };
        };
      };
    }): Promise<T> => {
      const responseModel = options.response_model;
      if (!responseModel) {
        return { data: {}, usage } as T;
      }

      const result = await responseModel.schema.safeParseAsync(
        payloads[responseModel.name],
      );
      if (!result.success) {
        throw result.error;
      }

      return {
        data: result.data,
        usage,
      } as T;
    },
  } as LLMClient;
}

function buildActHandler(llmClient: LLMClient): ActHandler {
  return new ActHandler(
    llmClient,
    "google/gemini-3-flash-preview",
    {},
    () => llmClient,
  );
}

function buildObserveHandler(llmClient: LLMClient): ObserveHandler {
  return new ObserveHandler(
    llmClient,
    "google/gemini-3-flash-preview",
    {},
    () => llmClient,
  );
}

describe("typed element reference regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts structured act element refs and re-encodes them for upstream callers", async () => {
    const llmClient = buildSchemaValidatingLlmClient({
      act: {
        action: {
          target: {
            frameOrdinal: 0,
            backendNodeId: 9786,
          },
          description: "gear button",
          method: "click",
          button: null,
        },
        twoStep: false,
      },
    });

    await expect(
      runAct({
        instruction: "click the gear button",
        domElements: "[0-9786] button Gear",
        llmClient,
        logger: vi.fn(),
      }),
    ).resolves.toMatchObject({
      element: {
        elementId: "0-9786",
        description: "gear button",
        method: "click",
        arguments: [],
      },
      twoStep: false,
    });
  });

  it("accepts structured observe element refs and re-encodes them for upstream callers", async () => {
    const llmClient = buildSchemaValidatingLlmClient({
      Observation: {
        elements: [
          {
            target: {
              frameOrdinal: 0,
              backendNodeId: 9786,
            },
            description: "gear button",
            method: "click",
            button: null,
          },
        ],
      },
    });

    await expect(
      runObserve({
        instruction: "find the gear button",
        domElements: "[0-9786] button Gear",
        llmClient,
        logger: vi.fn(),
      }),
    ).resolves.toMatchObject({
      elements: [
        {
          elementId: "0-9786",
          description: "gear button",
          method: "click",
          arguments: [],
        },
      ],
    });
  });

  it("resolves structured act element refs against the encoded xpath map", async () => {
    const llmClient = buildSchemaValidatingLlmClient({
      act: {
        action: {
          target: {
            frameOrdinal: 0,
            backendNodeId: 9786,
          },
          description: "gear button",
          method: "click",
          button: null,
        },
        twoStep: false,
      },
    });
    vi.mocked(waitForDomNetworkQuiet).mockResolvedValue(undefined);
    vi.mocked(captureHybridSnapshot).mockResolvedValue({
      combinedTree: "[0-9786] button Gear",
      combinedXpathMap: {
        "0-9786": "/html/body/button",
      },
      combinedUrlMap: {},
    });

    const { performUnderstudyMethod } = await import(
      "../../lib/v3/handlers/handlerUtils/actHandlerUtils.js"
    );
    const performUnderstudyMethodMock = vi.mocked(performUnderstudyMethod);
    performUnderstudyMethodMock.mockResolvedValue(undefined);

    const handler = buildActHandler(llmClient);
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    await expect(
      handler.act({
        instruction: "click the gear button",
        page: fakePage,
      }),
    ).resolves.toMatchObject({
      success: true,
      actions: [
        {
          selector: "xpath=/html/body/button",
          method: "click",
          arguments: [],
        },
      ],
    });
  });

  it("resolves typed drag-and-drop refs against the encoded xpath map", async () => {
    const llmClient = buildSchemaValidatingLlmClient({
      act: {
        action: {
          target: {
            frameOrdinal: 0,
            backendNodeId: 9786,
          },
          destination: {
            frameOrdinal: 1,
            backendNodeId: 4321,
          },
          description: "drag the gear button into the dropzone",
          method: "dragAndDrop",
        },
        twoStep: false,
      },
    });
    vi.mocked(waitForDomNetworkQuiet).mockResolvedValue(undefined);
    vi.mocked(captureHybridSnapshot).mockResolvedValue({
      combinedTree: "[0-9786] button Gear\n[1-4321] region Dropzone",
      combinedXpathMap: {
        "0-9786": "/html/body/button",
        "1-4321": "/html/body/div[2]",
      },
      combinedUrlMap: {},
    });

    const { performUnderstudyMethod } = await import(
      "../../lib/v3/handlers/handlerUtils/actHandlerUtils.js"
    );
    const performUnderstudyMethodMock = vi.mocked(performUnderstudyMethod);
    performUnderstudyMethodMock.mockResolvedValue(undefined);

    const handler = buildActHandler(llmClient);
    const fakePage = {
      mainFrame: vi.fn().mockReturnValue({}),
    } as unknown as Page;

    await expect(
      handler.act({
        instruction: "drag the gear button into the dropzone",
        page: fakePage,
      }),
    ).resolves.toMatchObject({
      success: true,
      actions: [
        {
          selector: "xpath=/html/body/button",
          method: "dragAndDrop",
          arguments: ["xpath=/html/body/div[2]"],
        },
      ],
    });
  });

  it("resolves structured observe element refs against the encoded xpath map", async () => {
    const llmClient = buildSchemaValidatingLlmClient({
      Observation: {
        elements: [
          {
            target: {
              frameOrdinal: 0,
              backendNodeId: 9786,
            },
            description: "gear button",
            method: "click",
            button: null,
          },
        ],
      },
    });
    vi.mocked(captureHybridSnapshot).mockResolvedValue({
      combinedTree: "[0-9786] button Gear",
      combinedXpathMap: {
        "0-9786": "/html/body/button",
      },
      combinedUrlMap: {},
    });

    const handler = buildObserveHandler(llmClient);
    const fakePage = {} as Page;

    await expect(
      handler.observe({
        instruction: "find the gear button",
        page: fakePage,
      }),
    ).resolves.toEqual([
      {
        description: "gear button",
        method: "click",
        arguments: [],
        selector: "xpath=/html/body/button",
      },
    ]);
  });
});
