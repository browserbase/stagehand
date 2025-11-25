import { describe, expect, expectTypeOf, it } from "vitest";
import * as Stagehand from "../../dist/index.js";

describe("LLM and Agents public API types", () => {
  describe("AISdkClient", () => {
    type AISdkClientInstance = InstanceType<typeof Stagehand.AISdkClient>;

    it("is exported", () => {
      expect(Stagehand.AISdkClient).toBeDefined();
    });

    it("extends LLMClient", () => {
      expectTypeOf<AISdkClientInstance>().toExtend<Stagehand.LLMClient>();
    });

    it("constructor accepts model parameter", () => {
      // AISdkClient constructor takes { model: LanguageModelV2 }
      type CtorParams = ConstructorParameters<typeof Stagehand.AISdkClient>;
      expectTypeOf<CtorParams["length"]>().toEqualTypeOf<1>();
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
      "microsoft/fara-7b",
    ] as const;

    it("AvailableCuaModel matches the known literals", () => {
      expectTypeOf<Stagehand.AvailableCuaModel>().toEqualTypeOf<
        (typeof expectedModels)[number]
      >();
      void expectedModels; // Mark as used to satisfy ESLint
    });
  });

  describe("AgentProvider", () => {
    type AgentProviderInstance = InstanceType<typeof Stagehand.AgentProvider>;

    it("is exported", () => {
      expect(Stagehand.AgentProvider).toBeDefined();
    });

    it("has getClient method", () => {
      expectTypeOf<AgentProviderInstance["getClient"]>().toBeCallableWith(
        "test-model",
      );
    });

    it("constructor accepts logger parameter", () => {
      expectTypeOf<
        ConstructorParameters<typeof Stagehand.AgentProvider>
      >().toEqualTypeOf<[(message: Stagehand.LogLine) => void]>();
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

  describe("AgentClient", () => {
    type AgentProviderInstance = InstanceType<typeof Stagehand.AgentProvider>;
    type GetClientReturn = ReturnType<AgentProviderInstance["getClient"]>;

    it("getClient returns object with expected methods", () => {
      type ExpectedShape = {
        execute: (
          options: Stagehand.AgentExecutionOptions,
        ) => Promise<Stagehand.AgentResult>;
        captureScreenshot: (
          options?: Record<string, unknown>,
        ) => Promise<unknown>;
        setViewport: (width: number, height: number) => void;
        setCurrentUrl: (url: string) => void;
        setScreenshotProvider: (provider: () => Promise<string>) => void;
        setActionHandler: (
          handler: (action: Stagehand.AgentAction) => Promise<void>,
        ) => void;
      };
      expectTypeOf<GetClientReturn>().toExtend<ExpectedShape>();
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

    type ExpectedCtorParams = [Stagehand.AvailableModel, string?];

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

    it("createChatCompletion supports generic return type", () => {
      type Result = { custom: string };
      type ExpectedSignature = (
        options: Stagehand.CreateChatCompletionOptions,
      ) => Promise<Result>;

      expectTypeOf<
        LLMClientInstance["createChatCompletion"]
      >().toExtend<ExpectedSignature>();
    });

    it("has additional methods", () => {
      // These methods exist on LLMClient but have complex signatures from the 'ai' library
      // We verify they exist by checking they're functions
      expectTypeOf<LLMClientInstance["generateText"]>().toExtend<
        (...args: unknown[]) => unknown
      >();
      expectTypeOf<LLMClientInstance["generateObject"]>().toExtend<
        (...args: unknown[]) => unknown
      >();
      expectTypeOf<LLMClientInstance["streamText"]>().toExtend<
        (...args: unknown[]) => unknown
      >();
      expectTypeOf<LLMClientInstance["streamObject"]>().toExtend<
        (...args: unknown[]) => unknown
      >();
      expectTypeOf<LLMClientInstance["generateImage"]>().toExtend<
        (...args: unknown[]) => unknown
      >();
      expectTypeOf<LLMClientInstance["embed"]>().toExtend<
        (...args: unknown[]) => unknown
      >();
      expectTypeOf<LLMClientInstance["embedMany"]>().toExtend<
        (...args: unknown[]) => unknown
      >();
      expectTypeOf<LLMClientInstance["transcribe"]>().toExtend<
        (...args: unknown[]) => unknown
      >();
      expectTypeOf<LLMClientInstance["generateSpeech"]>().toExtend<
        (...args: unknown[]) => unknown
      >();
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
      markFinished: (error: Error | null) => void;
      applyExtraInfo: (info: unknown) => void;
    };

    type ResponseInstance = InstanceType<typeof Stagehand.Response>;

    it("has correct public interface shape", () => {
      expectTypeOf<ResponseInstance>().toExtend<ExpectedShape>();
    });
  });
});
