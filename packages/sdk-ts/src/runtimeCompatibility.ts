import type {
  ImplementationInfo,
  RuntimeDescriptor,
} from "@browserbasehq/stagehand-protocol/types";
import {
  RuntimeDescriptorSchema,
  STAGEHAND_PROTOCOL_VERSION,
} from "@browserbasehq/stagehand-protocol/schemas";
import { checkProtocolCompatibility } from "@browserbasehq/stagehand-protocol/protocol-version";
import { z } from "zod/v4";

export type RuntimeRequirement = {
  protocolVersion: string;
};
export type RuntimeCompatibility =
  | {
      kind: "compatible";
      protocolVersion: string;
      serverInfo: ImplementationInfo;
    }
  | {
      kind: "incompatible";
      reason:
        | "protocol-invalid-version"
        | "protocol-major-mismatch"
        | "protocol-server-too-old"
        | "protocol-prerelease-mismatch";
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
    const result = RuntimeDescriptorSchema.safeParse(raw);
    if (!result.success)
      return {
        kind: "unknown",
        reason: "unreadable-marker",
        detail: z.prettifyError(result.error),
      };

    const reported = descriptor(result.data);
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
  reason: Extract<RuntimeCompatibility, { kind: "incompatible" }>["reason"],
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
