import { mkdir, open, rename } from "node:fs/promises";
import { resolve } from "node:path";
import lockfile from "proper-lockfile";

export const directory = resolve(process.env.STATE_DIR ?? "out/run");

export async function saveJson(path: string, value: unknown) {
  const temporary = `${path}.tmp`;
  const file = await open(temporary, "w", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
}

export async function exclusive<T>(run: () => Promise<T>): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // A killed process leaves its lock behind until the stale interval passes.
  const release = await lockfile.lock(directory, {
    stale: 30_000,
    update: 10_000,
    retries: { retries: 35, factor: 1, minTimeout: 1000, maxTimeout: 1000, randomize: false },
  });
  try {
    return await run();
  } finally {
    await release();
  }
}

export function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const command = process.argv[2] ?? "start";
export const decisionId = process.argv[3];

export function checkCommand() {
  if (!["start", "resume", "status", "return", "approve", "reject", "cleanup"].includes(command)) {
    throw new Error(
      "Use start, resume, status, return <id>, approve <id>, reject <id>, or cleanup",
    );
  }
}
