import { describe, expectTypeOf, it } from "vitest";
import * as Stagehand from "../../dist/index.js";

describe("Runtime Utils public API types", () => {
  describe("injectUrls", () => {
    type ExpectedInjectUrlsParams = [
      unknown,
      Array<string | number>,
      Record<string, string>,
    ];

    it("has correct parameter types", () => {
      expectTypeOf(
        Stagehand.injectUrls,
      ).parameters.branded.toEqualTypeOf<ExpectedInjectUrlsParams>();
    });
  });

  describe("isRunningInBun", () => {
    type ExpectedIsRunningInBunParams = [];

    it("has correct parameter types", () => {
      expectTypeOf(
        Stagehand.isRunningInBun,
      ).parameters.branded.toEqualTypeOf<ExpectedIsRunningInBunParams>();
    });
  });

  describe("loadApiKeyFromEnv", () => {
    type ExpectedLoadApiKeyFromEnvParams = [
      string | undefined,
      (logLine: Stagehand.LogLine) => void,
    ];

    it("has correct parameter types", () => {
      expectTypeOf(
        Stagehand.loadApiKeyFromEnv,
      ).parameters.branded.toEqualTypeOf<ExpectedLoadApiKeyFromEnvParams>();
    });
  });

  describe("providerEnvVarMap", () => {
    type ExpectedProviderEnvVarMap = Partial<
      Record<string, string | Array<string>>
    >;

    it("maps providers to environment variable names", () => {
      expectTypeOf<
        typeof Stagehand.providerEnvVarMap
      >().toExtend<ExpectedProviderEnvVarMap>();
    });
  });
});
