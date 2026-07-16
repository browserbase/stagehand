import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { shouldPersistTrajectory } from "@browserbasehq/stagehand";

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
 * name, the model when it is unambiguous, plus a run token) into the env once,
 * so every task in that run lands under
 * `<root>/<experiment>[__<model>]__<runToken>/<task.id>/<run-timestamp>/`.
 *
 * The run token is what makes the group *run-unique*: the experiment name is
 * deterministic (e.g. "agent" or "all"), so without it a re-run of the same
 * suite would land in the same group dir and clobber its `experiment.json`,
 * silently relabelling the earlier run's trajectories with the newer run's
 * Braintrust provenance.
 *
 * This is purely a local on-disk concern; it does not affect Braintrust
 * experiment naming or metadata.
 */

const GROUP_ENV = "EVAL_TRAJECTORY_GROUP";
const EXPERIMENT_ENV = "EVAL_EXPERIMENT_NAME";
const TRAJECTORY_MODEL_ENV = "EVAL_TRAJECTORY_MODEL";
const PROVIDER_ENV = "EVAL_PROVIDER";
const ENVIRONMENT_ENV = "EVAL_ENV";

/**
 * Filesystem-safe slug: collapse anything outside [A-Za-z0-9._-] to "_".
 *
 * Path separators are already collapsed to "_" by the whitelist, but a value of
 * pure dots survives it (".", ".." are all whitelisted characters) and would be
 * interpreted by `path.join` as a path component rather than a name:
 *   - ".."  escapes the trajectory root entirely (`<root>/../<task>` writes a
 *     level ABOVE the root, and the best-effort `catch` would hide it), and
 *   - "."   collapses the group into the root, re-scattering trajectories at the
 *     top level and sharing one `experiment.json` across every run — exactly the
 *     two states this module exists to prevent.
 * `EVAL_TRAJECTORY_GROUP` is caller-supplied (integrations may set any value), so
 * reject those here. Returning "" lets callers fall through to the "default"
 * floor in `resolveTrajectoryGroup`.
 */
export function sanitizeSlug(value: string): string {
  const slug = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^\.+$/.test(slug) ? "" : slug;
}

/** Random bytes appended to a run token. See RUN_TOKEN_ENTROPY_BYTES rationale. */
const RUN_TOKEN_ENTROPY_BYTES = 8;

/**
 * A compact, sortable, filesystem-safe, collision-resistant token identifying a
 * single run, e.g. "20260715-110342-9f3a1c2b4d6e8f01" (local time followed by
 * random entropy). Generate this EXACTLY ONCE per run in the entrypoint and reuse
 * it — calling it twice within one run would split that run's trajectories across
 * two group dirs.
 *
 * The timestamp alone is only second-granular, so the entropy is what actually
 * separates two runs of the same experiment+model started in the same second.
 * 8 bytes (2^64) keeps the birthday-collision probability negligible even at
 * absurd concurrency (~3e-14 for 1000 simultaneous starts, vs ~3% for 3 bytes) —
 * the width is essentially free here, so it is sized for the pathological case
 * rather than the realistic one (2-8 concurrent runs).
 *
 * Note this is deliberately NOT an atomic group-dir reservation: reserving the
 * group up front would require the entrypoint to create `<root>/<group>/` before
 * any task runs, which would defeat `writeExperimentLink`'s "group dir exists =>
 * something was recorded" backstop and bring empty group dirs back. Reservation
 * stays where it can be atomic without that cost: the per-trajectory leaf dir
 * (`reserveTrajectoryDir`).
 */
export function generateRunToken(
  now: Date = new Date(),
  entropy: string = randomBytes(RUN_TOKEN_ENTROPY_BYTES).toString("hex"),
): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${date}-${time}-${entropy}`;
}

/**
 * Resolve the model that every model-backed testcase in a run actually uses.
 * A run-global model override is only a request and does not imply that the
 * generated testcase matrix ran that model, so ambiguous provenance is omitted.
 */
export function resolveUnambiguousModel(
  models: ReadonlyArray<string | undefined>,
): string | undefined {
  const resolved = new Set<string>();
  for (const model of models) {
    const value = model?.trim();
    if (!value || value.toLowerCase() === "none") continue;
    resolved.add(value);
  }
  return resolved.size === 1 ? resolved.values().next().value : undefined;
}

/**
 * Build the run-scoped group slug. The experiment name is the floor; the model
 * is appended only when it is unambiguous for the run, and the run token last
 * so a re-run of the same suite gets its own group dir instead of overwriting
 * the previous run's `experiment.json`.
 */
export function buildTrajectoryGroupSlug(opts: {
  experimentName: string;
  model?: string;
  runToken?: string;
}): string {
  const parts = [opts.experimentName];
  if (opts.model) parts.push(opts.model);
  if (opts.runToken) parts.push(opts.runToken);
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
    process.env.EVAL_TRAJECTORY_ROOT ||
    path.join(process.cwd(), ".trajectories")
  );
}

/** True when `dir` exists and is a directory. Never throws. */
async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Write `<root>/<group>/experiment.json`, cross-linking the local trajectories
 * to the resolved Braintrust experiment (name + hash, id, URLs). The resolved
 * name is only known after `Eval()` finishes, so this is a one-time write from
 * the entrypoint — not per task. Best-effort.
 *
 * The `group` is passed explicitly (same discipline as `reserveTrajectoryDir`)
 * rather than re-derived from env at completion time, so the link always lands
 * on the group the caller actually recorded into.
 *
 * Never leaves behind a `.trajectories/<group>/` tree containing nothing but an
 * `experiment.json`. Two independent guards, because they answer different
 * questions:
 *  - persistence off (or explicitly disabled by the caller, e.g. a core-only
 *    run): nothing will be recorded, so skip without even touching the disk.
 *  - the group dir does not exist: nothing WAS recorded. The dir is created by
 *    the first trajectory reservation, so its absence means no task in this run
 *    persisted one — a core-only run, a legacy run of non-agent categories
 *    (act/extract/combination never construct a TrajectoryRecorder), or a run
 *    whose tasks all failed before persisting. This is the universal backstop:
 *    it holds for any entrypoint without needing a tier signal.
 * Both gates live here — the single choke point — so a caller can't forget them.
 */
export async function writeExperimentLink(
  root: string,
  group: string,
  link: Record<string, unknown>,
  opts?: { persist?: boolean },
): Promise<void> {
  if (!(opts?.persist ?? shouldPersistTrajectory(undefined))) return;
  const dir = path.join(root, group);
  const payload = { ...trajectoryRunMetadata(), ...link };
  if (Object.keys(payload).length === 0) return;
  try {
    // Deliberately NOT mkdir: the dir must already exist (i.e. a trajectory
    // landed in it) for the link to be meaningful.
    if (!(await isDirectory(dir))) return;
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
    // EVAL_MODEL_OVERRIDE is a request; this is the actual model resolved for
    // the run and is stamped by an entrypoint only when it is unambiguous.
    model: process.env[TRAJECTORY_MODEL_ENV],
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
