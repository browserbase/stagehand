import { describe, expectTypeOf, it } from "vitest";
import * as Stagehand from "../../dist";
import { PUBLIC_ERROR_TYPE_KEYS } from "../../../../tests/shared/publicErrorTypeKeys";

describe("Stagehand public error types", () => {
  describe("errors", () => {
    it.each(PUBLIC_ERROR_TYPE_KEYS)("%s extends Error", (errorTypeName) => {
      const ErrorClass = Stagehand[errorTypeName];
      type ErrorClassType = typeof ErrorClass;
      expectTypeOf<InstanceType<ErrorClassType>>().toExtend<Error>();
      void ErrorClass; // Mark as used to satisfy ESLint
    });
  });
});
