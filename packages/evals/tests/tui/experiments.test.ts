import { EventEmitter } from "node:events";
import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("../../lib/braintrust-report.js", () => ({
  resolveExperimentProjectsAcrossProjects: async (
    _projects: string[],
    inputs: Array<{ experiment: string }>,
  ) =>
    inputs.map((input, index) => ({
      projectName: index === 0 ? "stagehand-dev" : "stagehand-core-dev",
      experimentId: `id-${index}`,
      experimentName: input.experiment,
    })),
  resolveExperimentAcrossProjects: vi.fn(),
  listRecentExperiments: vi.fn(),
  benchCaseDiffs: (): unknown[] => [],
  collectExperimentMetrics: (): unknown[] => [],
  detectCompareMode: () => "core",
  findLeaderIndex: () => 0,
  sharedMetricKeys: (): string[] => [],
  sharedBenchCaseKeys: (): string[] => [],
  sharedTaskNames: (): string[] => [],
  summarizeBenchAgentConfigs: (): unknown[] => [],
}));

import { handleExperiments } from "../../tui/commands/experiments.js";

const DEFAULT_REPORT = "/tmp/stagehand-evals-braintrust-report.html";
const DEFAULT_DATA = "/tmp/stagehand-evals-braintrust-report.json";

function makeChildProcess(args: string[]): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  const outIndex = args.indexOf("--out");
  const outputPath = outIndex >= 0 ? args[outIndex + 1] : DEFAULT_REPORT;
  const dataPath = outputPath.replace(/\.html?$/i, ".json");
  fs.writeFileSync(
    dataPath,
    JSON.stringify([
      {
        label: "all-5afdff86",
        projectName: "stagehand-dev",
        experimentName: "all-5afdff86",
        experimentId: "id-0",
        experimentUrl: "https://braintrust.example/a",
        mode: "core",
        passScore: 1,
        passedTasks: 1,
        totalTasks: 1,
        durationSeconds: 1,
        taskMetrics: {},
        tasks: [],
        benchCases: [],
      },
      {
        label: "all-80219877",
        projectName: "stagehand-core-dev",
        experimentName: "all-80219877",
        experimentId: "id-1",
        experimentUrl: "https://braintrust.example/b",
        mode: "core",
        passScore: 0.5,
        passedTasks: 1,
        totalTasks: 2,
        durationSeconds: 2,
        taskMetrics: {},
        tasks: [],
        benchCases: [],
      },
    ]),
  );

  setImmediate(() => {
    child.emit("close", 0);
  });
  return child;
}

describe("experiments compare", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(DEFAULT_DATA, { force: true });
  });

  it("passes the headless default output path to the renderer", async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) =>
      makeChildProcess(args),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleExperiments([
      "compare",
      "all-5afdff86",
      "all-80219877",
      "--headless",
    ]);

    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).toContain("--out");
    expect(args[args.indexOf("--out") + 1]).toBe(DEFAULT_REPORT);
    expect(args).toContain("--project-map");

    const payload = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
    expect(payload.ok).toBe(true);
    expect(payload.dataPath).toBe(DEFAULT_DATA);
  });
});
