import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateExperimentalFeatures } from "../../lib/v3/agent/utils/validateExperimentalFeatures.js";
import { CUA_SUPPORTED_EXECUTE_OPTIONS } from "../../lib/v3/agent/AgentProvider.js";
import {
  ExperimentalNotConfiguredError,
  StagehandInvalidArgumentError,
} from "../../lib/v3/types/public/sdkErrors.js";

const cuaConfig = { mode: "cua" as const };

describe("validateExperimentalFeatures: CUA execute-option capabilities", () => {
  it("declares yutori support for excludeTools and output", () => {
    expect(CUA_SUPPORTED_EXECUTE_OPTIONS.yutori).toEqual({
      excludeTools: true,
      output: true,
    });
  });

  it("still rejects excludeTools/output in CUA mode without provider support", () => {
    expect(() =>
      validateExperimentalFeatures({
        isExperimental: true,
        agentConfig: cuaConfig,
        executeOptions: {
          instruction: "task",
          excludeTools: ["hold_key"],
        },
      }),
    ).toThrow(StagehandInvalidArgumentError);
    expect(() =>
      validateExperimentalFeatures({
        isExperimental: true,
        agentConfig: cuaConfig,
        executeOptions: {
          instruction: "task",
          output: z.object({ price: z.string() }),
        },
      }),
    ).toThrow(StagehandInvalidArgumentError);
  });

  it("accepts excludeTools/output in CUA mode when the provider supports them and experimental is on", () => {
    expect(() =>
      validateExperimentalFeatures({
        isExperimental: true,
        agentConfig: cuaConfig,
        executeOptions: {
          instruction: "task",
          excludeTools: ["hold_key"],
          output: z.object({ price: z.string() }),
        },
        cuaSupportedExecuteOptions: CUA_SUPPORTED_EXECUTE_OPTIONS.yutori,
      }),
    ).not.toThrow();
  });

  it("gates supported CUA execute options behind experimental, matching non-CUA", () => {
    expect(() =>
      validateExperimentalFeatures({
        isExperimental: false,
        agentConfig: cuaConfig,
        executeOptions: {
          instruction: "task",
          output: z.object({ price: z.string() }),
        },
        cuaSupportedExecuteOptions: CUA_SUPPORTED_EXECUTE_OPTIONS.yutori,
      }),
    ).toThrow(ExperimentalNotConfiguredError);
  });

  it("leaves other CUA rejections (signal, messages, variables) intact", () => {
    expect(() =>
      validateExperimentalFeatures({
        isExperimental: true,
        agentConfig: cuaConfig,
        executeOptions: {
          instruction: "task",
          signal: new AbortController().signal,
        },
        cuaSupportedExecuteOptions: CUA_SUPPORTED_EXECUTE_OPTIONS.yutori,
      }),
    ).toThrow(StagehandInvalidArgumentError);
  });
});
