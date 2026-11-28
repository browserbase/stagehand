import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import type { DeepagentsProcessSpawner } from "@browserbasehq/stagehand-integrations-deepagents-sdk";
import type { ExternalHarnessPrepareInput } from "../../framework/benchHarness.js";
import type { PreparedDeepagentsToolAdapter } from "../../framework/deepagentsToolAdapter.js";
import { EVAL_SYSTEM_PROMPT } from "../../framework/evalSystemPrompt.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import {
  prepareKarpoBrowserToolAdapter,
  runKarpoBrowserAgent,
} from "../../framework/karpoBrowserRunner.js";
import { EvalLogger } from "../../logger.js";

const trajectory = vi.hoisted(() => ({ dir: undefined as string | undefined }));
vi.mock("../../framework/harnesses/externalRunner.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../framework/harnesses/externalRunner.js")>();
  return {
    ...actual,
    runExternalHarnessTask: async (...args: Parameters<typeof actual.runExternalHarnessTask>) => {
      const result = await actual.runExternalHarnessTask(...args);
      return trajectory.dir === undefined ? result : { ...result, trajectoryDir: trajectory.dir };
    },
  };
});

const AGENT = "/opt/karpo-browser/evals/stagehand/agent.sh";
const MODEL = "karpo-browser/controller" as AvailableModel;

const plan: ExternalHarnessTaskPlan = {
  dataset: "hardbenchmark",
  taskId: "hb-1",
  startUrl: "https://example.com/start",
  instruction: "Find the cheapest permit.\nReport the park.",
};

const mcpServers = {
  stagehand: { command: "node", args: ["-e", "relay"], env: { PORT: "4242" } },
};

const INHERITED_ENV = { PATH: "/usr/bin", SYSTEM1_MODEL: "kept" };

function adapter(observed: string[] = []): PreparedDeepagentsToolAdapter {
  return {
    toolSurface: "stagehand_facade",
    startupProfile: "tool_create_browserbase",
    cwd: "/tmp/karpo-browser-runner-test",
    env: INHERITED_ENV,
    promptInstructions: "Use the facade tools.",
    browserSession: {
      provider: "browserbase",
      sessionId: "bb-session-1",
      sessionUrl: "https://www.browserbase.com/sessions/bb-session-1",
    },
    mcpServers,
    recordObservation: () => observed.push("observation"),
    observedToolMatcher: (name) => name.startsWith("stagehand."),
    cleanup: async () => {},
  };
}

function fakeAgent(
  events: Array<Record<string, unknown>>,
  onRequest?: (request: Record<string, unknown>) => void,
) {
  const started: Array<Parameters<DeepagentsProcessSpawner>[0]> = [];
  const requests: Array<Record<string, unknown>> = [];
  const spawn: DeepagentsProcessSpawner = (spec) => {
    started.push(spec);
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let raw = "";
    stdin.on("data", (chunk) => (raw += chunk.toString()));
    stdin.on("finish", () => {
      const request = JSON.parse(raw) as Record<string, unknown>;
      requests.push(request);
      onRequest?.(request);
    });
    queueMicrotask(() => {
      for (const event of events) stdout.write(`${JSON.stringify(event)}\n`);
      stdout.end();
      stderr.end();
    });
    return {
      stdin,
      stdout,
      stderr,
      exited: Promise.resolve({ code: 0, signal: null }),
      kill: () => {},
    };
  };
  return { spawn, started, requests };
}

const UNREPORTED_USAGE = {
  type: "usage",
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
  reported: false,
};

const DONE = {
  type: "final",
  text: 'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"x"}',
};

const RECORD_FILE = "karpo-browser-run.json";
const RECORDED = '{"report":{"success":true,"summary":"finished","finalAnswer":"x"}}';

function writeRecords(request: Record<string, unknown>): void {
  const records = request.records_dir as string;
  fs.mkdirSync(records, { recursive: true });
  fs.writeFileSync(path.join(records, RECORD_FILE), RECORDED);
}

async function runRecording(cwd: string, logger = new EvalLogger(false)) {
  const agent = fakeAgent([DONE, UNREPORTED_USAGE], writeRecords);
  const result = await runKarpoBrowserAgent({
    plan,
    model: MODEL,
    logger,
    toolAdapter: { ...adapter(), cwd },
    spawn: agent.spawn,
    env: { EVAL_KARPO_BROWSER_PATH: AGENT },
  });
  return { agent, result };
}

