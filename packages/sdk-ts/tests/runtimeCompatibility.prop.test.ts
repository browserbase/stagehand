import { checkProtocolCompatibility } from "@browserbasehq/stagehand-protocol/protocol-version";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  negotiateRuntimeCompatibility,
  STAGEHAND_RUNTIME_NAME,
} from "../src/runtimeCompatibility.ts";

const numericPartArb: fc.Arbitrary<bigint> = fc.oneof(
  fc.bigInt({ min: 0n, max: 30n }),
  fc.bigInt({ min: 0n, max: 10n ** 25n }),
);

const preArb: fc.Arbitrary<string | undefined> = fc.option(
  fc.constantFrom("alpha.1", "beta.1", "beta.2", "rc.0", "0a"),
  { nil: undefined },
);

const buildArb: fc.Arbitrary<string | undefined> = fc.option(
  fc.constantFrom("build.1", "build.2", "sha.deadbeef"),
  { nil: undefined },
);

const validSemVerArb: fc.Arbitrary<string> = fc
  .record({
    major: numericPartArb,
    minor: numericPartArb,
    patch: numericPartArb,
    pre: preArb,
    build: buildArb,
  })
  .map(
    ({ major, minor, patch, pre, build }) =>
      `${major}.${minor}.${patch}${pre ? `-${pre}` : ""}${build ? `+${build}` : ""}`,
  );

const nonEmptyStringArb = fc.string({ minLength: 1, maxLength: 24 });

describe("negotiateRuntimeCompatibility adversarial property tests", () => {
  it("never throws on arbitrary unknown markers or requirements and stays deterministic", () => {
    fc.assert(
      fc.property(
        fc.oneof(validSemVerArb, fc.string({ maxLength: 24 })),
        fc.anything(),
        (protocolVersion, raw) => {
          const required = { protocolVersion };
          const first = negotiateRuntimeCompatibility(required, raw);
          const second = negotiateRuntimeCompatibility(required, raw);
          expect(first).toStrictEqual(second);

          if (raw === null || raw === undefined) {
            expect(first).toMatchObject({ kind: "unknown", reason: "missing-marker" });
          } else {
            expect(["compatible", "incompatible", "unknown"]).toContain(first.kind);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("matches checkProtocolCompatibility exactly for readable stagehand markers", () => {
    fc.assert(
      fc.property(
        fc.oneof(validSemVerArb, fc.string({ maxLength: 24 })),
        fc.oneof(validSemVerArb, nonEmptyStringArb),
        nonEmptyStringArb,
        (requiredVersion, reportedVersion, serverVersion) => {
          const required = { protocolVersion: requiredVersion };
          const raw = {
            protocolVersion: reportedVersion,
            serverInfo: { name: STAGEHAND_RUNTIME_NAME, version: serverVersion },
          };
          const negotiated = negotiateRuntimeCompatibility(required, raw);
          const expected = checkProtocolCompatibility(requiredVersion, reportedVersion);

          if (expected.compatible) {
            expect(negotiated).toStrictEqual({
              kind: "compatible",
              protocolVersion: reportedVersion,
              serverInfo: { name: STAGEHAND_RUNTIME_NAME, version: serverVersion },
            });
          } else {
            expect(negotiated).toMatchObject({
              kind: "incompatible",
              reason: expected.reason,
              required,
              reported: raw,
            });
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("reports runtime-name-mismatch before protocol checks for any non-stagehand runtime", () => {
    fc.assert(
      fc.property(
        fc.oneof(validSemVerArb, fc.string({ maxLength: 16 })),
        nonEmptyStringArb,
        nonEmptyStringArb.filter((name) => name !== STAGEHAND_RUNTIME_NAME),
        nonEmptyStringArb,
        (requiredVersion, reportedVersion, foreignName, serverVersion) => {
          const result = negotiateRuntimeCompatibility(
            { protocolVersion: requiredVersion },
            {
              protocolVersion: reportedVersion,
              serverInfo: { name: foreignName, version: serverVersion },
            },
          );
          expect(result).toMatchObject({
            kind: "incompatible",
            reason: "runtime-name-mismatch",
          });
        },
      ),
      { numRuns: 200 },
    );
  });

  it("handles null-prototype markers and extra unknown fields safely", () => {
    fc.assert(
      fc.property(
        validSemVerArb,
        nonEmptyStringArb.filter((key) => key !== "protocolVersion" && key !== "serverInfo"),
        (version, extraKey) => {
          const nullProtoServerInfo = Object.assign(Object.create(null), {
            name: STAGEHAND_RUNTIME_NAME,
            version: "1.0.0",
          });
          const nullProtoMarker = Object.assign(Object.create(null), {
            protocolVersion: version,
            serverInfo: nullProtoServerInfo,
          });
          expect(
            negotiateRuntimeCompatibility({ protocolVersion: version }, nullProtoMarker),
          ).toMatchObject({
            kind: "compatible",
            protocolVersion: version,
          });

          const withExtraKey = Object.fromEntries([
            ["protocolVersion", version],
            ["serverInfo", { name: STAGEHAND_RUNTIME_NAME, version: "1.0.0" }],
            [extraKey, true],
          ]);
          const result = negotiateRuntimeCompatibility({ protocolVersion: version }, withExtraKey);
          if (extraKey !== "__proto__") {
            expect(result).toMatchObject({
              kind: "unknown",
              reason: "unreadable-marker",
            });
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
