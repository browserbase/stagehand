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
    precomputedRubric: {
      items: [
        {
          criterion: "Report fare delta",
          description: "Report the difference between two fares.",
          maxPoints: 1,
        },
      ],
    },
  };
}

describe("TrajectoryRecorder", () => {
  it("assembles trajectory evidence from callback events", async () => {
    const recorder = new TrajectoryRecorder({
      taskSpec: makeTaskSpec(),
      persist: false,
    });
    const screenshot = Buffer.from("screen-1");

    recorder.start();
    recorder.record({
      type: "screenshot",
      stepIndex: 0,
      screenshot,
      url: "https://example.com/search",
      evidenceRole: "agent",
    });
    recorder.record({
      type: "screenshot",
      stepIndex: 0,
      screenshot,
      url: "https://example.com/search",
      evidenceRole: "probe",
    });
    recorder.record({
      type: "step_finished",
      stepIndex: 0,
      actionName: "extract",
      actionArgs: { instruction: "Read fares" },
      reasoning: "Read visible fare cells.",
      toolOutput: {
        ok: true,
        result: { economy: "$100", business: "$250" },
      },
    });
    recorder.record({
      type: "step_observed",
      stepIndex: 0,
      url: "https://example.com/search",
      ariaTree: "RootWebArea\nStaticText: Economy $100",
    });
    recorder.record({
      type: "final_answer",
      message: "Business is $150 more than economy.",
      observation: {
        url: "https://example.com/checkout",
        screenshot: Buffer.from("final-screen"),
        ariaTree: "RootWebArea\nStaticText: Complete",
      },
    });

    const trajectory = await recorder.finish({
      status: "complete",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    expect(trajectory.steps).toHaveLength(1);
    expect(trajectory.steps[0]).toMatchObject({
      index: 0,
      actionName: "extract",
      actionArgs: { instruction: "Read fares" },
      reasoning: "Read visible fare cells.",
      toolOutput: {
        ok: true,
        result: { economy: "$100", business: "$250" },
      },
      probeEvidence: {
        url: "https://example.com/search",
        ariaTree: "RootWebArea\nStaticText: Economy $100",
      },
    });
    expect(trajectory.steps[0].probeEvidence.screenshot).toEqual(screenshot);
    expect(trajectory.steps[0].agentEvidence.modalities).toEqual(
      expect.arrayContaining([
        { type: "image", bytes: screenshot, mediaType: "image/png" },
        { type: "text", content: "Read visible fare cells." },
        { type: "json", content: { economy: "$100", business: "$250" } },
      ]),
    );
    expect(trajectory.finalAnswer).toBe("Business is $150 more than economy.");
    expect(trajectory.finalObservation).toMatchObject({
      url: "https://example.com/checkout",
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

    recorder.start();
    recorder.record({
      type: "screenshot",
      stepIndex: 0,
      screenshot,
      url: "https://example.com/search",
      evidenceRole: "agent",
    });
    recorder.record({
      type: "screenshot",
      stepIndex: 0,
      screenshot,
      url: "https://example.com/search",
      evidenceRole: "probe",
    });
    recorder.record({
      type: "step_finished",
      stepIndex: 0,
      actionName: "act",
      actionArgs: { instruction: "Search fares" },
      reasoning: "Search for fares.",
      toolOutput: { ok: true, result: "done" },
    });
    recorder.record({
      type: "step_observed",
      stepIndex: 0,
      url: "https://example.com/search",
    });
    recorder.record({
      type: "final_answer",
      message: "Complete.",
      observation: {
        url: "https://example.com/complete",
        screenshot: Buffer.from("final-screen"),
      },
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

  it("lifts inline screenshot payloads into image evidence and redacts JSON", async () => {
    const inlineScreenshot =
      Buffer.from("inline screenshot").toString("base64");
    const recorder = new TrajectoryRecorder({
      taskSpec: makeTaskSpec(),
      persist: false,
    });

    recorder.record({
      type: "step_finished",
      stepIndex: 0,
      actionName: "click",
      actionArgs: { describe: "Open fare details" },
      reasoning: "Click the fare details button.",
      toolOutput: {
        ok: true,
        result: {
          output: {
            success: true,
            describe: "Open fare details",
            screenshotBase64: inlineScreenshot,
          },
        },
      },
    });

    const trajectory = await recorder.finish({ status: "complete" });
    const step = trajectory.steps[0];
    const rawTrajectory = JSON.stringify(trajectory);
    const imageModalities = step.agentEvidence.modalities.filter(
      (m) => m.type === "image",
    );
    const jsonModality = step.agentEvidence.modalities.find(
      (m) => m.type === "json",
    );

    expect(rawTrajectory).not.toContain(inlineScreenshot);
    expect(step.toolOutput.result).toMatchObject({
      output: {
        success: true,
        describe: "Open fare details",
        screenshotBase64: "[redacted inline image payload]",
      },
    });
    expect(jsonModality).toMatchObject({
      type: "json",
      content: {
        output: {
          screenshotBase64: "[redacted inline image payload]",
        },
      },
    });
    expect(imageModalities).toHaveLength(1);
    expect(imageModalities[0]).toMatchObject({
      type: "image",
      mediaType: "image/png",
    });
    if (imageModalities[0].type === "image") {
      expect(imageModalities[0].bytes).toEqual(
        Buffer.from(inlineScreenshot, "base64"),
      );
    }
  });
});
