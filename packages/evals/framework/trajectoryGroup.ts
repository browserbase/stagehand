import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { shouldPersistTrajectory } from "stagehand-v3";

const GROUP_ENV = "EVAL_TRAJECTORY_GROUP";
const EXPERIMENT_ENV = "EVAL_EXPERIMENT_NAME";
const TRAJECTORY_MODEL_ENV = "EVAL_TRAJECTORY_MODEL";
const PROVIDER_ENV = "EVAL_PROVIDER";
const ENVIRONMENT_ENV = "EVAL_ENV";

export function sanitizeSlug(value: string): string {
  const slug = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^\.+$/.test(slug) ? "" : slug;
}

const RUN_TOKEN_ENTROPY_BYTES = 8;

export function generateRunToken(
  now: Date = new Date(),
  entropy: string = randomBytes(RUN_TOKEN_ENTROPY_BYTES).toString("hex"),
): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${date}-${time}-${entropy}`;
}

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

export function resolveTrajectoryGroup(): string {
  const raw = process.env[GROUP_ENV];
  return (raw ? sanitizeSlug(raw) : "") || "default";
}

export function resolveTrajectoryGroupDir(root: string): string {
  return path.join(root, resolveTrajectoryGroup());
}

export function resolveTrajectoryDir(
  root: string,
  taskId: string,
  runId: string,
  group: string = resolveTrajectoryGroup(),
): string {
  return path.join(root, group, taskId, runId);
}

export async function reserveTrajectoryDir(
  root: string,
  taskId: string,
  runId: string,
  group?: string,
): Promise<{ directory: string; attempt: number }> {
  const base = resolveTrajectoryDir(root, taskId, runId, group);
  await fs.mkdir(path.dirname(base), { recursive: true });
  const MAX_ATTEMPTS = 10_000;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`;
    try {
      await fs.mkdir(candidate);
      return { directory: candidate, attempt };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new Error(`reserveTrajectoryDir: exhausted ${MAX_ATTEMPTS} attempts for ${base}`);
}

export function resolveTrajectoryRoot(): string {
  return process.env.EVAL_TRAJECTORY_ROOT || path.join(process.cwd(), ".trajectories");
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

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
    if (!(await isDirectory(dir))) return;
    await fs.writeFile(path.join(dir, "experiment.json"), JSON.stringify(payload, null, 2));
  } catch {}
}

export function trajectoryRunMetadata(): Record<string, string> {
  const fields: Record<string, string | undefined> = {
    experiment: process.env[EXPERIMENT_ENV],
    model: process.env[TRAJECTORY_MODEL_ENV],
    provider: process.env[PROVIDER_ENV],
    environment: process.env[ENVIRONMENT_ENV],
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) if (v) out[k] = v;
  return out;
}

export async function writeTrajectoryMetadata(
  directory: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const meta = { ...trajectoryRunMetadata(), ...extra };
  if (Object.keys(meta).length === 0) return;
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "metadata.json"), JSON.stringify(meta, null, 2));
  } catch {}
}
