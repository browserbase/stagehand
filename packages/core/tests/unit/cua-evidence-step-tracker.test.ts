import { describe, expect, it } from "vitest";

import { CuaEvidenceStepTracker } from "../../lib/v3/agent/utils/cuaEvidenceStepTracker.js";

describe("CuaEvidenceStepTracker", () => {
  it("pairs a fresh provider screenshot with the next action", () => {
    const tracker = new CuaEvidenceStepTracker();
    const screenshot = Buffer.from("screen");

    const event = tracker.recordScreenshot(screenshot, "https://example.com");
    const paired = tracker.pairAction();

    expect(event).toMatchObject({
      type: "screenshot",
      stepIndex: 0,
      evidenceRole: "agent",
      url: "https://example.com",
    });
    expect(paired).toEqual({ stepIndex: 0 });
  });

  it("allocates an action step without screenshot evidence", () => {
    const tracker = new CuaEvidenceStepTracker();

    expect(tracker.pairAction()).toEqual({ stepIndex: 0 });
  });

  it("replays the latest consumed screenshot for later actions", () => {
    const tracker = new CuaEvidenceStepTracker();
    const screenshot = Buffer.from("screen");

    tracker.recordScreenshot(screenshot, "https://example.com/start");
    tracker.pairAction();
    const paired = tracker.pairAction();

    expect(paired.stepIndex).toBe(1);
    expect(paired.replayScreenshot).toMatchObject({
      type: "screenshot",
      stepIndex: 1,
      evidenceRole: "agent",
      url: "https://example.com/start",
    });
    expect(paired.replayScreenshot?.screenshot).toEqual(screenshot);
  });

  it("resets step allocation and pending screenshot state", () => {
    const tracker = new CuaEvidenceStepTracker();

    tracker.recordScreenshot(Buffer.from("screen"), "https://example.com");
    tracker.reset();

    expect(tracker.pairAction()).toEqual({ stepIndex: 0 });
    expect(tracker.latestScreenshotUrl).toBeUndefined();
  });
});
