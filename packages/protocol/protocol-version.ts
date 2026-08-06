import { z } from "zod/v4";
import protocolPackageJson from "./package.json" with { type: "json" };

// SemVer 2.0.0, adapted from the expression published at semver.org.
export const STAGEHAND_SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

export const StagehandProtocolVersionSchema = z
  .string()
  .regex(STAGEHAND_SEMVER_PATTERN, "Expected a SemVer 2.0.0 version");

export const STAGEHAND_PROTOCOL_VERSION = StagehandProtocolVersionSchema.parse(
  protocolPackageJson.version,
);

type ParsedProtocolVersion = {
  major: bigint;
  minor: bigint;
  prerelease?: string;
};

export type ProtocolCompatibility =
  | { compatible: true }
  | {
      compatible: false;
      reason:
        | "protocol-major-mismatch"
        | "protocol-server-too-old"
        | "protocol-prerelease-mismatch";
    };

/**
 * Stable protocol releases are compatible when their majors match and the
 * server minor is at least the client minor. Patch differences are compatible.
 * Prerelease protocol versions must match exactly.
 */
export function checkProtocolCompatibility(
  clientVersion: string,
  serverVersion: string,
): ProtocolCompatibility {
  const client = parseProtocolVersion(clientVersion);
  const server = parseProtocolVersion(serverVersion);

  if (client.prerelease !== undefined || server.prerelease !== undefined) {
    return clientVersion === serverVersion
      ? { compatible: true }
      : { compatible: false, reason: "protocol-prerelease-mismatch" };
  }
  if (client.major !== server.major) {
    return { compatible: false, reason: "protocol-major-mismatch" };
  }
  if (server.minor < client.minor) {
    return { compatible: false, reason: "protocol-server-too-old" };
  }
  return { compatible: true };
}

function parseProtocolVersion(version: string): ParsedProtocolVersion {
  const match = STAGEHAND_SEMVER_PATTERN.exec(version);
  if (!match) throw new Error(`Invalid Stagehand protocol version: ${version}`);
  return {
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    ...(match[4] === undefined ? {} : { prerelease: match[4] }),
  };
}
