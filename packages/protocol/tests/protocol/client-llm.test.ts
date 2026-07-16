import { describe, expect, it } from "vite-plus/test";
import { encodeWireValue, wireSchema } from "../../json-rpc/wire-casing.js";
import { StagehandMethods } from "../../schema-registry.js";
import {
  LLMGenerateParamsSchema,
  LLMGenerateResultSchema,
  StagehandInitParamsSchema,
} from "../../schemas.js";

describe("client-side LLM protocol", () => {
  it("defines llm.generate as a Zod-validated request handled by the SDK", () => {
    const params = {
      messages: [{ role: "user" as const, content: { type: "text" as const, text: "Hello" } }],
      responseFormat: {
        type: "json_schema" as const,
        name: "answer",
        schema: {
          type: "object",
          properties: { finalAnswer: { type: "string" } },
          required: ["finalAnswer"],
        },
      },
    };
    const wireParams = encodeWireValue(params, StagehandMethods.llmGenerate.paramsWire);

    expect(wireParams).toMatchObject({
      response_format: {
        schema: { properties: { finalAnswer: { type: "string" } } },
      },
    });
    expect(
      wireSchema(
        StagehandMethods.llmGenerate.params,
        StagehandMethods.llmGenerate.paramsWire,
      ).parse(wireParams),
    ).toStrictEqual(LLMGenerateParamsSchema.parse(params));
  });

  it("selects a serializable client model during Stagehand initialization", () => {
    expect(
      StagehandInitParamsSchema.parse({
        cdpUrl: "ws://browser.example",
        model: {
          source: "client",
          modelName: "anthropic/claude-sonnet-4-6",
        },
      }),
    ).toMatchObject({
      model: {
        source: "client",
        modelName: "anthropic/claude-sonnet-4-6",
      },
    });
  });

  it("requires structured content when a client LLM returns JSON schema output", () => {
    const baseResult = {
      role: "assistant" as const,
      content: { type: "text" as const, text: '{"finalAnswer":"four"}' },
      model: "openai/gpt-5" as const,
      outputFormat: "json_schema" as const,
    };

    expect(() => LLMGenerateResultSchema.parse(baseResult)).toThrow();
    expect(
      LLMGenerateResultSchema.parse({
        ...baseResult,
        structuredContent: { finalAnswer: "four" },
      }),
    ).toMatchObject({ structuredContent: { finalAnswer: "four" } });
  });
});
