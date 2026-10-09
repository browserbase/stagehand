import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { encodeWireValue, wireSchema } from "../../json-rpc/wire-casing.js";
import {
  getStagehandMethod,
  StagehandMethods,
  StagehandRpcRequestSchema,
} from "../../schema-registry.js";
import {
  HTTPModelReferenceSchema,
  HTTPRegisterModelParamsSchema,
  HTTP_TRANSPORT_LIMITS,
} from "../../schemas.js";

const fixtures = JSON.parse(
  readFileSync(new URL("../fixtures/http-model-registration-wire.json", import.meta.url), "utf8"),
) as Array<{
  name: string;
  params: {
    scope_id: string;
    model: { model_name: string; api_key?: string; headers?: Record<string, string> };
  };
  result: unknown;
}>;

describe("callback model registration protocol", () => {
  const method = StagehandMethods.httpRegisterModel;

  it("registers the reverse method with canonical schemas", () => {
    expect(getStagehandMethod("http.register_model")).toBe(method);
    expect(method.params).toBe(HTTPRegisterModelParamsSchema);
    expect(method.result).toBe(HTTPModelReferenceSchema);
  });

  it.each(fixtures)("round-trips $name without changing header names", ({ params, result }) => {
    const packet = StagehandRpcRequestSchema.parse({
      jsonrpc: "2.0",
      id: 1,
      method: method.name,
      params,
    });
    expect(packet.params).toStrictEqual({
      scopeId: params.scope_id,
      model: {
        modelName: params.model.model_name,
        ...(params.model.api_key === undefined ? {} : { apiKey: params.model.api_key }),
        ...(params.model.headers === undefined ? {} : { headers: params.model.headers }),
      },
    });
    expect(encodeWireValue(packet.params, method.paramsWire)).toStrictEqual(params);
    const parsedResult = wireSchema(method.result).parse(result);
    expect(encodeWireValue(parsedResult)).toStrictEqual(result);
  });

  it.each([
    {},
    { scopeId: "batch-1" },
    { scopeId: "", model: { modelName: "openai/gpt-5" } },
    {
      scopeId: "x".repeat(HTTP_TRANSPORT_LIMITS.idLength + 1),
      model: { modelName: "openai/gpt-5" },
    },
    { scopeId: "batch-1", model: {} },
    { scopeId: "batch-1", model: { modelName: "unknown/model" } },
    { scopeId: "batch-1", model: { modelName: "openai/gpt-5", headers: { "X-Test": 1 } } },
    { scopeId: "batch-1", model: { modelName: "openai/gpt-5", apiKey: "" } },
    { scopeId: "batch-1", model: { modelName: "openai/gpt-5", extra: true } },
    { scopeId: "batch-1", model: { source: "client" } },
    { scopeId: "batch-1", model: { source: "http", route: "gateway", configurationId: "g" } },
  ])("rejects incomplete or mixed registration params %#", (params) => {
    expect(method.params.safeParse(params).success).toBe(false);
  });

  it("exports the complete ModelConfig definition", () => {
    const document = z.toJSONSchema(method.params, { io: "input" });
    expect(document.$defs).toHaveProperty("ModelConfig");
    expect(document.properties?.scopeId).toMatchObject({
      type: "string",
      minLength: 1,
      maxLength: HTTP_TRANSPORT_LIMITS.idLength,
    });
  });
});
