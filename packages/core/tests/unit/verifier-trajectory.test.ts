import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadTrajectoryFromDisk,
  nextResultFilename,
  normalizeRubric,
  writeTrajectoryDir,
} from "../../lib/v3/verifier/trajectory.js";

describe("verifier trajectory utilities", () => {
  it("normalizes serialized empty earned points out of public rubrics", () => {
    expect(
      normalizeRubric({
        items: [
          {
            criterion: "Criterion",
            description: "Description",
            max_points: 1,
            earned_points: "",
          },
        ],
      }),
    ).toEqual({
      items: [
        {
          criterion: "Criterion",
          description: "Description",
          maxPoints: 1,
        },
      ],
    });
  });

  it("round-trips serialized snake_case rubrics to public camelCase rubrics", () => {
    expect(
      normalizeRubric({
        items: [
          {
            criterion: "Criterion",
            description: "Description",
            max_points: 3,
            earned_points: "2",
            condition: "Only if relevant",
            justification: "Partial credit.",
          },
        ],
      }),
    ).toEqual({
      items: [
        {
          criterion: "Criterion",
          description: "Description",
          maxPoints: 3,
          condition: "Only if relevant",
        },
      ],
    });
  });

  it("loads trajectory screenshots and image modalities from disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "stagehand-verifier-"));
    const screenshot = Buffer.from("probe screenshot");
    const finalScreenshot = Buffer.from("final screenshot");
    const agentImage = Buffer.from("agent image");
    await writeFile(path.join(dir, "screenshot_1.png"), screenshot);
    await writeFile(path.join(dir, "final.png"), finalScreenshot);
    await mkdir(path.join(dir, "screenshots", "agent"), { recursive: true });
    await writeFile(
      path.join(dir, "screenshots", "agent", "1.png"),
      agentImage,
    );
    await writeFile(
      path.join(dir, "trajectory.json"),
      JSON.stringify({
        task: { id: "task", instruction: "Do the task" },
        status: "complete",
        usage: { input_tokens: 0, output_tokens: 0 },
        steps: [
          {
            actionName: "act",
            actionArgs: {},
            reasoning: "",
            agentEvidence: {
              modalities: [
                {
                  type: "image",
                  mediaType: "image/png",
                  imagePath: "screenshots/agent/1.png",
                },
              ],
            },
            probeEvidence: { screenshotPath: "screenshot_1.png" },
            toolOutput: { ok: true, result: null },
          },
        ],
        finalObservation: {
          url: "https://example.com/done",
          screenshotPath: "final.png",
        },
      }),
    );

    const trajectory = await loadTrajectoryFromDisk(dir);
    const modality = trajectory.steps[0].agentEvidence.modalities[0];

    expect(trajectory.steps[0].probeEvidence.screenshot).toEqual(screenshot);
    expect(trajectory.finalObservation?.screenshot).toEqual(finalScreenshot);
    expect(modality.type).toBe("image");
    if (modality.type === "image") {
      expect(modality.bytes).toEqual(agentImage);
    }
  });

  it("loads legacy base64 image modalities from disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "stagehand-verifier-"));
    const agentImage = Buffer.from("legacy agent image");
    await writeFile(
      path.join(dir, "trajectory.json"),
      JSON.stringify({
        task: { id: "task", instruction: "Do the task" },
        status: "complete",
        usage: { input_tokens: 0, output_tokens: 0 },
        steps: [
          {
            actionName: "act",
            actionArgs: {},
            reasoning: "",
            agentEvidence: {
              modalities: [
                {
                  type: "image",
                  mediaType: "image/png",
                  bytesBase64: agentImage.toString("base64"),
                },
              ],
            },
            probeEvidence: {},
            toolOutput: { ok: true, result: null },
          },
        ],
      }),
    );

    const trajectory = await loadTrajectoryFromDisk(dir);
    const modality = trajectory.steps[0].agentEvidence.modalities[0];

    expect(modality.type).toBe("image");
    if (modality.type === "image") {
      expect(modality.bytes).toEqual(agentImage);
    }
  });

  it("redacts inline screenshot payloads when writing trajectories", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "stagehand-verifier-"));
    const inlineScreenshot =
      Buffer.from("inline screenshot").toString("base64");

    await writeTrajectoryDir(dir, {
      task: { id: "task", instruction: "Do the task" },
      status: "complete",
      usage: { input_tokens: 0, output_tokens: 0 },
      finalObservation: {
        url: "https://example.com/done",
        screenshot: Buffer.from("final screenshot"),
      },
      steps: [
        {
          actionName: "click",
          actionArgs: {},
          reasoning: "",
          agentEvidence: {
            modalities: [
              {
                type: "json",
                content: {
                  output: {
                    success: true,
                    screenshotBase64: inlineScreenshot,
                  },
                },
              },
            ],
          },
          probeEvidence: {},
          toolOutput: {
            ok: true,
            result: {
              output: {
                success: true,
                screenshotBase64: inlineScreenshot,
              },
            },
          },
        },
      ],
    });

    const raw = await readFile(path.join(dir, "trajectory.json"), "utf8");
    const trajectory = JSON.parse(raw);

    expect(raw).not.toContain(inlineScreenshot);
    expect(
      trajectory.steps[0].agentEvidence.modalities[0].content.output
        .screenshotBase64,
    ).toBe("[redacted inline image payload]");
    expect(trajectory.steps[0].toolOutput.result.output.screenshotBase64).toBe(
      "[redacted inline image payload]",
    );
    expect(trajectory.finalObservation.screenshotPath).toBe(
      "screenshots/probe/final.png",
    );
    await expect(
      readFile(path.join(dir, "screenshots", "probe", "final.png")),
    ).resolves.toEqual(Buffer.from("final screenshot"));
  });

  it("rejects screenshot paths outside the trajectory directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "stagehand-verifier-"));
    await writeFile(
      path.join(dir, "trajectory.json"),
      JSON.stringify({
        task: { id: "task", instruction: "Do the task" },
        status: "complete",
        usage: { input_tokens: 0, output_tokens: 0 },
        steps: [
          {
            actionName: "act",
            actionArgs: {},
            reasoning: "",
            agentEvidence: { modalities: [] },
            probeEvidence: { screenshotPath: "../../../etc/passwd" },
            toolOutput: { ok: true, result: null },
          },
        ],
      }),
    );

    await expect(loadTrajectoryFromDisk(dir)).rejects.toThrow(
      "escapes trajectory directory",
    );
  });

  it("sanitizes result filename labels", () => {
    expect(nextResultFilename("rescore / task:one?")).toBe(
      "result_rescore___task_one_.json",
    );
  });
});
