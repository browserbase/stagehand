import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { TaskSpec } from "@browserbasehq/stagehand";

import { TrajectoryRecorder } from "../../framework/trajectoryRecorder.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): Promise<string> {
  return fs
    .mkdtemp(path.join(os.tmpdir(), "trajectory-recorder-"))
    .then((dir) => {
      tempDirs.push(dir);
      return dir;
    });
}

function makeTaskSpec(): TaskSpec {
  return {
    id: "recorder-task",
    instruction: "Compare economy and business fares.",
    initUrl: "https://example.com",
  };
}

function recordSimpleStep(recorder: TrajectoryRecorder, screenshot: Buffer) {
  recorder.record({
    type: "screenshot",
    screenshot,
    url: "https://example.com/search",
    evidenceRole: "agent",
  });
  recorder.record({
    type: "step_finished",
    actionName: "act",
    actionArgs: { instruction: "Search fares" },
    reasoning: "Search for fares.",
    toolOutput: { ok: true, result: "done" },
  });
  recorder.record({
    type: "screenshot",
    screenshot,
    url: "https://example.com/search",
    evidenceRole: "probe",
  });
  recorder.record({
    type: "step_observed",
    url: "https://example.com/search",
  });
}

function recordFinalAnswer(
  recorder: TrajectoryRecorder,
  opts: { message: string; screenshot: Buffer; ariaTree?: string },
): void {
  recorder.record({
    type: "final_answer",
    message: opts.message,
    observation: {
      url: "https://example.com/complete",
      screenshot: opts.screenshot,
      ...(opts.ariaTree !== undefined ? { ariaTree: opts.ariaTree } : {}),
    },
  });
}

describe("TrajectoryRecorder", () => {
  it("assembles ordered callback events into trajectory steps", async () => {
    const recorder = new TrajectoryRecorder({
      taskSpec: makeTaskSpec(),
      persist: false,
    });
    const screenshot = Buffer.from("screen-1");
    const staleScreenshot = Buffer.from("stale-screen");
    const probeScreenshot = Buffer.from("probe-screen");

    recorder.record({
      type: "screenshot",
      screenshot: staleScreenshot,
      url: "https://example.com/stale",
      evidenceRole: "agent",
    });
    recorder.record({
      type: "screenshot",
      screenshot,
      url: "https://example.com/search",
      evidenceRole: "agent",
    });
    recorder.record({
      type: "step_finished",
      actionName: "click",
      actionArgs: { describe: "Open fares" },
      reasoning: "Open fare details.",
      toolOutput: { ok: true, result: "opened" },
    });
    recorder.record({
      type: "step_finished",
      actionName: "extract",
      actionArgs: { instruction: "Read fares" },
      reasoning: "Read visible fare cells.",
      toolOutput: {
        ok: true,
        result: { economy: "$100", business: "$250" },
      },
    });
    recorder.record({
      type: "screenshot",
      screenshot: probeScreenshot,
      url: "https://example.com/search",
      evidenceRole: "probe",
    });
    recorder.record({
      type: "step_observed",
      url: "https://example.com/search",
      ariaTree: "RootWebArea\nStaticText: Economy $100",
    });
    recordFinalAnswer(recorder, {
      message: "Business is $150 more than economy.",
      screenshot: Buffer.from("final-screen"),
      ariaTree: "RootWebArea\nStaticText: Complete",
    });

    const trajectory = await recorder.finish({
      status: "complete",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    expect(trajectory.steps).toHaveLength(2);
    expect(trajectory.steps[0]).toMatchObject({
      actionName: "click",
      probeEvidence: {
        url: "https://example.com/search",
        ariaTree: "RootWebArea\nStaticText: Economy $100",
      },
    });
    expect(trajectory.steps[1]).toMatchObject({
      actionName: "extract",
      toolOutput: { ok: true, result: { economy: "$100", business: "$250" } },
    });
    expect(trajectory.steps[0].probeEvidence.screenshot).toEqual(
      probeScreenshot,
    );
    expect(trajectory.steps[1].probeEvidence.screenshot).toEqual(
      probeScreenshot,
    );
    expect(trajectory.steps[0].agentEvidence.modalities).toEqual(
      expect.arrayContaining([
        { type: "image", bytes: screenshot, mediaType: "image/png" },
        { type: "text", content: "Open fare details." },
      ]),
    );
    // Both actions were chosen from the same agent screenshot (one screenshot,
    // two step_finished), so the second step must carry that frame too.
    expect(trajectory.steps[1].agentEvidence.modalities).toEqual(
      expect.arrayContaining([
        { type: "image", bytes: screenshot, mediaType: "image/png" },
      ]),
    );
    expect(trajectory.finalAnswer).toBe("Business is $150 more than economy.");
    expect(trajectory.finalObservation).toMatchObject({
      url: "https://example.com/complete",
      ariaTree: "RootWebArea\nStaticText: Complete",
    });
    expect(trajectory.finalObservation?.screenshot).toEqual(
      Buffer.from("final-screen"),
    );
  });

  it("persists trajectory files and evaluator results", async () => {
    const outputRoot = await makeTempDir();
    const recorder = new TrajectoryRecorder({
      taskSpec: makeTaskSpec(),
      outputRoot,
      runId: "run-1",
      persist: true,
    });
    const screenshot = Buffer.from("screen-1");

    recordSimpleStep(recorder, screenshot);
    recordFinalAnswer(recorder, {
      message: "Complete.",
      screenshot: Buffer.from("final-screen"),
    });

    await recorder.finish({ status: "complete" });
    await recorder.persistResult({
      outcomeSuccess: true,
      explanation: "The task was completed.",
    });

    const taskDir = path.join(outputRoot, "run-1", "recorder-task");
    await expect(fs.readdir(taskDir)).resolves.toEqual(
      expect.arrayContaining([
        "core.log",
        "scores",
        "screenshots",
        "task_data.json",
        "trajectory.json",
      ]),
    );
    await expect(
      fs.readFile(path.join(taskDir, "screenshots", "probe", "1.png")),
    ).resolves.toEqual(screenshot);
    await expect(
      fs.readFile(path.join(taskDir, "screenshots", "probe", "final.png")),
    ).resolves.toEqual(Buffer.from("final-screen"));
    await expect(
      fs.readFile(path.join(taskDir, "screenshots", "agent", "1.png")),
    ).resolves.toEqual(screenshot);
    await expect(
      fs.readFile(path.join(taskDir, "scores", "result.json"), "utf8"),
    ).resolves.toContain('"outcomeSuccess": true');

    const trajectory = JSON.parse(
      await fs.readFile(path.join(taskDir, "trajectory.json"), "utf8"),
    );
    expect(trajectory.steps[0].probeEvidence.screenshotPath).toBe(
      "screenshots/probe/1.png",
    );
    expect(trajectory.finalObservation.screenshotPath).toBe(
      "screenshots/probe/final.png",
    );
    expect(trajectory.steps[0].agentEvidence.modalities).toContainEqual({
      type: "image",
      imagePath: "screenshots/agent/1.png",
      mediaType: "image/png",
    });

    const taskData = JSON.parse(
      await fs.readFile(path.join(taskDir, "task_data.json"), "utf8"),
    );
    expect(taskData.result).toMatchObject({
      outcomeSuccess: true,
      explanation: "The task was completed.",
    });
  });
});
