import { describe, expect, it } from "vite-plus/test";
import {
  negotiateRuntimeCompatibility,
  type RuntimeRequirement,
} from "../src/runtimeCompatibility.ts";

const requirement: RuntimeRequirement = {
  minimumProtocolVersion: 4,
  maximumProtocolVersion: 6,
};
const marker = (protocolVersion: number) => ({
  name: "stagehand",
  version: "stagehand.v4",
  protocolVersion,
  serverInfo: { name: "stagehand", version: "4.0.0" },
});

describe("negotiateRuntimeCompatibility", () => {
  it("accepts the inclusive minimum", () =>
    expect(negotiateRuntimeCompatibility(requirement, marker(4))).toStrictEqual({
      kind: "compatible",
      protocolVersion: 4,
      serverInfo: { name: "stagehand", version: "4.0.0" },
    }));
  it("accepts the inclusive maximum", () =>
    expect(negotiateRuntimeCompatibility(requirement, marker(6))).toMatchObject({
      kind: "compatible",
      protocolVersion: 6,
    }));
  it("reports a protocol below minimum", () =>
    expect(negotiateRuntimeCompatibility(requirement, marker(3))).toMatchObject({
      kind: "incompatible",
      reason: "protocol-below-minimum",
      required: { minimumProtocolVersion: 4, maximumProtocolVersion: 6 },
      reported: {
        protocolVersion: 3,
        serverInfo: { name: "stagehand", version: "4.0.0" },
      },
    }));
  it("reports a protocol above maximum", () =>
    expect(negotiateRuntimeCompatibility(requirement, marker(7))).toMatchObject({
      kind: "incompatible",
      reason: "protocol-above-maximum",
      required: { minimumProtocolVersion: 4, maximumProtocolVersion: 6 },
      reported: {
        protocolVersion: 7,
        serverInfo: { name: "stagehand", version: "4.0.0" },
      },
    }));
  it.each([[null], [undefined]])("reports a missing marker for %s", (raw) =>
    expect(negotiateRuntimeCompatibility(requirement, raw)).toMatchObject({
      kind: "unknown",
      reason: "missing-marker",
      detail: "Runtime marker is absent",
    }),
  );
  it.each([[0], ["x"], [[]], [{ protocolVersion: "4" }], [{ protocolVersion: 4 }]])(
    "reports an unreadable malformed marker for %j",
    (raw) =>
      expect(negotiateRuntimeCompatibility(requirement, raw)).toMatchObject({
        kind: "unknown",
        reason: "unreadable-marker",
      }),
  );
  it("reports a foreign marker as unreadable", () =>
    expect(
      negotiateRuntimeCompatibility(requirement, {
        ...marker(4),
        serverInfo: { name: "other", version: "4.0.0" },
      }),
    ).toMatchObject({
      kind: "unknown",
      reason: "unreadable-marker",
    }));
  it("accepts unknown marker keys", () =>
    expect(
      negotiateRuntimeCompatibility(requirement, { ...marker(4), status: "ready" }),
    ).toMatchObject({
      kind: "compatible",
      protocolVersion: 4,
    }));
  it("does not throw for an unreadable proxy", () => {
    const raw = new Proxy({}, { get: () => throwOnRead() });
    expect(negotiateRuntimeCompatibility(requirement, raw)).toMatchObject({
      kind: "unknown",
      reason: "unreadable-marker",
    });
  });
  it("is deterministic and does not mutate inputs", () => {
    const required = { ...requirement };
    const reported = { ...marker(4), status: "ready" };
    const before = structuredClone({ required, reported });
    expect(negotiateRuntimeCompatibility(required, reported)).toEqual(
      negotiateRuntimeCompatibility(required, reported),
    );
    expect({ required, reported }).toEqual(before);
  });
});

function throwOnRead(): never {
  throw new Error("unreadable");
}
