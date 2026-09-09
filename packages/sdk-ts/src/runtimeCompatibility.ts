import type { ImplementationInfo } from "../../protocol/types.js";
import { ImplementationInfoSchema, STAGEHAND_PROTOCOL_VERSION } from "../../protocol/schemas.js";
import { checkProtocolCompatibility } from "../../protocol/protocol-version.js";
import { z } from "zod/v4";

export type RuntimeRequirement = {
  protocolVersion: string;
};
/** The runtime marker as reported by the extension, before the runtime name is validated. */
export type ReportedRuntime = {
  protocolVersion: string;
  serverInfo: ImplementationInfo;
};
export type RuntimeIncompatibilityReason =
  | "protocol-invalid-version"
  | "protocol-major-mismatch"
  | "protocol-server-too-old"
  | "protocol-prerelease-mismatch"
  | "runtime-name-mismatch";
export type RuntimeCompatibility =
  | {
      kind: "compatible";
      protocolVersion: string;
      serverInfo: ImplementationInfo;
    }
  | {
      kind: "incompatible";
      reason: RuntimeIncompatibilityReason;
      detail: string;
      required: RuntimeRequirement;
      reported: ReportedRuntime;
    }
  | {
      kind: "unknown";
      reason: "missing-marker" | "unreadable-marker";
      detail: string;
    };

export const DEFAULT_RUNTIME_REQUIREMENT: RuntimeRequirement = Object.freeze({
  protocolVersion: STAGEHAND_PROTOCOL_VERSION,
});

export const STAGEHAND_RUNTIME_NAME = "stagehand";

export const RUNTIME_INCOMPATIBILITY_REMEDIATION =
  "Upgrade the Stagehand SDK and the Stagehand extension together so their protocol majors match, " +
  "or start the session with the extension bundled in this SDK.";

// Accepts any runtime name and any non-empty protocolVersion string so a foreign runtime or a
// non-SemVer protocol version is reported as incompatible (fail fast) rather than unknown (poll).
const ReportedRuntimeSchema = z.strictObject({
  protocolVersion: z.string().min(1),
  serverInfo: ImplementationInfoSchema,
});

export function negotiateRuntimeCompatibility(
  required: RuntimeRequirement,
  raw: unknown,
): RuntimeCompatibility {
  if (raw == null)
    return {
      kind: "unknown",
      reason: "missing-marker",
      detail: "Runtime marker is absent",
    };

  try {
    const result = ReportedRuntimeSchema.safeParse(raw);
    if (!result.success)
      return {
        kind: "unknown",
        reason: "unreadable-marker",
        detail: z.prettifyError(result.error),
      };

    const reported = descriptor(result.data);
    if (reported.serverInfo.name !== STAGEHAND_RUNTIME_NAME)
      return incompatible(
        "runtime-name-mismatch",
        `Runtime name mismatch: expected "${STAGEHAND_RUNTIME_NAME}", server reported "${reported.serverInfo.name}"`,
        required,
        reported,
      );
    const compatibility = checkProtocolCompatibility(
      required.protocolVersion,
      reported.protocolVersion,
    );
    if (compatibility.compatible === false)
      return incompatible(
        compatibility.reason,
        compatibilityDetail(
          compatibility.reason,
          required.protocolVersion,
          reported.protocolVersion,
        ),
        required,
        reported,
      );
    return {
      kind: "compatible",
      protocolVersion: reported.protocolVersion,
      serverInfo: reported.serverInfo,
    };
  } catch {
    return {
      kind: "unknown",
      reason: "unreadable-marker",
      detail: "Runtime marker could not be read",
    };
  }
}

function compatibilityDetail(
  reason: Exclude<RuntimeIncompatibilityReason, "runtime-name-mismatch">,
  clientVersion: string,
  serverVersion: string,
): string {
  switch (reason) {
    case "protocol-invalid-version":
      return `Invalid protocol version: client ${clientVersion}, server ${serverVersion}`;
    case "protocol-major-mismatch":
      return `Protocol major mismatch: client ${clientVersion}, server ${serverVersion}`;
    case "protocol-server-too-old":
      return `Server protocol ${serverVersion} is older than client requirement ${clientVersion}`;
    case "protocol-prerelease-mismatch":
      return `Protocol prereleases must match exactly: client ${clientVersion}, server ${serverVersion}`;
  }
}

function descriptor(value: ReportedRuntime): ReportedRuntime {
  return {
    protocolVersion: value.protocolVersion,
    serverInfo: { ...value.serverInfo },
  };
}

function incompatible(
  reason: RuntimeIncompatibilityReason,
  detail: string,
  required: RuntimeRequirement,
  reported: ReportedRuntime,
): RuntimeCompatibility {
  return {
    kind: "incompatible",
    reason,
    detail,
    required: { ...required },
    reported,
  };
}
