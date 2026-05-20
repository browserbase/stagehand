import type {
  AgentEvidenceModality,
  ProbeEvidence,
  Rubric,
  Trajectory,
  TrajectoryStep,
} from "./types.js";

type RawRubricCriterion = {
  criterion: unknown;
  description: unknown;
  max_points?: unknown;
  maxPoints?: unknown;
  condition?: unknown;
};

type RawRubric = {
  items?: unknown;
};

/**
 * Convert dataset or generated rubric JSON into the public Stagehand shape.
 * Snake-case dataset fields are accepted here so serialized quirks do not leak
 * into the canonical rubric type.
 */
export function normalizeRubric(rubric: unknown): Rubric | undefined {
  if (rubric == null) return undefined;
  if (typeof rubric !== "object") {
    throw new TypeError("Rubric must be an object");
  }

  const rawRubric = rubric as RawRubric;
  if (!Array.isArray(rawRubric.items)) {
    throw new TypeError("Rubric is missing an items array");
  }

  return {
    items: rawRubric.items.map((item) => {
      const criterion = normalizeRequiredString(item.criterion, "criterion");
      const description = normalizeRequiredString(
        item.description,
        "description",
      );
      const maxPoints = normalizeMaxPoints(item);

      if (typeof maxPoints !== "number" || !Number.isFinite(maxPoints)) {
        throw new TypeError(
          `Rubric criterion "${criterion}" is missing a numeric maxPoints value`,
        );
      }

      return {
        criterion,
        description,
        maxPoints,
        ...(typeof item.condition === "string" && {
          condition: item.condition,
        }),
      };
    }),
  };
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value === "string" && value.length) {
    return value;
  }

  throw new TypeError(`Rubric criterion is missing a ${fieldName} value`);
}

function normalizeMaxPoints(item: RawRubricCriterion): unknown {
  return item.maxPoints ?? item.max_points;
}

function normalizeResultLabel(label?: string): string {
  return (label ?? `rescore-${new Date().toISOString()}`).replace(
    /[^A-Za-z0-9._-]/g,
    "_",
  );
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
  const trajectoryDir = path.resolve(dir);

  const trajectoryPath = path.join(trajectoryDir, "trajectory.json");
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

  const resolveWithinTrajectoryDir = (candidate: string): string => {
    const resolved = path.resolve(trajectoryDir, candidate);
    const relative = path.relative(trajectoryDir, resolved);
    const outside =
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative);

    if (outside) {
      throw new Error(
        `Trajectory screenshotPath escapes trajectory directory: ${candidate}`,
      );
    }

    return resolved;
  };

  for (const step of parsed.steps) {
    // Rehydrate tier-2 probe screenshot from its on-disk file reference.
    const probe = step.probeEvidence;
    if (probe?.screenshotPath && !probe.screenshot) {
      const resolved = resolveWithinTrajectoryDir(probe.screenshotPath);
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
 * Build a `result*.json` filename for persisted evaluator output.
 *
 * Convention: the live run writes `result.json`; offline re-score attempts use
 * a label-based name (e.g., `result_rescore-2026-05-11.json`) so they coexist
 * without collisions and remain easy to diff.
 */
export function nextResultFilename(label?: string): string {
  return `result_${normalizeResultLabel(label)}.json`;
}
