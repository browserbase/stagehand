import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  checkProtocolCompatibility,
  STAGEHAND_SEMVER_PATTERN,
  StagehandProtocolVersionSchema,
} from "../../protocol-version.ts";

const numericPartArb: fc.Arbitrary<bigint> = fc.oneof(
  fc.bigInt({ min: 0n, max: 50n }),
  fc.bigInt({ min: 0n, max: 10n ** 30n }),
);

const preIdArb: fc.Arbitrary<string> = fc.oneof(
  fc.bigInt({ min: 0n, max: 999n }).map((n) => n.toString()),
  fc.constantFrom("alpha", "beta", "rc", "0a", "x-1", "dev-2026"),
);

const prereleaseArb: fc.Arbitrary<string> = fc
  .array(preIdArb, { minLength: 1, maxLength: 3 })
  .map((parts) => parts.join("."));

const buildIdArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom("001", "build", "sha-abc123", "20261125", "0"),
  fc.stringMatching(/^[0-9A-Za-z-]{1,8}$/),
);

const buildMetadataArb: fc.Arbitrary<string> = fc
  .array(buildIdArb, { minLength: 1, maxLength: 3 })
  .map((parts) => parts.join("."));

type SemVerParts = {
  major: bigint;
  minor: bigint;
  patch: bigint;
  prerelease?: string;
  build?: string;
};

const semVerPartsArb: fc.Arbitrary<SemVerParts> = fc.record({
  major: numericPartArb,
  minor: numericPartArb,
  patch: numericPartArb,
  prerelease: fc.option(prereleaseArb, { nil: undefined }),
  build: fc.option(buildMetadataArb, { nil: undefined }),
});

const stableSemVerPartsArb: fc.Arbitrary<SemVerParts> = fc.record({
  major: numericPartArb,
  minor: numericPartArb,
  patch: numericPartArb,
  prerelease: fc.constant(undefined),
  build: fc.option(buildMetadataArb, { nil: undefined }),
});

const invalidSemVerArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    "",
    "1",
    "1.0",
    "01.0.0",
    "1.00.0",
    "1.0.00",
    "1.0.0-01",
    "1.0.0-",
    "1.0.0+",
    "1.0.0-alpha..1",
    "1.0.0+build..1",
    "v1.0.0",
    " 1.0.0",
    "1.0.0 ",
    "1.0.0\n",
    "-1.0.0",
    "1.2.3.4",
    "not-semver",
  ),
  fc.string({ maxLength: 24 }).filter((candidate) => !STAGEHAND_SEMVER_PATTERN.test(candidate)),
);

function formatSemVer(parts: SemVerParts): string {
  const core = `${parts.major}.${parts.minor}.${parts.patch}`;
  const pre = parts.prerelease === undefined ? "" : `-${parts.prerelease}`;
  const build = parts.build === undefined ? "" : `+${parts.build}`;
  return `${core}${pre}${build}`;
}

describe("protocol-version adversarial property tests", () => {
  it("is total and crash-free for arbitrary strings and runtime non-strings", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), fc.string({ maxLength: 40 }), (client, server) => {
        const result = checkProtocolCompatibility(client, server);
        const validClient = StagehandProtocolVersionSchema.safeParse(client).success;
        const validServer = StagehandProtocolVersionSchema.safeParse(server).success;
        if (!validClient || !validServer) {
          expect(result).toStrictEqual({
            compatible: false,
            reason: "protocol-invalid-version",
          });
        } else {
          expect(typeof result.compatible).toBe("boolean");
        }
      }),
      { numRuns: 300 },
    );

    for (const malformed of [null, undefined, 123, {}, [], Symbol("v")] as unknown as string[]) {
      expect(checkProtocolCompatibility(malformed, "1.0.0")).toStrictEqual({
        compatible: false,
        reason: "protocol-invalid-version",
      });
      expect(checkProtocolCompatibility("1.0.0", malformed)).toStrictEqual({
        compatible: false,
        reason: "protocol-invalid-version",
      });
    }
  });

  it("rejects every invalid SemVer input on either side", () => {
    fc.assert(
      fc.property(semVerPartsArb, invalidSemVerArb, (validParts, invalid) => {
        const valid = formatSemVer(validParts);
        expect(StagehandProtocolVersionSchema.safeParse(valid).success).toBe(true);
        expect(StagehandProtocolVersionSchema.safeParse(invalid).success).toBe(false);
        expect(checkProtocolCompatibility(valid, invalid)).toStrictEqual({
          compatible: false,
          reason: "protocol-invalid-version",
        });
        expect(checkProtocolCompatibility(invalid, valid)).toStrictEqual({
          compatible: false,
          reason: "protocol-invalid-version",
        });
      }),
      { numRuns: 200 },
    );
  });

  it("is reflexive on all valid SemVer strings", () => {
    fc.assert(
      fc.property(semVerPartsArb, (parts) => {
        const version = formatSemVer(parts);
        expect(checkProtocolCompatibility(version, version)).toStrictEqual({ compatible: true });
      }),
      { numRuns: 300 },
    );
  });

  it("is invariant to SemVer 2.0.0 build metadata for both stable and prerelease versions", () => {
    fc.assert(
      fc.property(
        semVerPartsArb,
        semVerPartsArb,
        fc.option(buildMetadataArb, { nil: undefined }),
        fc.option(buildMetadataArb, { nil: undefined }),
        (client, server, buildA, buildB) => {
          const base = checkProtocolCompatibility(formatSemVer(client), formatSemVer(server));
          const modified = checkProtocolCompatibility(
            formatSemVer({ ...client, build: buildA }),
            formatSemVer({ ...server, build: buildB }),
          );
          expect(modified).toStrictEqual(base);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("enforces major incompatibility soundness and minor monotonicity on stable releases", () => {
    fc.assert(
      fc.property(
        stableSemVerPartsArb,
        stableSemVerPartsArb,
        numericPartArb,
        numericPartArb,
        (client, server, patchDelta, minorDelta) => {
          const clientStr = formatSemVer(client);
          const serverStr = formatSemVer(server);
          const verdict = checkProtocolCompatibility(clientStr, serverStr);

          if (client.major !== server.major) {
            expect(verdict).toStrictEqual({
              compatible: false,
              reason: "protocol-major-mismatch",
            });
          } else if (server.minor < client.minor) {
            expect(verdict).toStrictEqual({
              compatible: false,
              reason: "protocol-server-too-old",
            });
          } else {
            expect(verdict).toStrictEqual({ compatible: true });

            const upgradedServer = formatSemVer({
              ...server,
              minor: server.minor + minorDelta,
              patch: patchDelta,
            });
            expect(checkProtocolCompatibility(clientStr, upgradedServer)).toStrictEqual({
              compatible: true,
            });
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("is transitive across all valid SemVer triples and symmetric whenever prereleases are involved", () => {
    fc.assert(
      fc.property(semVerPartsArb, semVerPartsArb, semVerPartsArb, (a, b, c) => {
        const va = formatSemVer(a);
        const vb = formatSemVer(b);
        const vc = formatSemVer(c);
        const ab = checkProtocolCompatibility(va, vb);
        const bc = checkProtocolCompatibility(vb, vc);
        if (ab.compatible && bc.compatible) {
          expect(checkProtocolCompatibility(va, vc)).toStrictEqual({ compatible: true });
        }
        if (a.prerelease !== undefined || b.prerelease !== undefined) {
          expect(ab).toStrictEqual(checkProtocolCompatibility(vb, va));
        }
      }),
      { numRuns: 300 },
    );
  });
});
