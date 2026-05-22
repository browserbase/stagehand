import type { AgentScreenshotEvidenceEvent } from "../../types/public/agentEvidenceEvents.js";

export interface PairedCuaActionStep {
  stepIndex: number;
  replayScreenshot?: AgentScreenshotEvidenceEvent;
}

export class CuaEvidenceStepTracker {
  private nextStepIndex = 0;
  private latestScreenshot?: AgentScreenshotEvidenceEvent;
  private latestScreenshotConsumed = true;

  reset(): void {
    this.nextStepIndex = 0;
    this.latestScreenshot = undefined;
    this.latestScreenshotConsumed = true;
  }

  recordScreenshot(
    screenshot: Buffer,
    url: string,
  ): AgentScreenshotEvidenceEvent {
    const event: AgentScreenshotEvidenceEvent = {
      type: "screenshot",
      stepIndex: this.nextStepIndex++,
      screenshot,
      url,
      evidenceRole: "agent",
    };
    this.latestScreenshot = event;
    this.latestScreenshotConsumed = false;
    return event;
  }

  pairAction(): PairedCuaActionStep {
    if (this.latestScreenshot && !this.latestScreenshotConsumed) {
      this.latestScreenshotConsumed = true;
      return { stepIndex: this.latestScreenshot.stepIndex };
    }

    const stepIndex = this.nextStepIndex++;
    if (this.latestScreenshot) {
      return {
        stepIndex,
        replayScreenshot: { ...this.latestScreenshot, stepIndex },
      };
    }

    return { stepIndex };
  }

  get latestScreenshotUrl(): string | undefined {
    return this.latestScreenshot?.url;
  }
}
