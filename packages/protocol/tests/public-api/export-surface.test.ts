import { describe, expect, it } from "vite-plus/test";
import * as Stagehand from "../../../server/types/public/index.js";
import { publicErrorTypes } from "./public-error-types.test.js";

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
  Api: Stagehand.Api,
  ClipboardOptionsSchema: Stagehand.ClipboardOptionsSchema,
  ClipboardPasteOptionsSchema: Stagehand.ClipboardPasteOptionsSchema,
  ConsoleMessage: Stagehand.ConsoleMessage,
  LOG_LEVEL_NAMES: Stagehand.LOG_LEVEL_NAMES,
  LocatorCoordinatesSchema: Stagehand.LocatorCoordinatesSchema,
  LocatorSchema: Stagehand.LocatorSchema,
  ModelNameSchema: Stagehand.ModelNameSchema,
  PageLocatorSchema: Stagehand.PageLocatorSchema,
  Response: Stagehand.Response,
  V3FunctionName: Stagehand.V3FunctionName,
  V3FunctionNameSchema: Stagehand.V3FunctionNameSchema,
  VariablePrimitiveSchema: Stagehand.VariablePrimitiveSchema,
  VariableValueSchema: Stagehand.VariableValueSchema,
  VariablesSchema: Stagehand.VariablesSchema,
  defaultExtractSchema: Stagehand.defaultExtractSchema,
  localBrowserLaunchOptionsSchema: Stagehand.localBrowserLaunchOptionsSchema,
  pageTextSchema: Stagehand.pageTextSchema,
  ...publicErrorTypes,
} as const;

type PublicAPI = {
  [K in keyof typeof publicApiShape]: (typeof Stagehand)[K];
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