describe("karpo_browser runner", () => {
  afterEach(() => {
    trajectory.dir = undefined;
  });

  it("starts the agent with the task, the mount, the budget and the row's Browserbase session", async () => {
    const observed: string[] = [];
    const agent = fakeAgent([
      { type: "assistant", text: "CLICK link Permits" },
      { type: "tool_call", id: "1", name: "run", server: "stagehand", args: {} },
      { type: "tool_result", id: "1", name: "run", server: "stagehand", ok: true, text: "ok" },
      {
        type: "final",
        text: 'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"Big Meadows"}',
      },
      UNREPORTED_USAGE,
    ]);
    const toolAdapter = {
      ...adapter(observed),
      env: { ...INHERITED_ENV, BROWSERBASE_SESSION_ID: "inherited" },
    };
    const result = await runKarpoBrowserAgent({
      plan,
      model: MODEL,
      logger: new EvalLogger(false),
      toolAdapter,
      spawn: agent.spawn,
      env: { EVAL_KARPO_BROWSER_PATH: AGENT },
    });

    expect(agent.started).toEqual([
      {
        command: AGENT,
        args: [],
        cwd: "/tmp/karpo-browser-runner-test",
        env: { ...INHERITED_ENV, BROWSERBASE_SESSION_ID: "bb-session-1" },
      },
    ]);
    const [request] = agent.requests;
    expect(request).toMatchObject({
      system_prompt: EVAL_SYSTEM_PROMPT,
      model: "karpo-browser/controller",
      reasoning_summary: null,
      mcp_servers: mcpServers,
      max_tool_steps: 100,
      result_schema: null,
      instruction: plan.instruction,
      start_url: plan.startUrl,
      run_seconds: 2400,
      records_dir: "/tmp/karpo-browser-runner-test/agent-records",
    });
    expect(request?.prompt).toContain(`Start URL: ${plan.startUrl}`);
    expect(request?.prompt).toContain("Use the facade tools.");
    expect(observed).toEqual(["observation"]);
    expect(result).toMatchObject({
      _success: true,
      finalAnswer: "Big Meadows",
      harnessStatus: "completed",
      terminationReason: "completed",
      usageConvention: "unreported",
      harnessConfiguration: { stepBudget: 100, stepBudgetUnit: "tool_calls", runSeconds: 2400 },
    });
  });

  it("takes the budget and the time limit from the environment and reports a budget stop", async () => {
    const agent = fakeAgent([
      {
        type: "error",
        kind: "tool_step_budget",
        message: "tool step budget exhausted (12 steps)",
      },
      {
        type: "final",
        text: 'EVAL_RESULT: {"success":false,"summary":"limit: Stopped after 2 steps.","finalAnswer":null}',
      },
      UNREPORTED_USAGE,
    ]);
    const result = await runKarpoBrowserAgent({
      plan: { ...plan, dataset: "webvoyager" },
      model: MODEL,
      logger: new EvalLogger(false),
      toolAdapter: adapter(),
      spawn: agent.spawn,
      env: {
        EVAL_KARPO_BROWSER_PATH: AGENT,
        EVAL_KARPO_BROWSER_MAX_STEPS: "12",
        EVAL_KARPO_BROWSER_RUN_SECONDS: "300",
      },
    });

    expect(agent.requests[0]).toMatchObject({ max_tool_steps: 12, run_seconds: 300 });
    expect(result).toMatchObject({
      _success: false,
      harnessStatus: "max_turns",
      terminationReason: "step_budget",
      harnessStopReason: "tool step budget exhausted (12 steps)",
      harnessConfiguration: { stepBudget: 12, runSeconds: 300 },
    });
  });

  it("refuses an agent that is not given by an absolute path", async () => {
    for (const env of [{}, { EVAL_KARPO_BROWSER_PATH: "evals/stagehand/agent.sh" }]) {
      const agent = fakeAgent([]);
      await expect(
        runKarpoBrowserAgent({
          plan,
          model: MODEL,
          logger: new EvalLogger(false),
          toolAdapter: adapter(),
          spawn: agent.spawn,
          env,
        }),
      ).rejects.toThrow(/EVAL_KARPO_BROWSER_PATH must be the absolute path of the agent/);
      expect(agent.started).toEqual([]);
    }
  });

  it("refuses a row without a Browserbase session", async () => {
    for (const browserSession of [
      { provider: "local" as const },
      { provider: "browserbase" as const },
    ]) {
      const agent = fakeAgent([]);
      await expect(
        runKarpoBrowserAgent({
          plan,
          model: MODEL,
          logger: new EvalLogger(false),
          toolAdapter: { ...adapter(), browserSession },
          spawn: agent.spawn,
          env: { EVAL_KARPO_BROWSER_PATH: AGENT },
        }),
      ).rejects.toThrow(/needs the row's Browserbase session/);
      expect(agent.started).toEqual([]);
    }
  });

  it("refuses a local browser before mounting anything", async () => {
    const input = {
      environment: "LOCAL",
      plan,
      logger: new EvalLogger(false),
    } as unknown as ExternalHarnessPrepareInput;
    await expect(prepareKarpoBrowserToolAdapter(input)).rejects.toThrow(
      /karpo_browser runs on Browserbase only: use -e browserbase/,
    );
  });

  it("copies the agent's records into the row's trajectory directory, where they outlive its working directory", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "karpo-browser-runner-records-"));
    try {
      const cwd = path.join(root, "work");
      trajectory.dir = path.join(root, "trajectory");
      await fsp.mkdir(cwd);
      await fsp.mkdir(trajectory.dir);
      const { agent, result } = await runRecording(cwd);

      expect(agent.requests[0]?.records_dir).toBe(path.join(cwd, "agent-records"));
      expect(result).toMatchObject({ _success: true, trajectoryDir: trajectory.dir });
      await fsp.rm(cwd, { recursive: true, force: true });
      const kept = path.join(trajectory.dir, "agent", RECORD_FILE);
      expect(await fsp.readFile(kept, "utf8")).toBe(RECORDED);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("copies nothing to a trajectory directory that was not written, and a failed copy fails no row", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "karpo-browser-runner-records-"));
    try {
      const cwd = path.join(root, "work");
      await fsp.mkdir(cwd);
      trajectory.dir = path.join(root, "trajectory");
      const { result } = await runRecording(cwd);
      expect(result).toMatchObject({ _success: true });
      await expect(fsp.stat(trajectory.dir)).rejects.toThrow(/ENOENT/);

      await fsp.mkdir(trajectory.dir);
      await fsp.writeFile(path.join(trajectory.dir, "agent"), "");
      const logger = new EvalLogger(false);
      const failed = await runRecording(cwd, logger);
      expect(failed.result).toMatchObject({ _success: true });
      expect(logger.getLogs().map((line) => line.message)).toContainEqual(
        expect.stringContaining("could not keep the agent's execution records"),
      );
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});
