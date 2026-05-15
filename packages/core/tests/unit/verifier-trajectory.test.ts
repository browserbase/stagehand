import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadTrajectoryFromDisk,
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
});
