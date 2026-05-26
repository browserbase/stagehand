import type { AgentEvidenceCallback } from "../../types/public/agentEvidenceEvents.js";
import type { LogLine } from "../../types/public/logs.js";
import type { V3 } from "../../v3.js";
import { captureAriaTreeProbe } from "./captureAriaTreeProbe.js";

interface CaptureProbeEvidenceOptions {
  v3: V3;
  url: string;
  logger: (message: LogLine) => void;
  warningMessage: string;
}

interface EmitPostStepProbeEvidenceOptions extends CaptureProbeEvidenceOptions {
  evidenceCallback?: AgentEvidenceCallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function captureProbeEvidence({
  v3,
  url,
  logger,
  warningMessage,
}: CaptureProbeEvidenceOptions): Promise<{
  url: string;
  screenshot?: Buffer;
  ariaTree?: string;
}> {
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
  return {
    url: probeUrl,
    ...(screenshot ? { screenshot } : {}),
    ...(ariaTree !== undefined ? { ariaTree } : {}),
  };
}

export async function emitPostStepProbeEvidence({
  v3,
  url,
  evidenceCallback,
  logger,
  warningMessage,
}: EmitPostStepProbeEvidenceOptions): Promise<void> {
  if (!evidenceCallback) return;

  const probe = await captureProbeEvidence({
    v3,
    url,
    logger,
    warningMessage,
  });
  if (probe.screenshot) {
    await evidenceCallback({
      type: "screenshot",
      screenshot: probe.screenshot,
      url: probe.url,
      evidenceRole: "probe",
    });
  }
  await evidenceCallback({
    type: "step_observed",
    url: probe.url,
    ariaTree: probe.ariaTree,
  });
}
