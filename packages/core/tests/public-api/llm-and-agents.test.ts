import { describe, expect, expectTypeOf, it } from "vitest";
import * as Stagehand from "../../dist/index.js";

describe("LLM and Agents public API types", () => {
  describe("AISdkClient", () => {
    // TODO: Complex class type - needs detailed contract testing
    it("is exported", () => {
      expect(Stagehand.AISdkClient).toBeDefined();
    });
  });

  describe("AVAILABLE_CUA_MODELS", () => {
    const expectedModels = [
      "openai/computer-use-preview",
      "openai/computer-use-preview-2025-03-11",
      "anthropic/claude-3-7-sonnet-latest",
      "anthropic/claude-haiku-4-5-20251001",
      "anthropic/claude-sonnet-4-20250514",
      "anthropic/claude-sonnet-4-5-20250929",
      "google/gemini-2.5-computer-use-preview-10-2025",
    ] as const;

    it("AvailableCuaModel matches the known literals", () => {
      expectTypeOf<Stagehand.AvailableCuaModel>().toEqualTypeOf<
        (typeof expectedModels)[number]
      >();
      void expectedModels; // Mark as used to satisfy ESLint
    });
  });

  describe("AgentProvider", () => {
    // TODO: Complex class type - needs detailed contract testing
    it("is exported", () => {
      expect(Stagehand.AgentProvider).toBeDefined();
    });
  });

  describe("AnnotatedScreenshotText", () => {
    type ExpectedAnnotatedScreenshotText = string;

    it("is a string literal", () => {
      expectTypeOf<
        typeof Stagehand.AnnotatedScreenshotText
      >().toExtend<ExpectedAnnotatedScreenshotText>();
    });
  });

  describe("ConsoleMessage", () => {
    type ExpectedShape = {
      type: () => string;
      text: () => string;
      args: () => unknown[];
      location: () => {
        url?: string;
        lineNumber?: number;
        columnNumber?: number;
      };
      page: () => unknown;
      timestamp: () => number | undefined;
      raw: () => unknown;
      toString: () => string;
    };

    type ConsoleMessageInstance = InstanceType<typeof Stagehand.ConsoleMessage>;

    it("has correct public interface shape", () => {
      expectTypeOf<ConsoleMessageInstance>().toExtend<ExpectedShape>();
    });
  });

  describe("LLMClient", () => {
    type ExpectedShape = {
      type: "openai" | "anthropic" | "cerebras" | "groq" | (string & {});
      modelName: Stagehand.AvailableModel | (string & {});
      hasVision: boolean;
      clientOptions: Stagehand.ClientOptions;
      userProvidedInstructions?: string;
    };

    type ExpectedCtorParams = [
      Stagehand.AvailableModel,
      string?,
    ];

    type ExpectedBasicOptions = {
      options: {
        messages: Array<{
          role: "system" | "user" | "assistant";
          content: string | Array<unknown>;
        }>;
      };
      logger: (message: unknown) => void;
      retries?: number;
    };

    type ExpectedWithResponseModel = ExpectedBasicOptions & {
      options: ExpectedBasicOptions["options"] & {
        response_model: {
          name: string;
          schema: Stagehand.StagehandZodSchema;
        };
      };
    };

    type LLMClientInstance = InstanceType<typeof Stagehand.LLMClient>;

    it("has correct public interface shape", () => {
      expectTypeOf<LLMClientInstance>().toExtend<ExpectedShape>();
    });

    it("constructor parameters match expected signature", () => {
      expectTypeOf<
        ConstructorParameters<typeof Stagehand.LLMClient>
      >().toEqualTypeOf<ExpectedCtorParams>();
    });

    it("createChatCompletion can be called with basic options", () => {
      expectTypeOf<
        LLMClientInstance["createChatCompletion"]
      >().toBeCallableWith({
        options: {
          messages: [
            {
              role: "user",
              content: "Hello",
            },
          ],
        },
        logger: () => {},
      } satisfies ExpectedBasicOptions);
    });

    it("createChatCompletion can be called with response_model", () => {
      const mockSchema = {} as Stagehand.StagehandZodSchema;
      expectTypeOf<
        LLMClientInstance["createChatCompletion"]
      >().toBeCallableWith({
        options: {
          messages: [
            {
              role: "user",
              content: "Extract data",
            },
          ],
          response_model: {
            name: "extracted",
            schema: mockSchema,
          },
        },
        logger: () => {},
      } satisfies ExpectedWithResponseModel);
    });
  });

  describe("modelToAgentProviderMap", () => {
    type ExpectedModelToAgentProviderMap = Record<
      string,
      Stagehand.AgentProviderType
    >;

    it("only stores valid provider types", () => {
      expectTypeOf<
        typeof Stagehand.modelToAgentProviderMap
      >().toExtend<ExpectedModelToAgentProviderMap>();
    });
  });

  describe("Response", () => {
    type ExpectedShape = {
      url: () => string;
      status: () => number;
      statusText: () => string;
      ok: () => boolean;
      frame: () => unknown;
      fromServiceWorker: () => boolean;
      securityDetails: () => Promise<unknown>;
      serverAddr: () => Promise<unknown>;
      headers: () => Record<string, string>;
      allHeaders: () => Promise<Record<string, string>>;
      headerValue: (name: string) => Promise<string | null>;
      headerValues: (name: string) => Promise<string[]>;
      headersArray: () => Promise<Array<{ name: string; value: string }>>;
      body: () => Promise<Buffer>;
      text: () => Promise<string>;
      json: <T = unknown>() => Promise<T>;
      finished: () => Promise<null | Error>;
    };

    type ResponseInstance = InstanceType<typeof Stagehand.Response>;

    it("has correct public interface shape", () => {
      expectTypeOf<ResponseInstance>().toExtend<ExpectedShape>();
    });
  });
});
