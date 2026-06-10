import { describe, expect, it } from "vitest";

import {
  collectCanonicalEvidence,
  isImageEvidence,
  isTextEvidence,
} from "../../lib/v3/verifier/evidence.js";
import type {
  Trajectory,
  TrajectoryStep,
} from "../../lib/v3/verifier/types.js";

const AGENT_IMG = Buffer.from("agent-screenshot-bytes");
const PROBE_IMG = Buffer.from("probe-screenshot-bytes");
const FINAL_IMG = Buffer.from("final-observation-bytes");

function step(overrides: Partial<TrajectoryStep>): TrajectoryStep {
  return {
    actionName: "act",
    actionArgs: {},
    reasoning: "",
    agentEvidence: { modalities: [] },
    probeEvidence: {},
    toolOutput: { ok: true, result: null },
    ...overrides,
  };
}

function makeTrajectory(
  steps: TrajectoryStep[],
  extra: Partial<Trajectory> = {},
): Trajectory {
  return {
    task: { id: "t", instruction: "do it" },
    steps,
    status: "complete",
    usage: { input_tokens: 0, output_tokens: 0 },
    ...extra,
  };
}

describe("collectCanonicalEvidence", () => {
  it("includes tier-1 agent screenshots, probe screenshots, and the final observation", async () => {
    const trajectory = makeTrajectory(
      [
        step({
          actionName: "click",
          agentEvidence: {
            modalities: [
              { type: "image", bytes: AGENT_IMG, mediaType: "image/png" },
              { type: "text", content: "model reasoning" },
            ],
          },
          probeEvidence: {
            url: "https://x",
            screenshot: PROBE_IMG,
            ariaTree: "tree",
          },
        }),
      ],
      {
        finalObservation: {
          url: "https://x/done",
          screenshot: FINAL_IMG,
          ariaTree: "FINAL ARIA TREE",
        },
      },
    );

    const { evidence } = await collectCanonicalEvidence(trajectory);
    const imageBytes = evidence.filter(isImageEvidence).map((e) => e.bytes);

    // P1: the agent-mirrored screenshot is present (previously dropped).
    expect(imageBytes).toContainEqual(AGENT_IMG);
    // tier-2 probe still present.
    expect(imageBytes).toContainEqual(PROBE_IMG);
    // P2: the terminal observation screenshot + aria are present.
    expect(imageBytes).toContainEqual(FINAL_IMG);
    expect(
      evidence.some(
        (e) => isTextEvidence(e) && e.content.includes("FINAL ARIA TREE"),
      ),
    ).toBe(true);
  });

  it("keeps canonicalIndex consistent across evidence and loaded (P2b)", async () => {
    const trajectory = makeTrajectory([
      step({
        agentEvidence: {
          modalities: [
            { type: "image", bytes: AGENT_IMG, mediaType: "image/png" },
          ],
        },
        probeEvidence: {
          url: "https://x",
          screenshot: PROBE_IMG,
          ariaTree: "tree-a",
        },
      }),
      step({
        probeEvidence: {
          url: "https://y",
          screenshot: FINAL_IMG,
          ariaTree: "tree-b",
        },
      }),
    ]);

    const { evidence, loaded } = await collectCanonicalEvidence(trajectory);

    // canonicalIndex is positional in the combined array.
    expect(evidence.every((e, k) => e.canonicalIndex === k)).toBe(true);
    // stepIndexToCanonical values land on image entries in the SAME array.
    for (const idx of loaded.stepIndexToCanonical.values()) {
      expect(isImageEvidence(evidence[idx])).toBe(true);
    }
    // loaded.screenshots are re-stamped into the combined space too: each
    // screenshot's canonicalIndex points at the same image inside evidence.
    for (const shot of loaded.screenshots) {
      const target = evidence[shot.canonicalIndex];
      expect(isImageEvidence(target)).toBe(true);
      if (isImageEvidence(target)) {
        expect(target.bytes).toEqual(shot.bytes);
      }
    }
  });

  it("does not collapse distinct texts that share length and prefix (P3)", async () => {
    const prefix = "x".repeat(220);
    const textA = `${prefix}-ALPHA-tail`;
    const textB = `${prefix}-BETA0-tail`; // same length, same first 200 chars, differ after

    const trajectory = makeTrajectory([
      step({ toolOutput: { ok: true, result: textA } }),
      step({ toolOutput: { ok: true, result: textB } }),
    ]);

    const { evidence } = await collectCanonicalEvidence(trajectory);
    const texts = evidence.filter(isTextEvidence).map((e) => e.content);

    expect(texts).toContain(textA);
    expect(texts).toContain(textB);
  });
});
