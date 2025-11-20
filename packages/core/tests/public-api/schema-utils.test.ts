import { describe, expectTypeOf, it } from "vitest";
import * as Stagehand from "../../dist/index.js";

describe("Schema Utils public API types", () => {
  describe("defaultExtractSchema", () => {
    type ExpectedInferredType = { extraction: string };

    it("infers to the correct type", () => {
      expectTypeOf<
        Stagehand.InferStagehandSchema<typeof Stagehand.defaultExtractSchema>
      >().toEqualTypeOf<ExpectedInferredType>();
    });
  });

  describe("getZodType", () => {
    type ExpectedGetZodTypeParams = [Stagehand.StagehandZodSchema];

    it("has correct parameter types", () => {
      expectTypeOf(
        Stagehand.getZodType,
      ).parameters.branded.toEqualTypeOf<ExpectedGetZodTypeParams>();
    });
  });

  describe("isZod3Schema", () => {
    type ExpectedIsZod3SchemaParams = [Stagehand.StagehandZodSchema];

    it("has correct parameter types", () => {
      expectTypeOf(
        Stagehand.isZod3Schema,
      ).parameters.branded.toEqualTypeOf<ExpectedIsZod3SchemaParams>();
    });
  });

  describe("isZod4Schema", () => {
    type ExpectedIsZod4SchemaParams = [Stagehand.StagehandZodSchema];

    it("has correct parameter types", () => {
      expectTypeOf(
        Stagehand.isZod4Schema,
      ).parameters.branded.toEqualTypeOf<ExpectedIsZod4SchemaParams>();
    });
  });

  describe("jsonSchemaToZod", () => {
    type ExpectedJsonSchemaToZodParams = [Stagehand.JsonSchema];

    it("has correct parameter types", () => {
      expectTypeOf(
        Stagehand.jsonSchemaToZod,
      ).parameters.branded.toEqualTypeOf<ExpectedJsonSchemaToZodParams>();
    });
  });

  describe("pageTextSchema", () => {
    type ExpectedInferredType = { pageText: string };

    it("infers to the correct type", () => {
      expectTypeOf<
        Stagehand.InferStagehandSchema<typeof Stagehand.pageTextSchema>
      >().toEqualTypeOf<ExpectedInferredType>();
    });
  });

  describe("toGeminiSchema", () => {
    type ExpectedToGeminiSchemaParams = [Stagehand.StagehandZodSchema];

    it("has correct parameter types", () => {
      expectTypeOf(
        Stagehand.toGeminiSchema,
      ).parameters.branded.toEqualTypeOf<ExpectedToGeminiSchemaParams>();
    });
  });

  describe("toJsonSchema", () => {
    type ExpectedToJsonSchemaParams = [Stagehand.StagehandZodSchema];

    it("has correct parameter types", () => {
      expectTypeOf(
        Stagehand.toJsonSchema,
      ).parameters.branded.toEqualTypeOf<ExpectedToJsonSchemaParams>();
    });
  });

  describe("transformSchema", () => {
    type ExpectedTransformSchemaParams = [
      Stagehand.StagehandZodSchema,
      Array<string | number>,
    ];

    it("has correct parameter types", () => {
      expectTypeOf(
        Stagehand.transformSchema,
      ).parameters.branded.toEqualTypeOf<ExpectedTransformSchemaParams>();
    });
  });

  describe("trimTrailingTextNode", () => {
    type ExpectedTrimTrailingTextNodeParams = [string | undefined];

    it("has correct parameter types", () => {
      expectTypeOf(
        Stagehand.trimTrailingTextNode,
      ).parameters.branded.toEqualTypeOf<ExpectedTrimTrailingTextNodeParams>();
    });
  });

  describe("validateZodSchema", () => {
    type ExpectedValidateZodSchemaParams = [
      Stagehand.StagehandZodSchema,
      unknown,
    ];

    it("has correct parameter types", () => {
      expectTypeOf(
        Stagehand.validateZodSchema,
      ).parameters.branded.toEqualTypeOf<ExpectedValidateZodSchemaParams>();
    });
  });
});
