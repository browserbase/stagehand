import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentEvidenceModality,
  ProbeEvidence,
  Rubric,
  Trajectory,
  TrajectoryStep,
} from "./types.js";
import { redactInlineImagePayloads } from "./evidenceNormalization.js";

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

type PersistedProbeEvidence = ProbeEvidence & {
  screenshotPath?: string;
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
 *   - Image modalities in `agentEvidence.modalities` carry `imagePath` on disk
 *     (relative to the trajectory dir). Legacy `bytesBase64` is also accepted
 *     for trajectories written before the externalization change.
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
    finalObservation?: PersistedProbeEvidence;
    steps: Array<
      TrajectoryStep & {
        agentEvidence: {
          modalities: Array<
            | { type: "text"; content: string }
            | {
                type: "image";
                mediaType: string;
                // Accept both shapes:
                //   imagePath    — new, relative path under the trajectory dir
                //   bytesBase64  — legacy, inline base64
                bytes?: unknown;
                imagePath?: string;
                bytesBase64?: string;
              }
            | { type: "json"; content: unknown }
          >;
        };
        probeEvidence: PersistedProbeEvidence;
      }
    >;
  };

  const resolveWithinTrajectoryDir = (
    candidate: string,
    fieldName = "screenshotPath",
  ): string => {
    const resolved = path.resolve(trajectoryDir, candidate);
    const relative = path.relative(trajectoryDir, resolved);
    const outside =
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative);

    if (outside) {
      throw new Error(
        `Trajectory ${fieldName} escapes trajectory directory: ${candidate}`,
      );
    }

    return resolved;
  };

  const hydrateProbeScreenshot = async (
    probe: PersistedProbeEvidence | undefined,
  ): Promise<void> => {
    if (probe?.screenshotPath && !probe.screenshot) {
      const resolved = resolveWithinTrajectoryDir(probe.screenshotPath);
      try {
        probe.screenshot = await fs.readFile(resolved);
      } catch {
        // Missing screenshot file: leave probe.screenshot unset. The verifier's
        // evidence_insufficient path will handle it.
      }
    }
  };

  for (const step of parsed.steps) {
    // Rehydrate tier-2 probe screenshot from its on-disk file reference.
    await hydrateProbeScreenshot(step.probeEvidence);

    // Rehydrate tier-1 image modalities. New shape: resolve imagePath → Buffer.
    // Legacy shape: decode bytesBase64 → Buffer.
    if (step.agentEvidence?.modalities) {
      const resolved: AgentEvidenceModality[] = [];
      for (const m of step.agentEvidence.modalities) {
        if (m.type !== "image") {
          resolved.push(m as AgentEvidenceModality);
          continue;
        }
        const raw = m as unknown as {
          imagePath?: string;
          bytesBase64?: string;
        };
        if (typeof raw.imagePath === "string") {
          const imagePath = resolveWithinTrajectoryDir(
            raw.imagePath,
            "imagePath",
          );
          try {
            const bytes = await fs.readFile(imagePath);
            resolved.push({ type: "image", bytes, mediaType: m.mediaType });
          } catch {
            // Missing tier-1 image: drop this modality. evidence_insufficient
            // handles the downstream effect.
          }
        } else if (typeof raw.bytesBase64 === "string") {
          resolved.push({
            type: "image",
            bytes: Buffer.from(raw.bytesBase64, "base64"),
            mediaType: m.mediaType,
          });
        } else {
          resolved.push(m as AgentEvidenceModality);
        }
      }
      step.agentEvidence.modalities = resolved;
    }
  }

  await hydrateProbeScreenshot(parsed.finalObservation);

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

/**
 * Default persistence policy: explicit override, then env, then "on unless CI".
 */
export function shouldPersistTrajectory(
  override: boolean | undefined,
): boolean {
  if (override !== undefined) return override;
  const env = process.env.VERIFIER_PERSIST_TRAJECTORIES?.toLowerCase();
  if (env === "1" || env === "true") return true;
  if (env === "0" || env === "false") return false;
  return !process.env.CI;
}

/**
 * Write the on-disk trajectory layout under `dir`:
 *
 *   <dir>/
 *     ├── task_data.json
 *     ├── trajectory.json    (screenshots referenced by path)
 *     ├── screenshots/
 *     │   ├── probe/<N>.png
 *     │   └── agent/<N>[_M].png
 *     ├── scores/            (empty; populated separately)
 *     └── core.log
 *
 * Image bytes are externalized to PNG files; the in-memory Trajectory is left
 * untouched so callers can keep using it after persistence.
 */
