export type ExtractionAnswer = {
  epaRegistrationNumber?: string;
  revisionDate?: string;
  [key: string]: unknown;
};

export type ComplianceDecision = {
  status: "APPROVED" | "NEEDS_REVIEW";
  reasons: string[];
};

export function normalizeRegistrationNumber(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/[^0-9]/g, "");
  return normalized.length > 0 ? normalized : undefined;
}

export function decideCompliance(
  sds: ExtractionAnswer,
  label: ExtractionAnswer,
): ComplianceDecision {
  const reasons: string[] = [];
  const sdsRegistration = normalizeRegistrationNumber(sds.epaRegistrationNumber);
  const labelRegistration = normalizeRegistrationNumber(label.epaRegistrationNumber);

  if (!sdsRegistration) {
    reasons.push("The SDS is missing an EPA registration number.");
  }

  if (!labelRegistration) {
    reasons.push("The label is missing an EPA registration number.");
  }

  if (sdsRegistration && labelRegistration && sdsRegistration !== labelRegistration) {
    reasons.push(`EPA registration mismatch: SDS ${sdsRegistration}, label ${labelRegistration}.`);
  }

  if (!sds.revisionDate?.trim()) {
    reasons.push("The SDS is missing a revision date.");
  }

  if (reasons.length > 0) {
    return { status: "NEEDS_REVIEW", reasons };
  }

  return {
    status: "APPROVED",
    reasons: ["The label and SDS registration metadata agree."],
  };
}

export function metadataValues(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) => {
      if (value === undefined || value === null) {
        return [];
      }

      const serialized = typeof value === "string" ? value : JSON.stringify(value);
      return serialized.length > 0 ? [[key, serialized]] : [];
    }),
  );
}
