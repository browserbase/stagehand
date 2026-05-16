import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadTrajectoryFromDisk } from "@browserbasehq/stagehand";
import type {
  EvaluationResult,
  TaskSpec,
  Trajectory,
} from "@browserbasehq/stagehand";
import { describe, expect, it } from "vitest";

import { persistAdapterTrajectory } from "../../framework/harnesses/persistTrajectory.js";

const PROBE_PNG = Buffer.from("fake-probe-bytes-1234", "utf8");
const AGENT_PNG = Buffer.from("fake-agent-bytes-5678", "utf8");

describe("persistAdapterTrajectory", () => {
  it("round-trips probe and agent image evidence through loadTrajectoryFromDisk", async () => {
    const tmpRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "persist-adapter-roundtrip-"),
    );

    try {
      const taskSpec: TaskSpec = {
        id: "roundtrip-task",
        instruction: "Test task",
        initUrl: "https://example.com",
      };
      const evaluationResult: EvaluationResult = {
        outcomeSuccess: true,
        processScore: 1,
        perCriterion: [],
        evidenceInsufficient: [],
      };
      const { directory, persisted } = await persistAdapterTrajectory({
        trajectory: makeTrajectory(taskSpec),
        taskSpec,
        evaluationResult,
        outputRoot: tmpRoot,
        runId: "roundtrip-run",
        persist: true,
      });

      expect(persisted).toBe(true);
      await expect(fs.readdir(directory)).resolves.toEqual(
        expect.arrayContaining([
          "core.log",
          "scores",
          "screenshots",
          "task_data.json",
          "times.json",
          "trajectory.json",
        ]),
      );
      await expect(
        fs.readFile(path.join(directory, "screenshots", "probe", "1.png")),
      ).resolves.toEqual(PROBE_PNG);
      await expect(
        fs.readFile(path.join(directory, "screenshots", "agent", "1.png")),
      ).resolves.toEqual(AGENT_PNG);
      await expect(
        fs.readFile(path.join(directory, "scores", "result.json"), "utf8"),
      ).resolves.toContain('"outcomeSuccess": true');
      await expect(
        fs.readFile(path.join(directory, "task_data.json"), "utf8"),
      ).resolves.toContain('"result"');

      const loaded = await loadTrajectoryFromDisk(directory);
      const step = loaded.steps[0];
      const imageModality = step.agentEvidence.modalities.find(
        (
          modality,
        ): modality is Extract<
          (typeof step.agentEvidence.modalities)[number],
          { type: "image" }
        > => modality.type === "image",
      );
      const textModality = step.agentEvidence.modalities.find(
        (
          modality,
        ): modality is Extract<
          (typeof step.agentEvidence.modalities)[number],
          { type: "text" }
        > => modality.type === "text",
      );

      expect(step.probeEvidence.screenshot).toEqual(PROBE_PNG);
      expect(imageModality?.bytes).toEqual(AGENT_PNG);
      expect(imageModality?.mediaType).toBe("image/png");
      expect(textModality?.content).toBe("navigated");
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});

function makeTrajectory(task: TaskSpec): Trajectory {
  return {
    task,
    status: "complete",
    finalAnswer: "Final answer text.",
    usage: { input_tokens: 100, output_tokens: 50 },
    timing: {
      startedAt: "2026-05-15T10:00:00.000Z",
      endedAt: "2026-05-15T10:01:00.000Z",
    },
    steps: [
      {
        index: 0,
        actionName: "goto",
        actionArgs: { url: "https://example.com" },
        reasoning: "Open the page.",
        agentEvidence: {
          modalities: [
            { type: "text", content: "navigated" },
            { type: "image", bytes: AGENT_PNG, mediaType: "image/png" },
          ],
        },
        probeEvidence: {
          url: "https://example.com",
          screenshot: PROBE_PNG,
        },
        toolOutput: { ok: true, result: { url: "https://example.com" } },
        startedAt: "2026-05-15T10:00:00.000Z",
        finishedAt: "2026-05-15T10:00:05.000Z",
      },
    ],
  };
}