export async function writeTrajectoryDir(
  dir: string,
  trajectory: Trajectory,
): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, "screenshots", "probe"), { recursive: true });
  await fs.mkdir(path.join(dir, "screenshots", "agent"), { recursive: true });

  const serializableSteps: unknown[] = [];
  // A single post-turn probe is fanned across every step of a multi-tool turn,
  // and a single agent screenshot is shared across every action a CUA provider
  // chose from it, so the same Buffer is shared by reference. Dedupe by
  // identity: write the PNG once and point every sharing step at the same file.
  const probePathByBuffer = new Map<Buffer, string>();
  const agentPathByBuffer = new Map<Buffer, string>();
  for (const [i, step] of trajectory.steps.entries()) {
    const probe: ProbeEvidence = { ...step.probeEvidence };
    if (probe.screenshot) {
      let relPath = probePathByBuffer.get(probe.screenshot);
      if (!relPath) {
        relPath = `screenshots/probe/${i + 1}.png`;
        await fs.writeFile(path.join(dir, relPath), probe.screenshot);
        probePathByBuffer.set(probe.screenshot, relPath);
      }
      probe.screenshotPath = relPath;
      delete probe.screenshot;
    }

    const imageModalities = step.agentEvidence.modalities.filter(
      (m) => m.type === "image",
    );
    const multipleImages = imageModalities.length > 1;
    let imageSeq = 0;
    const modalities: unknown[] = [];
    for (const m of step.agentEvidence.modalities) {
      if (m.type !== "image") {
        modalities.push(
          m.type === "json"
            ? {
                ...m,
                content: redactInlineImagePayloads(m.content, step.actionName),
              }
            : m,
        );
        continue;
      }
      let relPath = agentPathByBuffer.get(m.bytes);
      if (!relPath) {
        const suffix = multipleImages ? `_${imageSeq}` : "";
        relPath = `screenshots/agent/${i + 1}${suffix}.png`;
        await fs.writeFile(path.join(dir, relPath), m.bytes);
        agentPathByBuffer.set(m.bytes, relPath);
      }
      modalities.push({
        type: "image",
        imagePath: relPath,
        mediaType: m.mediaType,
      });
      imageSeq += 1;
    }
    serializableSteps.push({
      ...step,
      probeEvidence: probe,
      agentEvidence: { modalities },
      toolOutput: {
        ...step.toolOutput,
        result: redactInlineImagePayloads(
          step.toolOutput.result,
          step.actionName,
        ),
      },
    });
  }

  const finalObservation: ProbeEvidence | undefined =
    trajectory.finalObservation === undefined
      ? undefined
      : { ...trajectory.finalObservation };
  if (finalObservation?.screenshot) {
    const relPath = "screenshots/probe/final.png";
    await fs.writeFile(path.join(dir, relPath), finalObservation.screenshot);
    finalObservation.screenshotPath = relPath;
    delete finalObservation.screenshot;
  }

  // Image modalities carry imagePath instead of raw bytes on disk; cast
  // through unknown rather than widen Trajectory's type contract.
  const serialized = {
    ...trajectory,
    steps: serializableSteps,
    ...(finalObservation ? { finalObservation } : {}),
  } as unknown;

  await fs.writeFile(
    path.join(dir, "trajectory.json"),
    JSON.stringify(serialized, null, 2),
  );

  await fs.writeFile(
    path.join(dir, "task_data.json"),
    JSON.stringify(
      {
        task: trajectory.task,
        status: trajectory.status,
        finalAnswer: trajectory.finalAnswer ?? null,
      },
      null,
      2,
    ),
  );

  await fs.mkdir(path.join(dir, "scores"), { recursive: true });
  await fs.writeFile(path.join(dir, "core.log"), coreLog(trajectory));
}

function coreLog(trajectory: Trajectory): string {
  return (
    trajectory.steps
      .map((step, i) =>
        JSON.stringify({
          step: i,
          action: step.actionName,
          url: step.probeEvidence.url ?? null,
          ok: step.toolOutput.ok,
          reasoning: step.reasoning || undefined,
        }),
      )
      .join("\n") + "\n"
  );
}
