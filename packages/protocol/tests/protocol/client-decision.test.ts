import { describe, expect, it } from "vitest";
import fixture from "../fixtures/decision-wire.json" with { type: "json" };
import { encodeWireValue, wireSchema } from "../../json-rpc/wire-casing.js";
import { StagehandMethods } from "../../schema-registry.js";
import {
  createDecisionChooseResultSchema,
  DecisionChooseParamsSchema,
  StagehandInitParamsSchema,
  STAGEHAND_PROTOCOL_VERSION,
} from "../../schemas.js";

describe("client decision protocol", () => {
  it("round-trips candidate evidence without imposing provider choice limits", () => {
    const params = StagehandMethods.decisionChoose.params.parse(fixture.params);
    expect(encodeWireValue(params)).toEqual(fixture.params);
    const candidates = Array.from({ length: 300 }, (_, id) => ({
      id: String(id),
      description: "Button " + id,
    }));
    expect(
      DecisionChooseParamsSchema.parse({ prompt: "Save", candidates }).candidates,
    ).toHaveLength(300);
  });

  it.each(fixture.results)(
    "round-trips $status with optional usage and opaque diagnostics",
    (wireResult) => {
      const method = StagehandMethods.decisionChoose;
      const result = wireSchema(method.result, method.resultWire).parse(wireResult);
      expect(encodeWireValue(result, method.resultWire)).toEqual(wireResult);
      if (result.status === "selected") {
        expect(result.usage).toEqual({ inputTokens: 12 });
        expect(result.diagnostics).toEqual(wireResult.diagnostics);
      }
    },
  );

  it("uses unique candidate IDs and validates selections against the original request", () => {
    expect(
      DecisionChooseParamsSchema.safeParse({
        ...fixture.params,
        candidates: [fixture.params.candidates[0], fixture.params.candidates[0]],
      }).success,
    ).toBe(false);
    const params = DecisionChooseParamsSchema.parse(fixture.params);
    const resultSchema = createDecisionChooseResultSchema(params);
    params.candidates.push({ id: "injected", description: "Another node" });
    expect(resultSchema.parse({ status: "selected", id: "0-42" })).toEqual({
      status: "selected",
      id: "0-42",
    });
    expect(resultSchema.safeParse({ status: "selected", id: "injected" }).success).toBe(false);
    expect(resultSchema.parse({ status: "no_match" })).toEqual({ status: "no_match" });
    expect(resultSchema.parse({ status: "refused" })).toEqual({ status: "refused" });
  });

  it("advertises client decision capability independently from generation", () => {
    const params = StagehandInitParamsSchema.parse({
      protocolVersion: STAGEHAND_PROTOCOL_VERSION,
      clientInfo: { name: "test", version: "1.0.0" },
      decisionModel: { source: "client" },
    });
    expect(encodeWireValue(params)).toMatchObject({ decision_model: { source: "client" } });
    expect(params.model).toBeUndefined();
  });
});
