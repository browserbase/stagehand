import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildTrajectoryGroupSlug,
  generateRunToken,
  writeExperimentLink,
} from "../../framework/trajectoryGroup.js";

const tempDirs: string[] = [];
const persistEnv = process.env.VERIFIER_PERSIST_TRAJECTORIES;

afterEach(async () => {
  delete process.env.EVAL_TRAJECTORY_GROUP;
  delete process.env.EVAL_EXPERIMENT_NAME;
  delete process.env.EVAL_MODEL_OVERRIDE;
  if (persistEnv === undefined)
    delete process.env.VERIFIER_PERSIST_TRAJECTORIES;
  else process.env.VERIFIER_PERSIST_TRAJECTORIES = persistEnv;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "trajectory-group-")).then((dir) => {
    tempDirs.push(dir);
    return dir;
  });
}

function readJson(file: string): Promise<Record<string, unknown>> {
  return fs.readFile(file, "utf8").then((raw) => JSON.parse(raw));
}

describe("generateRunToken", () => {
  it("produces a compact, sortable, filesystem-safe token", () => {
    const token = generateRunToken(new Date(2026, 6, 15, 11, 3, 42));
    expect(token).toBe("20260715-110342");
    expect(token).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("sorts lexicographically in chronological order", () => {
    const earlier = generateRunToken(new Date(2026, 6, 15, 11, 3, 42));
    const later = generateRunToken(new Date(2026, 6, 15, 11, 3, 43));
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });
});

describe("buildTrajectoryGroupSlug", () => {
  it("appends the run token as the last part", () => {
    expect(
      buildTrajectoryGroupSlug({
        experimentName: "agent",
        model: "openai/gpt-4.1-mini",
        runToken: "20260715-110342",
      }),
    ).toBe("agent__openai_gpt-4.1-mini__20260715-110342");
  });

  it("drops empty parts (no model, no run token)", () => {
    expect(buildTrajectoryGroupSlug({ experimentName: "all" })).toBe("all");
    expect(
      buildTrajectoryGroupSlug({
        experimentName: "all",
        runToken: "20260715-110342",
      }),
    ).toBe("all__20260715-110342");
  });

  it("gives different groups to two runs of the same experiment+model", () => {
    const opts = { experimentName: "agent", model: "openai/gpt-4.1-mini" };
    const first = buildTrajectoryGroupSlug({
      ...opts,
      runToken: "20260715-110342",
    });
    const second = buildTrajectoryGroupSlug({
      ...opts,
      runToken: "20260715-114500",
    });
    // The anti-clobber property: a re-run cannot land on the earlier run's dir.
    expect(first).not.toBe(second);
  });
});

describe("writeExperimentLink", () => {
  it("writes experiment.json under the explicitly passed group, not the env one", async () => {
    process.env.VERIFIER_PERSIST_TRAJECTORIES = "1";
    process.env.EVAL_TRAJECTORY_GROUP = "some-other-group";
    const root = await makeTempDir();

    await writeExperimentLink(root, "agent__20260715-110342", {
      braintrustExperiment: "agent/onlineMind2Web-92918006",
    });

    await expect(fs.readdir(root)).resolves.toEqual(["agent__20260715-110342"]);
    await expect(
      readJson(path.join(root, "agent__20260715-110342", "experiment.json")),
    ).resolves.toMatchObject({
      braintrustExperiment: "agent/onlineMind2Web-92918006",
    });
  });

  it("merges run metadata from env into the payload", async () => {
    process.env.VERIFIER_PERSIST_TRAJECTORIES = "1";
    process.env.EVAL_EXPERIMENT_NAME = "agent";
    process.env.EVAL_MODEL_OVERRIDE = "openai/gpt-4.1-mini";
    const root = await makeTempDir();

    await writeExperimentLink(root, "group-1", { braintrustExperimentId: "x" });

    await expect(
      readJson(path.join(root, "group-1", "experiment.json")),
    ).resolves.toMatchObject({
      experiment: "agent",
      model: "openai/gpt-4.1-mini",
      braintrustExperimentId: "x",
    });
  });

  it("is a no-op when trajectory persistence is disabled", async () => {
    process.env.VERIFIER_PERSIST_TRAJECTORIES = "0";
    const root = await makeTempDir();

    await writeExperimentLink(root, "group-1", { braintrustExperimentId: "x" });

    await expect(fs.readdir(root)).resolves.toEqual([]);
  });

  it("writes when persistence is explicitly enabled", async () => {
    process.env.VERIFIER_PERSIST_TRAJECTORIES = "1";
    const root = await makeTempDir();

    await writeExperimentLink(root, "group-1", { braintrustExperimentId: "x" });

    await expect(fs.readdir(path.join(root, "group-1"))).resolves.toEqual([
      "experiment.json",
    ]);
  });

  it("keeps a separate experiment.json per run token (no clobber)", async () => {
    process.env.VERIFIER_PERSIST_TRAJECTORIES = "1";
    const root = await makeTempDir();
    const groupFor = (runToken: string) =>
      buildTrajectoryGroupSlug({
        experimentName: "agent",
        model: "openai/gpt-4.1-mini",
        runToken,
      });

    const firstGroup = groupFor("20260715-110342");
    const secondGroup = groupFor("20260715-114500");
    await writeExperimentLink(root, firstGroup, {
      braintrustExperimentId: "first",
    });
    await writeExperimentLink(root, secondGroup, {
      braintrustExperimentId: "second",
    });

    await expect(fs.readdir(root).then((d) => d.sort())).resolves.toEqual(
      [firstGroup, secondGroup].sort(),
    );
    await expect(
      readJson(path.join(root, firstGroup, "experiment.json")),
    ).resolves.toMatchObject({ braintrustExperimentId: "first" });
    await expect(
      readJson(path.join(root, secondGroup, "experiment.json")),
    ).resolves.toMatchObject({ braintrustExperimentId: "second" });
  });
});
