import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { encodeWireValue, wireSchema } from "../../json-rpc/wire-casing.js";
import { StagehandMethods, StagehandRpcRequestSchema } from "../../schema-registry.js";
import {
  ActOptionsSchema,
  BatchModelOverridesSchema,
  CallbackBatchParamsSchema,
  ExtractOptionsSchema,
  HTTPConnectionReferenceSchema,
  HTTPModelReferenceSchema,
  HTTPServiceConnectionsSchema,
  HTTP_TRANSPORT_LIMITS,
  ModelConfigSchema,
  ObserveOptionsSchema,
  StagehandActParamsSchema,
  StagehandExtractParamsSchema,
  StagehandInitParamsSchema,
  StagehandInitWireParamsSchema,
  StagehandObserveParamsSchema,
  STAGEHAND_PROTOCOL_VERSION,
} from "../../schemas.js";

const model = {
  modelName: "openai/gpt-5",
  apiKey: "test-model-key",
  headers: { "X-Test": "value" },
};
const reference = {
  source: "http",
  route: "provider",
  modelName: "openai/gpt-5",
  configurationId: "model-1",
} as const;
const init = {
  protocolVersion: STAGEHAND_PROTOCOL_VERSION,
  clientInfo: { name: "test-sdk", version: "1.0.0" },
};
const operations = [
  {
    method: StagehandMethods.stagehandAct,
    legacy: StagehandActParamsSchema,
    params: { pageId: "page-1", instruction: "click Continue" },
    options: ActOptionsSchema,
  },
  {
    method: StagehandMethods.stagehandObserve,
    legacy: StagehandObserveParamsSchema,
    params: { pageId: "page-1" },
    options: ObserveOptionsSchema,
  },
  {
    method: StagehandMethods.stagehandExtract,
    legacy: StagehandExtractParamsSchema,
    params: { pageId: "page-1", instruction: "read the title" },
    options: ExtractOptionsSchema,
  },
] as const;

