import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { REDACTED_INLINE_IMAGE } from "../src/evidenceNormalization.js";
import { loadTrajectoryFromDisk, normalizeRubric, writeTrajectoryDir } from "../src/trajectory.js";
import type { Trajectory } from "../src/types.js";

const tmpDirs: string[] = [];
async function tmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evaluator-trajectory-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

const trajectory = (result: unknown, bytes?: Buffer): Trajectory => ({
  task: { id: "t", instruction: "Look" },
  steps: [
    {
      actionName: "screenshot",
      actionArgs: {},
      reasoning: "",
      agentEvidence: {
        modalities: bytes ? [{ type: "image", bytes, mediaType: "image/png" }] : [],
      },
      probeEvidence: {},
      toolOutput: { ok: true, result },
    },
  ],
  status: "complete",
  usage: { input_tokens: 0, output_tokens: 0 },
});

test("rejects symlinked screenshots that resolve outside the trajectory dir", async () => {
  const root = await tmpDir();
  const dir = path.join(root, "traj");
  await writeTrajectoryDir(dir, trajectory("ok"));
  await fs.writeFile(path.join(root, "secret.png"), "secret");
  await fs.symlink(path.join(root, "secret.png"), path.join(dir, "screenshots/probe/1.png"));
  const raw = JSON.parse(await fs.readFile(path.join(dir, "trajectory.json"), "utf8"));
  raw.steps[0].probeEvidence.screenshotPath = "screenshots/probe/1.png";
  await fs.writeFile(path.join(dir, "trajectory.json"), JSON.stringify(raw));

  await expect(loadTrajectoryFromDisk(dir)).rejects.toThrow(/escapes trajectory directory/);
});

test("follows symlinks that stay inside the trajectory dir and skips missing files", async () => {
  const dir = await tmpDir();
  await writeTrajectoryDir(dir, trajectory("ok"));
  await fs.writeFile(path.join(dir, "screenshots/probe/real.png"), "inside");
  await fs.symlink("real.png", path.join(dir, "screenshots/probe/1.png"));
  const raw = JSON.parse(await fs.readFile(path.join(dir, "trajectory.json"), "utf8"));
  raw.steps[0].probeEvidence.screenshotPath = "screenshots/probe/1.png";
  raw.finalObservation = { screenshotPath: "screenshots/probe/missing.png" };
  await fs.writeFile(path.join(dir, "trajectory.json"), JSON.stringify(raw));

  const loaded = await loadTrajectoryFromDisk(dir);
  expect(loaded.steps[0].probeEvidence.screenshot?.toString()).toBe("inside");
  expect(loaded.finalObservation?.screenshot).toBeUndefined();
});

test("Buffer tool results are not inlined as byte arrays on disk", async () => {
  const dir = await tmpDir();
  const png = Buffer.from("png-bytes");
  await writeTrajectoryDir(dir, trajectory(png, png));
  const raw = JSON.parse(await fs.readFile(path.join(dir, "trajectory.json"), "utf8"));
  expect(raw.steps[0].toolOutput.result).toBe(REDACTED_INLINE_IMAGE);
  expect(raw.steps[0].agentEvidence.modalities[0].imagePath).toBe("screenshots/agent/1.png");
});

test.each([0, -1])("rejects non-positive maxPoints (%s)", (maxPoints) => {
  expect(() =>
    normalizeRubric({ items: [{ criterion: "c", description: "d", maxPoints }] }),
  ).toThrow(/positive maxPoints/);
});
