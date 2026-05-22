import type { AgentEvidenceCallback } from "../../types/public/agentEvidenceEvents.js";
import type { LogLine } from "../../types/public/logs.js";
import type { V3 } from "../../v3.js";
import { captureAriaTreeProbe } from "./captureAriaTreeProbe.js";

interface EmitPostStepProbeEvidenceOptions {
  v3: V3;
  stepIndices: number | number[];
  url: string;
  evidenceCallback?: AgentEvidenceCallback;
  logger: (message: LogLine) => void;
  warningMessage: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function emitPostStepProbeEvidence({
  v3,
  stepIndices,
  url,
  evidenceCallback,
  logger,
  warningMessage,
}: EmitPostStepProbeEvidenceOptions): Promise<void> {
  if (!evidenceCallback) return;

  const indices = Array.isArray(stepIndices) ? stepIndices : [stepIndices];
  if (indices.length === 0) return;

  let probeUrl = url;
  let screenshot: Buffer | undefined;
  try {
    const page = await v3.context.awaitActivePage();
    probeUrl = page.url();
    screenshot = await page.screenshot({ fullPage: false });
  } catch (e) {
    logger({
      category: "agent",
      message: `${warningMessage}: ${errorMessage(e)}`,
      level: 1,
    });
  }

  const ariaTree = await captureAriaTreeProbe(v3);
  for (const stepIndex of indices) {
    if (screenshot) {
      await evidenceCallback({
        type: "screenshot",
        stepIndex,
        screenshot,
        url: probeUrl,
        evidenceRole: "probe",
      });
    }
    await evidenceCallback({
      type: "step_observed",
      stepIndex,
      url: probeUrl,
      ariaTree,
    });
  }
}