describe("client HTTP connection references", () => {
  it("represents provider, explicit Gateway, and automatic Gateway models", () => {
    expect(HTTPModelReferenceSchema.parse(reference)).toStrictEqual(reference);
    const gateway = { source: "http", route: "gateway", configurationId: "gateway-1" };
    expect(HTTPModelReferenceSchema.parse(gateway)).toStrictEqual(gateway);
    expect(
      HTTPModelReferenceSchema.parse({ ...gateway, modelName: model.modelName }),
    ).toMatchObject({ modelName: model.modelName });
    const { modelName: _, ...withoutModel } = reference;
    expect(HTTPModelReferenceSchema.safeParse(withoutModel).success).toBe(false);
  });

  it.each([
    { ...reference, apiKey: "test-key" },
    { ...reference, headers: {} },
    { ...reference, source: "client" },
    { ...reference, route: "other" },
    { ...reference, configurationId: "" },
    { ...reference, configurationId: "x".repeat(HTTP_TRANSPORT_LIMITS.idLength + 1) },
    { ...reference, modelName: "unknown/model" },
    { ...model, configurationId: "model-1" },
  ])("rejects mixed or incomplete model reference %#", (input) => {
    expect(HTTPModelReferenceSchema.safeParse(input).success).toBe(false);
  });

  it("keeps service references separate from model selection", () => {
    const connection = { configurationId: "browserbase-1" };
    expect(HTTPConnectionReferenceSchema.parse(connection)).toStrictEqual(connection);
    expect(
      HTTPServiceConnectionsSchema.parse({ gateway: connection, cache: connection }),
    ).toStrictEqual({ gateway: connection, cache: connection });
    expect(HTTPServiceConnectionsSchema.safeParse({ gateway: reference }).success).toBe(false);
    expect(HTTPServiceConnectionsSchema.safeParse({ other: connection }).success).toBe(false);
    expect(
      HTTPConnectionReferenceSchema.safeParse({ ...connection, apiKey: "test-key" }).success,
    ).toBe(false);
  });

  it("preserves existing initialization inputs and defaults", () => {
    for (const input of [
      init,
      { ...init, model },
      { ...init, model: { source: "client" } },
      { ...init, apiKey: "test-browserbase-key", browser: { sessionId: "session-1" } },
    ]) {
      expect(StagehandMethods.stagehandInit.params.parse(input)).toStrictEqual(
        StagehandInitParamsSchema.parse(input),
      );
    }
  });

  it("accepts initialization with client connections", () => {
    const connections = {
      gateway: { configurationId: "gateway-1" },
      cache: { configurationId: "cache-1" },
    };
    for (const model of [undefined, reference, { source: "client" }]) {
      const params = { ...init, connections, ...(model ? { model } : {}) };
      const packet = StagehandRpcRequestSchema.parse({
        jsonrpc: "2.0",
        id: 1,
        method: "stagehand.init",
        params: encodeWireValue(params),
      });
      expect(packet.params).toMatchObject(params);
    }
    expect(
      StagehandInitWireParamsSchema.parse({ ...init, connections: {}, model: reference }),
    ).toMatchObject({ connections: {}, model: reference });
  });

  it.each([
    { ...init, connections: {}, apiKey: "test-key" },
    { ...init, connections: {}, apiUrl: "https://example.com" },
    { ...init, connections: {}, model },
    { ...init, connections: { gateway: { configurationId: "g", headers: {} } } },
    { ...init, model: reference },
  ])("rejects mixed initialization variant %#", (params) => {
    expect(StagehandInitWireParamsSchema.safeParse(params).success).toBe(false);
  });

  it.each(operations)("preserves existing $method.name inputs", ({ method, legacy, params }) => {
    for (const input of [params, { ...params, options: { model } }]) {
      expect(method.params.parse(input)).toStrictEqual(legacy.parse(input));
    }
  });

  it.each(operations)(
    "carries call scope and model references in $method.name",
    ({ method, params }) => {
      for (const model of [
        undefined,
        reference,
        { source: "http", route: "gateway", configurationId: "g" },
      ]) {
        const input = { ...params, scopeId: "call-1", ...(model ? { options: { model } } : {}) };
        const encoded = encodeWireValue(
          input,
          "paramsWire" in method ? method.paramsWire : undefined,
        );
        const parsed = StagehandRpcRequestSchema.parse({
          jsonrpc: "2.0",
          id: 2,
          method: method.name,
          params: encoded,
        });
        expect(parsed.params).toMatchObject(input);
        expect(encoded).toMatchObject({ scope_id: "call-1" });
        if (model) {
          expect(encoded).toMatchObject({
            options: { model: { configuration_id: model.configurationId } },
          });
        }
      }
    },
  );

  it.each(operations)(
    "requires complete reference variants for $method.name",
    ({ method, params }) => {
      for (const input of [
        { ...params, options: { model: reference } },
        { ...params, scopeId: "", options: { model: reference } },
        { ...params, scopeId: "call-1", options: { model } },
      ]) {
        expect(method.params.safeParse(input).success).toBe(false);
      }
    },
  );

  it("keeps public model and operation option schemas unchanged", () => {
    expect(ModelConfigSchema.parse(model)).toStrictEqual(model);
    expect(ModelConfigSchema.safeParse(reference).success).toBe(false);
    for (const { options } of operations) {
      expect(options.parse({ model })).toStrictEqual({ model });
      expect(options.safeParse({ model: reference }).success).toBe(false);
    }
    expect(StagehandInitParamsSchema.safeParse({ ...init, connections: {} }).success).toBe(false);
  });

  it("preserves batch method defaults and nested input across wire casing", () => {
    const params = {
      callbackSource: 'async (batch) => batch.act("click Continue")',
      scopeId: "batch-1",
      input: { modelName: "caller data" },
      options: {
        modelOverrides: {
          act: reference,
          observe: { source: "http", route: "gateway", configurationId: "g" },
          extract: reference,
        },
      },
    };
    const method = StagehandMethods.stagehandCallbackBatch;
    const wire = encodeWireValue(params, method.paramsWire);
    expect(wire).toMatchObject({
      scope_id: "batch-1",
      input: params.input,
      options: {
        model_overrides: {
          act: { configuration_id: "model-1", model_name: "openai/gpt-5" },
          observe: { configuration_id: "g" },
          extract: { configuration_id: "model-1", model_name: "openai/gpt-5" },
        },
      },
    });
    expect(wireSchema(method.params, method.paramsWire).parse(wire)).toMatchObject(params);
  });

  it("retains existing batch inputs and rejects mixed batch forms", () => {
    const params = { callbackSource: "async () => 1", options: {} };
    const schema = StagehandMethods.stagehandCallbackBatch.params;
    expect(schema.parse(params)).toStrictEqual(CallbackBatchParamsSchema.parse(params));
    expect(schema.parse({ ...params, scopeId: "batch-1" })).toHaveProperty("scopeId", "batch-1");
    for (const input of [
      { ...params, options: { modelOverrides: { act: reference } } },
      { ...params, scopeId: "batch-1", options: { modelOverrides: { act: model } } },
      { ...params, scopeId: "batch-1", options: { modelOverrides: { fast: reference } } },
      { ...params, scopeId: "batch-1", options: { models: [{ name: "fast", model: reference }] } },
      { ...params, scopeId: "batch-1", options: { modelOverrides: [] } },
    ]) {
      expect(schema.safeParse(input).success).toBe(false);
    }
  });

  it.each([{}, { act: reference }, { observe: reference }, { extract: reference }])(
    "accepts optional batch method defaults %#",
    (overrides) => {
      expect(BatchModelOverridesSchema.parse(overrides)).toStrictEqual(overrides);
    },
  );

  it("retains named public input definitions when exporting the wire schemas", () => {
    const document = z.toJSONSchema(StagehandInitWireParamsSchema, { io: "input" });
    expect(document.$defs).toHaveProperty("StagehandInitParams");
    expect(document.$defs).toHaveProperty("ModelConfig");
    expect(document.$defs).toHaveProperty("ClientModelReference");
    for (const { method } of operations) {
      const exported = z.toJSONSchema(method.params, { io: "input" });
      expect(exported.$defs).toHaveProperty("ModelConfig");
    }
  });
});
