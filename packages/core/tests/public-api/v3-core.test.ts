import { describe, expect, expectTypeOf, it } from "vitest";
import * as Stagehand from "../../dist/index.js";

describe("V3 Core public API types", () => {
  describe("Stagehand", () => {
    type ExpectedShape = {
      init: () => Promise<void>;
      close: (opts?: { force?: boolean }) => Promise<void>;
      act: (
        instruction: string,
        options?: Stagehand.ActOptions,
      ) => Promise<Stagehand.ActResult>;
      extract: () => Promise<{ pageText: string }>;
      observe: () => Promise<Stagehand.Action[]>;
      agent: (config?: Stagehand.AgentConfig) => {
        execute: (
          instructionOrOptions: string | Stagehand.AgentExecuteOptions,
        ) => Promise<Stagehand.AgentResult>;
      };
      connectURL: () => string;
      context: unknown;
      metrics: Promise<Stagehand.StagehandMetrics>;
      history: Promise<ReadonlyArray<unknown>>;
      llmClient: Stagehand.LLMClient;
      browserbaseSessionID: string | undefined;
      browserbaseSessionURL: string | undefined;
      browserbaseDebugURL: string | undefined;
      experimental: boolean;
      logInferenceToFile: boolean;
      verbose: 0 | 1 | 2;
      logger: (logLine: Stagehand.LogLine) => void;
    };

    type StagehandInstance = InstanceType<typeof Stagehand.Stagehand>;

    it("has correct public interface shape", () => {
      expectTypeOf<StagehandInstance>().toExtend<ExpectedShape>();
    });
  });

  describe("StagehandMetrics", () => {
    type ExpectedStagehandMetrics = {
      actPromptTokens: number;
      actCompletionTokens: number;
      actReasoningTokens: number;
      actCachedInputTokens: number;
      actInferenceTimeMs: number;
      extractPromptTokens: number;
      extractCompletionTokens: number;
      extractReasoningTokens: number;
      extractCachedInputTokens: number;
      extractInferenceTimeMs: number;
      observePromptTokens: number;
      observeCompletionTokens: number;
      observeReasoningTokens: number;
      observeCachedInputTokens: number;
      observeInferenceTimeMs: number;
      agentPromptTokens: number;
      agentCompletionTokens: number;
      agentReasoningTokens: number;
      agentCachedInputTokens: number;
      agentInferenceTimeMs: number;
      totalPromptTokens: number;
      totalCompletionTokens: number;
      totalReasoningTokens: number;
      totalCachedInputTokens: number;
      totalInferenceTimeMs: number;
    };

    it("matches the published metrics shape", () => {
      expectTypeOf<Stagehand.StagehandMetrics>().toEqualTypeOf<ExpectedStagehandMetrics>();
    });
  });

  describe("V3", () => {
    // V3 is the same class as Stagehand, just re-exported with a different name.
    // The public interface shape is already tested in the "Stagehand" test above.
    it("is exported", () => {
      expect(Stagehand.V3).toBeDefined();
    });
  });

  describe("V3Evaluator", () => {
    // TODO: Complex class type - needs detailed contract testing
    it("is exported", () => {
      expect(Stagehand.V3Evaluator).toBeDefined();
    });
  });

  describe("V3FunctionName", () => {
    const expectedFunctionNames = [
      "ACT",
      "EXTRACT",
      "OBSERVE",
      "AGENT",
    ] as const;

    it("matches the known function name literals", () => {
      expectTypeOf<Stagehand.V3FunctionName>().toExtend<
        (typeof expectedFunctionNames)[number]
      >();
      void expectedFunctionNames; // Mark as used to satisfy ESLint
    });
  });

  describe("connectToMCPServer", () => {
    type ExpectedServerConfig =
      | string
      | URL
      | { command: string; args?: string[]; env?: Record<string, string> }
      | { serverUrl: string | URL; clientOptions?: unknown };

    it("has correct parameter types", () => {
      expectTypeOf(
        Stagehand.connectToMCPServer,
      ).parameters.branded.toEqualTypeOf<[ExpectedServerConfig]>();
    });
  });

  describe("LOG_LEVEL_NAMES", () => {
    type ExpectedLOG_LEVEL_NAMES = Record<Stagehand.LogLevel, string>;

    it("maps numeric levels to strings", () => {
      expectTypeOf<
        typeof Stagehand.LOG_LEVEL_NAMES
      >().toExtend<ExpectedLOG_LEVEL_NAMES>();
    });
  });
});
