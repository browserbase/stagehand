import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildTrajectoryGroupSlug,
  generateRunToken,
  resolveTrajectoryGroup,
  resolveUnambiguousModel,
  sanitizeSlug,
  writeExperimentLink,
} from "../../framework/trajectoryGroup.js";

const tempDirs: string[] = [];
const persistEnv = process.env.VERIFIER_PERSIST_TRAJECTORIES;

afterEach(async () => {
  delete process.env.EVAL_TRAJECTORY_GROUP;
  delete process.env.EVAL_EXPERIMENT_NAME;
  delete process.env.EVAL_MODEL_OVERRIDE;
  delete process.env.EVAL_TRAJECTORY_MODEL;
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

describe("sanitizeSlug", () => {
  it("keeps ordinary values and collapses separators", () => {
    expect(sanitizeSlug("agent/onlineMind2Web")).toBe("agent_onlineMind2Web");
    expect(sanitizeSlug("openai/gpt-4.1-mini")).toBe("openai_gpt-4.1-mini");
    // Dots are legal INSIDE a name — only pure-dot components are path-special.
    expect(sanitizeSlug("gpt-4.1")).toBe("gpt-4.1");
  });

  it("rejects path-special pure-dot values so a group can't escape the root", () => {
    // ".." writes above the root; "." collapses the group into it.
    for (const raw of ["..", ".", "...", "__..__", " .. "]) {
      expect(sanitizeSlug(raw)).toBe("");
    }
    // Traversal with separators is already neutralized by the whitelist.
    expect(sanitizeSlug("../../etc")).toBe(".._.._etc");
  });

  it("falls back to the default group rather than a path-special one", () => {
    process.env.EVAL_TRAJECTORY_GROUP = "..";
    expect(resolveTrajectoryGroup()).toBe("default");
    process.env.EVAL_TRAJECTORY_GROUP = ".";
    expect(resolveTrajectoryGroup()).toBe("default");
  });
});

describe("generateRunToken", () => {
  it("produces an exact compact, sortable, filesystem-safe token", () => {
    const token = generateRunToken(new Date(2026, 6, 15, 11, 3, 42), "9f3a1c");
    expect(token).toBe("20260715-110342-9f3a1c");
    expect(token).toMatch(/^\d{8}-\d{6}-[a-f0-9]{6}$/);
    expect(token).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("sorts lexicographically in chronological order", () => {
    const earlier = generateRunToken(
      new Date(2026, 6, 15, 11, 3, 42),
      "ffffff",
    );
    const later = generateRunToken(new Date(2026, 6, 15, 11, 3, 43), "000000");
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });

  it("gives concurrent runs started in the same second different tokens", () => {
    const now = new Date(2026, 6, 15, 11, 3, 42);
    expect(generateRunToken(now)).not.toBe(generateRunToken(now));
  });

  it("uses 64 bits of real entropy, not just enough to look random", () => {
    // The tests above inject entropy, so they'd pass even if the default shrank.
    const now = new Date(2026, 6, 15, 11, 3, 42);
    expect(generateRunToken(now)).toMatch(/^\d{8}-\d{6}-[a-f0-9]{16}$/);

    // And it must actually be distributed, not a constant or a counter.
    const tokens = new Set(
      Array.from({ length: 200 }, () => generateRunToken(now)),
    );
    expect(tokens.size).toBe(200);
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

  it("appends a sanitized model without a run token", () => {
    expect(
      buildTrajectoryGroupSlug({
        experimentName: "agent",
        model: "openai/gpt-4.1-mini",
      }),
    ).toBe("agent__openai_gpt-4.1-mini");
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

describe("resolveUnambiguousModel", () => {
  it("returns one model", () => {
    expect(resolveUnambiguousModel(["openai/gpt-4.1-mini"])).toBe(
      "openai/gpt-4.1-mini",
    );
  });

  it("omits two distinct models", () => {
    expect(
      resolveUnambiguousModel([
        "openai/gpt-4.1-mini",
        "google/gemini-2.5-flash",
      ]),
    ).toBeUndefined();
  });

  it("omits a core-only model list", () => {
    // A single "none" is the real core-only shape, and the only input that proves
    // the sentinel filter exists: 2+ elements return undefined from the size check
    // alone, filtered or not.
    expect(resolveUnambiguousModel(["none"])).toBeUndefined();
    expect(resolveUnambiguousModel(["none", "NONE", " none "])).toBeUndefined();
  });

  it("omits an empty model list", () => {
    expect(resolveUnambiguousModel([])).toBeUndefined();
  });

  it("returns the only distinct model when duplicated", () => {
    expect(
      resolveUnambiguousModel(["openai/gpt-4.1-mini", "openai/gpt-4.1-mini"]),
    ).toBe("openai/gpt-4.1-mini");
  });

  it("ignores core sentinels beside one real model", () => {
    expect(
      resolveUnambiguousModel(["none", "openai/gpt-4.1-mini", " NONE "]),
    ).toBe("openai/gpt-4.1-mini");
  });
});

describe("writeExperimentLink", () => {
  /**
   * Simulate a task having persisted a trajectory into `group`. The link only lands
   * in a group that recorded something, so positive cases must establish that
   * precondition the way a real reservation does.
   */
  async function recordTrajectory(
    root: string,
    group: string,
  ): Promise<string> {
    await fs.mkdir(path.join(root, group, "task-1", "run-1"), {
      recursive: true,
    });
    return group;
  }

  it("writes experiment.json under the explicitly passed group, not the env one", async () => {
    process.env.VERIFIER_PERSIST_TRAJECTORIES = "1";
    process.env.EVAL_TRAJECTORY_GROUP = "some-other-group";
    const root = await makeTempDir();
    const group = await recordTrajectory(root, "agent__20260715-110342");

    await writeExperimentLink(root, group, {
      braintrustExperiment: "agent/onlineMind2Web-92918006",
    });

    await expect(fs.readdir(root)).resolves.toEqual(["agent__20260715-110342"]);
    await expect(
      readJson(path.join(root, group, "experiment.json")),
    ).resolves.toMatchObject({
      braintrustExperiment: "agent/onlineMind2Web-92918006",
    });
  });

  it("merges run metadata from env into the payload", async () => {
    process.env.VERIFIER_PERSIST_TRAJECTORIES = "1";
    process.env.EVAL_EXPERIMENT_NAME = "agent";
    process.env.EVAL_TRAJECTORY_MODEL = "openai/gpt-4.1-mini";
    const root = await makeTempDir();
    await recordTrajectory(root, "group-1");

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
    process.env.VERIFIER_PERSIST_TRAJECTORIES = "1";
    const root = await makeTempDir();
    // Trajectories present, but the caller says persistence is off: still no link.
    await recordTrajectory(root, "group-1");

    await writeExperimentLink(
      root,
      "group-1",
      { braintrustExperimentId: "x" },
      { persist: false },
    );

    await expect(fs.readdir(path.join(root, "group-1"))).resolves.toEqual([
      "task-1",
    ]);
  });

  it("skips a group that recorded no trajectory instead of leaving an empty tree", async () => {
    // Core-only / non-agent categories: persistence on, but nothing recorded — so
    // no group dir, and the link must not create one to hold an orphan.
    process.env.VERIFIER_PERSIST_TRAJECTORIES = "1";
    const root = await makeTempDir();

    await writeExperimentLink(root, "group-1", { braintrustExperimentId: "x" });

    await expect(fs.readdir(root)).resolves.toEqual([]);
  });

  it("writes when persistence is explicitly enabled", async () => {
    process.env.VERIFIER_PERSIST_TRAJECTORIES = "0";
    const root = await makeTempDir();
    await recordTrajectory(root, "group-1");

    await writeExperimentLink(
      root,
      "group-1",
      { braintrustExperimentId: "x" },
      { persist: true },
    );

    await expect(
      fs.readdir(path.join(root, "group-1")).then((d) => d.sort()),
    ).resolves.toEqual(["experiment.json", "task-1"]);
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

    const firstGroup = await recordTrajectory(
      root,
      groupFor("20260715-110342"),
    );
    const secondGroup = await recordTrajectory(
      root,
      groupFor("20260715-114500"),
    );
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

  it("does not treat a requested model as resolved run metadata", async () => {
    process.env.VERIFIER_PERSIST_TRAJECTORIES = "1";
    process.env.EVAL_MODEL_OVERRIDE = "openai/gpt-4.1-mini";
    delete process.env.EVAL_TRAJECTORY_MODEL;
    const root = await makeTempDir();
    await recordTrajectory(root, "group-1");

    await writeExperimentLink(root, "group-1", { braintrustExperimentId: "x" });

    await expect(
      readJson(path.join(root, "group-1", "experiment.json")),
    ).resolves.not.toHaveProperty("model");
  });
});
