import fs from "node:fs/promises";
import path from "node:path";

/**
 * Local-persistence grouping for trajectories.
 *
 * Trajectories used to be written at `<root>/<per-task-timestamp>/<task.id>/`,
 * which meant a single eval run's tasks were scattered across timestamp dirs
 * and — when two models ran the same suite concurrently — interleaved into the
 * same root with no on-disk marker of which run they belonged to. Recovering
 * the grouping after the fact required guessing by timestamp.
 *
 * This module lets the eval entrypoint stamp a run-scoped group (the experiment
 * name, plus the model when an override is active) into the env once, so every
 * task in that run lands under `<root>/<group>/<task.id>/<run-timestamp>/`.
 *
 * This is purely a local on-disk concern; it does not affect Braintrust
 * experiment naming or metadata.
 */

const GROUP_ENV = "EVAL_TRAJECTORY_GROUP";
const EXPERIMENT_ENV = "EVAL_EXPERIMENT_NAME";
const MODEL_ENV = "EVAL_MODEL_OVERRIDE";
const PROVIDER_ENV = "EVAL_PROVIDER";
const ENVIRONMENT_ENV = "EVAL_ENV";

/** Filesystem-safe slug: collapse anything outside [A-Za-z0-9._-] to "_". */
export function sanitizeSlug(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Build the run-scoped group slug. The experiment name is the floor; the model
 * is appended only when an override is set (the multi-model A/B case), which is
 * exactly what keeps two models' runs of the same suite from colliding on disk.
 */
export function buildTrajectoryGroupSlug(opts: {
  experimentName: string;
  model?: string;
}): string {
  const parts = [opts.experimentName];
  if (opts.model) parts.push(opts.model);
  return parts.map(sanitizeSlug).filter(Boolean).join("__");
}

/**
 * The group dir for the current run. Defaults to "default" when the entrypoint
 * hasn't stamped a group (e.g. ad-hoc scripts or unit tests) so trajectories are
 * always grouped — never scattered at the root.
 */
export function resolveTrajectoryGroup(): string {
  const raw = process.env[GROUP_ENV];
  return (raw ? sanitizeSlug(raw) : "") || "default";
}

/** The group's root dir: `<root>/<group>`. */
export function resolveTrajectoryGroupDir(root: string): string {
  return path.join(root, resolveTrajectoryGroup());
}

/**
 * Compute the trajectory output dir. Always grouped:
 * `<root>/<group>/<task.id>/<runId>`.
 */
export function resolveTrajectoryDir(
  root: string,
  taskId: string,
  runId: string,
  group: string = resolveTrajectoryGroup(),
): string {
  return path.join(root, group, taskId, runId);
}

/**
 * Atomically reserve a trajectory dir, never overwriting a previous run.
 *
 * Starts from `<root>/<group>/<task.id>/<runId>` and creates the leaf with a
 * NON-recursive mkdir, which fails with EEXIST if the dir already exists. On
 * collision it retries with `<runId>-2`, `<runId>-3`, … until it wins one,
 * returning the reserved dir and its attempt number (1 for the un-suffixed
 * dir). The atomic create is the concurrency-safe part: two trials of the same
 * task that compute the same timestamp `runId` can't both win the same dir, so
 * neither silently clobbers the other — and a re-run reusing a fixed `runId`
 * lands beside the previous run instead of on top of it.
 */
export async function reserveTrajectoryDir(
  root: string,
  taskId: string,
  runId: string,
  group?: string,
): Promise<{ directory: string; attempt: number }> {
  const base = resolveTrajectoryDir(root, taskId, runId, group);
  // The leaf is created non-recursively below, so its parent must exist first.
  await fs.mkdir(path.dirname(base), { recursive: true });
  // Bounded to avoid spinning forever on a pathological filesystem; far higher
  // than any real trial count for a single (group, task).
  const MAX_ATTEMPTS = 10_000;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`;
    try {
      await fs.mkdir(candidate);
      return { directory: candidate, attempt };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // Dir is taken by a previous/concurrent run — try the next suffix.
    }
  }
  throw new Error(
    `reserveTrajectoryDir: exhausted ${MAX_ATTEMPTS} attempts for ${base}`,
  );
}

/**
 * Default trajectory root. Mirrors the recorder/persist default
 * (`<cwd>/.trajectories`) and honours an `EVAL_TRAJECTORY_ROOT` override so the
 * entrypoint writes the experiment link to the same place tasks write to.
 */
export function resolveTrajectoryRoot(): string {
  return (
    process.env.EVAL_TRAJECTORY_ROOT || path.join(process.cwd(), ".trajectories")
  );
}

/**
 * Write `experiment.json` at the group-dir root, cross-linking the local
 * trajectories to the resolved Braintrust experiment (name + hash, id, URLs).
 * The resolved name is only known after `Eval()` finishes, so this is a
 * one-time write from the entrypoint — not per task. Best-effort.
 */
export async function writeExperimentLink(
  root: string,
  link: Record<string, unknown>,
): Promise<void> {
  const dir = resolveTrajectoryGroupDir(root);
  const payload = { ...trajectoryRunMetadata(), ...link };
  if (Object.keys(payload).length === 0) return;
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "experiment.json"),
      JSON.stringify(payload, null, 2),
    );
  } catch {
    // Cross-link is auxiliary; never fail a run over it.
  }
}

/** Run-level metadata captured from env, written alongside each trajectory. */
export function trajectoryRunMetadata(): Record<string, string> {
  const fields: Record<string, string | undefined> = {
    experiment: process.env[EXPERIMENT_ENV],
    model: process.env[MODEL_ENV],
    provider: process.env[PROVIDER_ENV],
    environment: process.env[ENVIRONMENT_ENV],
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) if (v) out[k] = v;
  return out;
}

/**
 * Write `metadata.json` into a trajectory dir (best-effort). Records which run
 * the trajectory belongs to so it never has to be reverse-engineered. The
 * caller-supplied `extra` (e.g. timestamp) is merged over the env-derived base.
 */
export async function writeTrajectoryMetadata(
  directory: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const meta = { ...trajectoryRunMetadata(), ...extra };
  if (Object.keys(meta).length === 0) return;
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, "metadata.json"),
      JSON.stringify(meta, null, 2),
    );
  } catch {
    // Metadata is auxiliary; never fail a run over it.
  }
}
