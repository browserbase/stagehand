import type { LanguageModelV2 } from "@ai-sdk/provider";
import { generateObject, generateText, streamObject, streamText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LLMClient } from "../../lib/v3/llm/LLMClient.js";
import type {
  AvailableModel,
  ClientOptions,
} from "../../lib/v3/types/public/model.js";

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateObject: vi.fn(),
    generateText: vi.fn(),
    streamObject: vi.fn(),
    streamText: vi.fn(),
  };
});

const mockGenerateObject = vi.mocked(generateObject);
const mockGenerateText = vi.mocked(generateText);
const mockStreamObject = vi.mocked(streamObject);
const mockStreamText = vi.mocked(streamText);

function createModel(modelId: string) {
  return {
    modelId,
    specificationVersion: "v2",
  } as unknown as LanguageModelV2;
}

class TestLLMClient extends LLMClient {
  public type = "test";
  public hasVision = false;
  public clientOptions = {} as ClientOptions;

  constructor(private readonly model: LanguageModelV2) {
    super(model.modelId as AvailableModel);
  }

  public getLanguageModel(): LanguageModelV2 {
    return this.model;
  }

  async createChatCompletion<T>(): Promise<T> {
    return {} as T;
  }
}

class LegacyLLMClient extends LLMClient {
  public type = "test";
  public hasVision = false;
  public clientOptions = {} as ClientOptions;

  constructor() {
    super("test/model" as AvailableModel);
  }

  async createChatCompletion<T>(): Promise<T> {
    return {} as T;
  }
}

describe("LLMClient AI SDK helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateObject.mockResolvedValue({ object: {} } as never);
    mockGenerateText.mockResolvedValue({ text: "" } as never);
    mockStreamObject.mockReturnValue({} as never);
    mockStreamText.mockReturnValue({} as never);
  });

  it("injects the client language model when helper calls omit model", async () => {
    const model = createModel("openai/gpt-4.1");
    const client = new TestLLMClient(model);

    await client.generateText({ prompt: "hello" });
    await client.generateObject({ prompt: "hello", schema: {} as never });
    client.streamText({ prompt: "hello" });
    client.streamObject({ prompt: "hello", schema: {} as never });

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({ model }),
    );
    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({ model }),
    );
    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({ model }),
    );
    expect(mockStreamObject).toHaveBeenCalledWith(
      expect.objectContaining({ model }),
    );
  });

  it("keeps explicit model overrides", async () => {
    const client = new TestLLMClient(createModel("openai/gpt-4.1"));
    const overrideModel = createModel("anthropic/claude-sonnet-4-5");

    await client.generateText({
      model: overrideModel,
      prompt: "hello",
    });

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({ model: overrideModel }),
    );
  });

  it("throws a clear error when no model can be resolved", () => {
    const client = new LegacyLLMClient();

    expect(() => client.streamText({ prompt: "hello" })).toThrow(
      "No language model available",
    );
  });
});
