import type { ImplementationInfo } from "@browserbasehq/stagehand-protocol/types";
import {
  ImplementationInfoSchema,
  STAGEHAND_PROTOCOL_VERSION,
} from "@browserbasehq/stagehand-protocol/schemas";
import { checkProtocolCompatibility } from "@browserbasehq/stagehand-protocol/protocol-version";
import { z } from "zod/v4";

export const STAGEHAND_RUNTIME_NAME = "stagehand";

export type RuntimeRequirement = {
  protocolVersion: string;
};
/**
 * The marker a connected runtime published. Unlike the protocol's `RuntimeDescriptor`, the
 * server name is not pinned to "stagehand" so a foreign runtime can be reported as incompatible
 * rather than silently treated as unreadable.
 */
export type ReportedRuntimeDescriptor = {
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
      reported: ReportedRuntimeDescriptor;
    }
  | {
      kind: "unknown";
      reason: "missing-marker" | "unreadable-marker";
      detail: string;
    };

// Accepts any server name so negotiation can distinguish a foreign runtime from garbage, and any
// non-empty protocolVersion string so a non-SemVer version is reported as incompatible
// (protocol-invalid-version) instead of being polled until the initialization timeout.
const ReportedRuntimeDescriptorSchema = z.strictObject({
  protocolVersion: z.string().min(1),
  serverInfo: ImplementationInfoSchema,
});

export const DEFAULT_RUNTIME_REQUIREMENT: RuntimeRequirement = Object.freeze({
  protocolVersion: STAGEHAND_PROTOCOL_VERSION,
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
    const result = ReportedRuntimeDescriptorSchema.safeParse(raw);
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
        `Connected runtime is not Stagehand: serverInfo.name=${JSON.stringify(reported.serverInfo.name)}`,
        required,
        reported,
      );
    const compatibility = checkProtocolCompatibility(
      required.protocolVersion,
      reported.protocolVersion,
    );
    if (!compatibility.compatible)
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

function descriptor(value: ReportedRuntimeDescriptor): ReportedRuntimeDescriptor {
  return {
    protocolVersion: value.protocolVersion,
    serverInfo: { ...value.serverInfo },
  };
}

function incompatible(
  reason: RuntimeIncompatibilityReason,
  detail: string,
  required: RuntimeRequirement,
  reported: ReportedRuntimeDescriptor,
): RuntimeCompatibility {
  return {
    kind: "incompatible",
    reason,
    detail,
    required: { ...required },
    reported,
  };
}
