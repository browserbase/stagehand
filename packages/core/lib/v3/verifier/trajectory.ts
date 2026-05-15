/**
 * Trajectory — structured record of an agent run, consumed by the verifier.
 *
 * Trajectories are produced by the harness (TrajectoryRecorder in
 * packages/evals) from the bus events emitted by v3AgentHandler /
 * v3CuaAgentHandler. They can be persisted on disk and reloaded for offline
 * verifier scoring.
 *
 * Two evidence channels per step:
 *   - agentEvidence ("tier 1") — what the agent's LLM consumed as the tool
 *     result. For DOM/hybrid agents these are the tool returns (extract JSON,
 *     ariaTree text, act describe-string, goto URL). For CUA this is the
 *     screenshot the provider received.
 *   - probeEvidence ("tier 2") — independent observations the harness took
 *     around each step (page.screenshot, page.url, optionally a11y).
 *
 * The verifier consumes both. They can disagree; conflict resolution is the
 * verifier's job (see Verdict.evidenceInsufficient + per-criterion logging).
 */

/** Token usage for one or more LLM calls. Matches AgentResult.usage shape. */
export interface TrajectoryUsage {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens?: number;
  cached_input_tokens?: number;
  inference_time_ms?: number;
}

/**
 * A single criterion in a Stagehand rubric. Dataset and model wire formats may
 * use fara-style `max_points` / `earned_points`; normalize those with
 * `normalizeRubric()` at the boundary.
 */
export interface RubricCriterion {
  /** Short name of the criterion (e.g., "Add ground beef to cart"). */
  criterion: string;
  /** What to evaluate and how to award partial credit. */
  description: string;
  /** Maximum points for this criterion. */
  maxPoints: number;
  /**
   * Triggering condition for conditional criteria. Only counted when met
   * (paper's "Mutually Exclusive Conditionals" pattern).
   */
  condition?: string;
  /** Filled by the verifier during scoring; empty in precomputed rubrics. */
  justification?: string;
  /**
   * Filled by the verifier during scoring; empty string in some serialized
   * upstream rubrics and a number in scored rubrics.
   */
  earnedPoints?: number | string;
}

/** A rubric — list of criteria for a task. */
export interface Rubric {
  items: RubricCriterion[];
}

/**
 * FARA/upstream rubric item shape as stored in datasets and prompt responses.
 * Keep this at IO boundaries; core verifier types use camelCase.
 */
export interface SerializedRubricCriterion {
  criterion: string;
  description: string;
  max_points: number;
  condition?: string;
  justification?: string;
  earned_points?: number | string;
}

/** Serialized rubric shape used by upstream datasets and generated JSON. */
export interface SerializedRubric {
  items: SerializedRubricCriterion[];
}

export type RubricInput = Rubric | SerializedRubric;

/** Convert a Stagehand or serialized rubric into the public Stagehand shape. */
export function normalizeRubric(
  rubric: RubricInput | null | undefined,
): Rubric | undefined {
  if (!rubric) return undefined;

  return {
    items: rubric.items.map((item) => {
      const raw = item as RubricCriterion &
        Partial<SerializedRubricCriterion>;
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

/**
 * Spec for a single task being verified. Carried both at runtime (handed to
 * agent.execute) and into the verifier alongside the trajectory.
 */
export interface TaskSpec {
  /** Stable identifier (e.g., "united_13" for WebTailBench, task_id for Mind2Web). */
  id: string;
  /** Task instruction shown to the agent. */
  instruction: string;
  /** Starting URL, if any. */
  initUrl?: string;
  /**
   * Rubric carried by the dataset (e.g., WebTailBench's precomputed_rubric).
   * If absent, the verifier generates one via Step 0a and caches under
   * packages/evals/.rubric-cache/.
   */
  precomputedRubric?: Rubric;
  /** Optional reference answer (set when dataset ships one). */
  expectedAnswer?: string;
}

/**
 * A single modality unit in tier-1 agent evidence. Mirrors the shape of
 * ModelMessage content parts so we can reproduce what the LLM ingested.
 */
export type AgentEvidenceModality =
  | { type: "text"; content: string }
  | { type: "image"; bytes: Buffer; mediaType: string }
  | { type: "json"; content: unknown };

/**
 * Tier 1 — exactly the bytes/strings/objects the agent's LLM ingested as the
 * tool result for this step.
 *
 * Modes:
 *   - CUA: usually a single image modality (the screenshot sent to the provider).
 *   - Hybrid: tool result with optional screenshotBase64 → one image + one text.
 *   - DOM: tool returns (extract JSON, ariaTree text, etc.) → text/json modalities.
 */
export interface AgentEvidence {
  modalities: AgentEvidenceModality[];
}

/**
 * Tier 2 — independent harness probes around this step. Cheap and always-on
 * for v0 (just url) and v1 (+a11y, +scroll). v2 adds verifier-requested probes
 * keyed on the criterion that requested them.
 *
 * If a probe wasn't captured, the field is absent (not null).
 */
export interface ProbeEvidence {
  /** v0.5 — URL after the step's tool execution. */
  url?: string;
  /**
   * v0 — bus screenshot (page.screenshot post-step). Path on disk is preferred
   * once persisted; in-memory Buffer is used during a live run.
   */
  screenshot?: Buffer;
  /** Reference to the persisted screenshot file under the trajectory dir. */
  screenshotPath?: string;
  /** v1 — viewport scroll context. Lets the verifier reason about "did the agent see the full page". */
  scroll?: { top: number; pageHeight: number };
  /** v1 — accessibility tree snapshot. */
  ariaTree?: string;
  /** v2 — verifier-requested probes, keyed by criterion id. */
  onDemand?: Record<string, unknown>;
}

/** Outcome of a single tool execution as seen by the harness. */
export interface ToolOutput {
  ok: boolean;
  /**
   * The tool's return value. Same payload that flowed into agentEvidence
   * modalities, but in its native shape (e.g., the extract result, the act
   * describe-string) rather than serialized for the LLM.
   */
  result: unknown;
  error?: string;
}

/** One step in a trajectory: action + reasoning + evidence + outcome. */
export interface TrajectoryStep {
  index: number;
  actionName: string;
  actionArgs: Record<string, unknown>;
  /** From AgentAction.reasoning. May be empty for tools that don't surface reasoning. */
  reasoning: string;
  agentEvidence: AgentEvidence;
  probeEvidence: ProbeEvidence;
  toolOutput: ToolOutput;
  /** ISO 8601 timestamp when the step's tool execution started. */
  startedAt: string;
  /** ISO 8601 timestamp when the step's tool execution finished. */
  finishedAt: string;
}

/** Terminal status of the agent run. */
export type TrajectoryStatus = "complete" | "aborted" | "stalled" | "error";

/**
 * Full trajectory for one task run.
 *
 * The on-disk layout is one directory per task:
 *
 *   .trajectories/<run-id>/<task-id>/
 *     ├── task_data.json    — TaskSpec + Verdict (filled on completion)
 *     ├── trajectory.json   — this object, with screenshotPath instead of bytes
 *     ├── screenshot_1.png  — probeEvidence.screenshot for step 1, etc.
 *     ├── scores/
 *     │   └── mmrubric_v1.json  — Verdict from V3Evaluator.verify()
 *     ├── core.log          — action log mirroring fara's core.log
 *     └── times.json        — step timing + token usage
 */
export interface Trajectory {
  task: TaskSpec;
  steps: TrajectoryStep[];
  finalAnswer?: string;
  status: TrajectoryStatus;
  usage: TrajectoryUsage;
  timing: { startedAt: string; endedAt: string };
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
