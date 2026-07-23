import type { ImplementationInfo, RuntimeDescriptor } from "../../protocol/types.js";
import { RuntimeDescriptorSchema, STAGEHAND_PROTOCOL_VERSION } from "../../protocol/schemas.js";
import { z } from "zod/v4";

export type RuntimeRequirement = {
  minimumProtocolVersion: number;
  maximumProtocolVersion: number;
};
export type RuntimeCompatibility =
  | {
      kind: "compatible";
      protocolVersion: number;
      serverInfo: ImplementationInfo;
    }
  | {
      kind: "incompatible";
      reason: "protocol-below-minimum" | "protocol-above-maximum";
      detail: string;
      required: RuntimeRequirement;
      reported: RuntimeDescriptor;
    }
  | {
      kind: "unknown";
      reason: "missing-marker" | "unreadable-marker";
      detail: string;
    };

export const DEFAULT_RUNTIME_REQUIREMENT: RuntimeRequirement = Object.freeze({
  minimumProtocolVersion: STAGEHAND_PROTOCOL_VERSION,
  maximumProtocolVersion: STAGEHAND_PROTOCOL_VERSION,
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
    const result = RuntimeDescriptorSchema.safeParse(raw);
    if (!result.success)
      return {
        kind: "unknown",
        reason: "unreadable-marker",
        detail: z.prettifyError(result.error),
      };

    const reported = descriptor(result.data);
    if (reported.protocolVersion < required.minimumProtocolVersion)
      return incompatible(
        "protocol-below-minimum",
        `Protocol ${reported.protocolVersion} is below minimum ${required.minimumProtocolVersion}`,
        required,
        reported,
      );
    if (reported.protocolVersion > required.maximumProtocolVersion)
      return incompatible(
        "protocol-above-maximum",
        `Protocol ${reported.protocolVersion} is above maximum ${required.maximumProtocolVersion}`,
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

function descriptor(value: RuntimeDescriptor): RuntimeDescriptor {
  return {
    protocolVersion: value.protocolVersion,
    serverInfo: { ...value.serverInfo },
  };
}

function incompatible(
  reason: Extract<RuntimeCompatibility, { kind: "incompatible" }>["reason"],
  detail: string,
  required: RuntimeRequirement,
  reported: RuntimeDescriptor,
): RuntimeCompatibility {
  return {
    kind: "incompatible",
    reason,
    detail,
    required: { ...required },
    reported,
  };
}
