import { describe, expect, it } from "vitest";
import {
  checkProtocolCompatibility,
  StagehandProtocolVersionSchema,
} from "../../protocol-version.ts";

describe("protocol SemVer compatibility", () => {
  it.each([
    ["1.2.4", "1.2.0"],
    ["1.2.4", "1.9.0"],
    ["1.3.0-beta.1", "1.3.0-beta.1"],
  ])("accepts client %s with server %s", (client, server) => {
    expect(checkProtocolCompatibility(client, server)).toStrictEqual({ compatible: true });
  });

  it.each([
    ["1.2.4", "1.1.99", "protocol-server-too-old"],
    ["1.2.4", "2.0.0", "protocol-major-mismatch"],
    ["1.3.0-beta.1", "1.3.0-beta.2", "protocol-prerelease-mismatch"],
    ["1.3.0-beta.1", "1.3.0", "protocol-prerelease-mismatch"],
    ["not-semver", "1.0.0", "protocol-invalid-version"],
    ["1.0.0", "not-semver", "protocol-invalid-version"],
  ] as const)("rejects client %s with server %s", (client, server, reason) => {
    expect(checkProtocolCompatibility(client, server)).toStrictEqual({
      compatible: false,
      reason,
    });
  });

  it.each(["1.0.0", "0.1.0", "1.0.0-beta.1", "1.0.0+build.7"])(
    "accepts valid SemVer %s",
    (version) => expect(StagehandProtocolVersionSchema.parse(version)).toBe(version),
  );

  it.each(["1", "1.0", "01.0.0", "1.0.0-01", "v1.0.0"])("rejects invalid SemVer %s", (version) =>
    expect(() => StagehandProtocolVersionSchema.parse(version)).toThrow(),
  );
});
