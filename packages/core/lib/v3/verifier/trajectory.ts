import type {
  ProbeEvidence,
  Rubric,
  RubricCriterion,
  RubricInput,
  SerializedRubricCriterion,
  Trajectory,
  TrajectoryStep,
} from "./types.js";

export type {
  AgentEvidence,
  AgentEvidenceModality,
  ProbeEvidence,
  Rubric,
  RubricCriterion,
  RubricInput,
  SerializedRubric,
  SerializedRubricCriterion,
  TaskSpec,
  ToolOutput,
  Trajectory,
  TrajectoryStatus,
  TrajectoryStep,
  TrajectoryUsage,
} from "./types.js";

/** Convert a Stagehand or serialized rubric into the public Stagehand shape. */
export function normalizeRubric(
  rubric: RubricInput | null | undefined,
): Rubric | undefined {
  if (!rubric) return undefined;

  return {
    items: rubric.items.map((item) => {
      const raw = item as RubricCriterion & Partial<SerializedRubricCriterion>;
      const maxPoints =
        typeof raw.maxPoints === "number" ? raw.maxPoints : raw.max_points;

      if (typeof maxPoints !== "number" || !Number.isFinite(maxPoints)) {
        throw new TypeError(
          `Rubric criterion "${raw.criterion}" is missing a numeric maxPoints value`,
        );
      }

      const earnedPoints = raw.earnedPoints ?? raw.earned_points;
      return {
        criterion: raw.criterion,
        description: raw.description,
        maxPoints,
        ...(raw.condition !== undefined && { condition: raw.condition }),
        ...(raw.justification !== undefined && {
          justification: raw.justification,
        }),
        ...(earnedPoints !== undefined && { earnedPoints }),
      };
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// On-disk loader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hydrate a Trajectory from the on-disk directory layout written by
 * TrajectoryRecorder.persist(). Used by the offline re-scoring CLI (`bench
 * verify`) and by any consumer that wants to feed a saved trajectory back
 * into V3Evaluator.verify() without running an agent.
 *
 * Reverses the recorder's serialization tweaks:
 *   - `probeEvidence.screenshotPath` → read file into `probeEvidence.screenshot`.
 *   - Image modalities in `agentEvidence.modalities` carry `bytesBase64` on
 *     disk (human-readable JSON) instead of raw Buffer; we decode back.
 *
 * @param dir absolute or cwd-relative path to a `<run-id>/<task-id>/` directory.
 */
export async function loadTrajectoryFromDisk(dir: string): Promise<Trajectory> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const trajectoryPath = path.join(dir, "trajectory.json");
  const raw = await fs.readFile(trajectoryPath, "utf8");
  const parsed = JSON.parse(raw) as Trajectory & {
    steps: Array<
      TrajectoryStep & {
        agentEvidence: {
          modalities: Array<
            | { type: "text"; content: string }
            | {
                type: "image";
                mediaType: string;
                // On-disk form (recorder writes base64); accept either to
                // tolerate hand-edited fixtures.
                bytes?: unknown;
                bytesBase64?: string;
              }
            | { type: "json"; content: unknown }
          >;
        };
        probeEvidence: ProbeEvidence;
      }
    >;
  };

  for (const step of parsed.steps) {
    // Rehydrate tier-2 probe screenshot from its on-disk file reference.
    const probe = step.probeEvidence;
    if (probe?.screenshotPath && !probe.screenshot) {
      const resolved = path.isAbsolute(probe.screenshotPath)
        ? probe.screenshotPath
        : path.join(dir, probe.screenshotPath);
      try {
        probe.screenshot = await fs.readFile(resolved);
      } catch {
        // Missing screenshot file: leave probe.screenshot unset. The verifier's
        // evidence_insufficient path will handle it.
      }
    }

    // Decode image modalities from base64 back to Buffer.
    if (step.agentEvidence?.modalities) {
      step.agentEvidence.modalities = step.agentEvidence.modalities.map((m) => {
        // The on-disk shape carries bytesBase64 instead of bytes, so we look
        // through `unknown` here rather than rely on the typed union.
        const raw = m as unknown as { bytesBase64?: string };
        if (m.type === "image" && typeof raw.bytesBase64 === "string") {
          return {
            type: "image" as const,
            bytes: Buffer.from(raw.bytesBase64, "base64"),
            mediaType: m.mediaType,
          };
        }
        return m as AgentEvidenceModality;
      });
    }
  }

  return parsed;
}

/**
 * Locate the next available `mmrubric_*.json` filename for a given trajectory
 * directory. Used by offline re-scoring to avoid overwriting prior verdicts.
 *
 * Convention: prefer a label-based name (e.g., `mmrubric_rescore-2026-05-11.json`)
 * over numeric versioning so multiple offline rescore attempts coexist without
 * collisions and remain easy to diff. Falls back to a timestamp if the caller
 * doesn't provide a label.
 */
export function nextVerdictFilename(label?: string): string {
  const safeLabel = (label ?? `rescore-${new Date().toISOString()}`).replace(
    /[^A-Za-z0-9._-]/g,
    "_",
  );
  return `mmrubric_${safeLabel}.json`;
}
