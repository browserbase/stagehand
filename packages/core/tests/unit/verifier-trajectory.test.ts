import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadTrajectoryFromDisk,
  nextVerdictFilename,
  normalizeRubric,
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
          earnedPoints: 2,
          condition: "Only if relevant",
          justification: "Partial credit.",
        },
      ],
    });
  });

  it("loads trajectory screenshots and image modalities from disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "stagehand-verifier-"));
    const screenshot = Buffer.from("probe screenshot");
    const agentImage = Buffer.from("agent image");
    await writeFile(path.join(dir, "screenshot_1.png"), screenshot);
    await writeFile(
      path.join(dir, "trajectory.json"),
      JSON.stringify({
        task: { id: "task", instruction: "Do the task" },
        status: "complete",
        usage: { input_tokens: 0, output_tokens: 0 },
        timing: {
          startedAt: new Date(0).toISOString(),
          endedAt: new Date(0).toISOString(),
        },
        steps: [
          {
            index: 0,
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
            probeEvidence: { screenshotPath: "screenshot_1.png" },
            toolOutput: { ok: true, result: null },
            startedAt: new Date(0).toISOString(),
            finishedAt: new Date(0).toISOString(),
          },
        ],
      }),
    );

    const trajectory = await loadTrajectoryFromDisk(dir);
    const modality = trajectory.steps[0].agentEvidence.modalities[0];

    expect(trajectory.steps[0].probeEvidence.screenshot).toEqual(screenshot);
    expect(modality.type).toBe("image");
    if (modality.type === "image") {
      expect(modality.bytes).toEqual(agentImage);
    }
  });

  it("rejects screenshot paths outside the trajectory directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "stagehand-verifier-"));
    await writeFile(
      path.join(dir, "trajectory.json"),
      JSON.stringify({
        task: { id: "task", instruction: "Do the task" },
        status: "complete",
        usage: { input_tokens: 0, output_tokens: 0 },
        timing: {
          startedAt: new Date(0).toISOString(),
          endedAt: new Date(0).toISOString(),
        },
        steps: [
          {
            index: 0,
            actionName: "act",
            actionArgs: {},
            reasoning: "",
            agentEvidence: { modalities: [] },
            probeEvidence: { screenshotPath: "../../../etc/passwd" },
            toolOutput: { ok: true, result: null },
            startedAt: new Date(0).toISOString(),
            finishedAt: new Date(0).toISOString(),
          },
        ],
      }),
    );

    await expect(loadTrajectoryFromDisk(dir)).rejects.toThrow(
      "escapes trajectory directory",
    );
  });

  it("sanitizes verdict filename labels", () => {
    expect(nextVerdictFilename("rescore / task:one?")).toBe(
      "mmrubric_rescore___task_one_.json",
    );
  });
});
