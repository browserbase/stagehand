import { describe, expect, it } from "vitest";
import {
  negotiateRuntimeCompatibility,
  type RuntimeRequirement,
} from "../src/runtimeCompatibility.ts";

const requirement: RuntimeRequirement = {
  protocolVersion: "1.2.4",
};
const marker = (protocolVersion: string) => ({
  protocolVersion,
  serverInfo: { name: "stagehand", version: "1.0.0" },
});

describe("negotiateRuntimeCompatibility", () => {
  it("accepts an older patch on the same minor", () =>
    expect(negotiateRuntimeCompatibility(requirement, marker("1.2.0"))).toStrictEqual({
      kind: "compatible",
      protocolVersion: "1.2.0",
      serverInfo: { name: "stagehand", version: "1.0.0" },
    }));
  it("accepts a newer server minor", () =>
    expect(negotiateRuntimeCompatibility(requirement, marker("1.9.0"))).toMatchObject({
      kind: "compatible",
      protocolVersion: "1.9.0",
    }));
  it("reports a server minor below the client requirement", () =>
    expect(negotiateRuntimeCompatibility(requirement, marker("1.1.99"))).toMatchObject({
      kind: "incompatible",
      reason: "protocol-server-too-old",
      required: { protocolVersion: "1.2.4" },
      reported: {
        protocolVersion: "1.1.99",
        serverInfo: { name: "stagehand", version: "1.0.0" },
      },
    }));
  it("reports a protocol major mismatch", () =>
    expect(negotiateRuntimeCompatibility(requirement, marker("2.0.0"))).toMatchObject({
      kind: "incompatible",
      reason: "protocol-major-mismatch",
      required: { protocolVersion: "1.2.4" },
      reported: {
        protocolVersion: "2.0.0",
        serverInfo: { name: "stagehand", version: "1.0.0" },
      },
    }));
  it("accepts an exact prerelease and rejects a different prerelease", () => {
    const prereleaseRequirement = { protocolVersion: "1.3.0-beta.1" };
    expect(
      negotiateRuntimeCompatibility(prereleaseRequirement, marker("1.3.0-beta.1")),
    ).toMatchObject({ kind: "compatible" });
    expect(
      negotiateRuntimeCompatibility(prereleaseRequirement, marker("1.3.0-beta.2")),
    ).toMatchObject({ kind: "incompatible", reason: "protocol-prerelease-mismatch" });
  });
  it("reports an invalid client requirement without throwing", () =>
    expect(
      negotiateRuntimeCompatibility({ protocolVersion: "not-semver" }, marker("1.2.4")),
    ).toMatchObject({
      kind: "incompatible",
      reason: "protocol-invalid-version",
    }));
  it.each([[null], [undefined]])("reports a missing marker for %s", (raw) =>
    expect(negotiateRuntimeCompatibility(requirement, raw)).toMatchObject({
      kind: "unknown",
      reason: "missing-marker",
      detail: "Runtime marker is absent",
    }),
  );
  it.each([[0], ["x"], [[]], [{ protocolVersion: "1" }], [{ protocolVersion: 1 }]])(
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
        ...marker("1.2.4"),
        serverInfo: { name: "other", version: "1.0.0" },
      }),
    ).toMatchObject({
      kind: "unknown",
      reason: "unreadable-marker",
    }));
  it("reports unknown marker keys as unreadable", () =>
    expect(
      negotiateRuntimeCompatibility(requirement, { ...marker("1.2.4"), status: "ready" }),
    ).toMatchObject({
      kind: "unknown",
      reason: "unreadable-marker",
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
    const reported = marker("1.2.4");
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
