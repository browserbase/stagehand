import { describe, expect, it } from "vitest";
import StagehandDefaultExport, * as Stagehand from "../../dist/index.js";
import { publicErrorTypes } from "./public-error-types.test";

// Type matcher guidelines:
//
// toEqualTypeOf – Default. Assert full, deep type equality; any type change should fail.
//   e.g. expectTypeOf<ReturnType<typeof foo>>().toEqualTypeOf<FooResult>()
//
// toMatchObjectType – Assert (part of) an object's shape while allowing extra fields.
//   e.g. expectTypeOf(user).toMatchObjectType<{ id: string; email: string }>()
//
// toExtend – Assert that a type is compatible with a broader contract (assignable/extends).
//   e.g. expectTypeOf<User>().toExtend<BaseUser>()

const publicApiShape = {
  AISdkClient: Stagehand.AISdkClient,
  AVAILABLE_CUA_MODELS: Stagehand.AVAILABLE_CUA_MODELS,
  AgentProvider: Stagehand.AgentProvider,
  AnnotatedScreenshotText: Stagehand.AnnotatedScreenshotText,
  ConsoleMessage: Stagehand.ConsoleMessage,
  LLMClient: Stagehand.LLMClient,
  LOG_LEVEL_NAMES: Stagehand.LOG_LEVEL_NAMES,
  Response: Stagehand.Response,
  Stagehand: Stagehand.Stagehand,
  V3: Stagehand.V3,
  V3Evaluator: Stagehand.V3Evaluator,
  V3FunctionName: Stagehand.V3FunctionName,
  connectToMCPServer: Stagehand.connectToMCPServer,
  default: StagehandDefaultExport,
  defaultExtractSchema: Stagehand.defaultExtractSchema,
  getZodType: Stagehand.getZodType,
  injectUrls: Stagehand.injectUrls,
  isRunningInBun: Stagehand.isRunningInBun,
  isZod3Schema: Stagehand.isZod3Schema,
  isZod4Schema: Stagehand.isZod4Schema,
  jsonSchemaToZod: Stagehand.jsonSchemaToZod,
  loadApiKeyFromEnv: Stagehand.loadApiKeyFromEnv,
  modelToAgentProviderMap: Stagehand.modelToAgentProviderMap,
  pageTextSchema: Stagehand.pageTextSchema,
  providerEnvVarMap: Stagehand.providerEnvVarMap,
  toGeminiSchema: Stagehand.toGeminiSchema,
  toJsonSchema: Stagehand.toJsonSchema,
  transformSchema: Stagehand.transformSchema,
  trimTrailingTextNode: Stagehand.trimTrailingTextNode,
  validateZodSchema: Stagehand.validateZodSchema,
  ...publicErrorTypes,
} as const;

type StagehandExports = typeof Stagehand & {
  default: typeof StagehandDefaultExport;
};

type PublicAPI = {
  [K in keyof typeof publicApiShape]: StagehandExports[K];
};

describe("Stagehand public API export surface", () => {
  it("public API shape matches module exports", () => {
    const _check: PublicAPI = publicApiShape;
    void _check;
  });

  it("does not expose unexpected top-level exports", () => {
    const expected = Object.keys(publicApiShape).sort();
    const actual = Object.keys(Stagehand).sort();
    expect(actual).toStrictEqual(expected);
  });
});
