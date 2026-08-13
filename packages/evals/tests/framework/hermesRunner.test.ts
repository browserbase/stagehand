import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { TaskSpec } from "stagehand-v3";
import {
  PINNED_HERMES_BASE_COMMIT,
  PINNED_STAGEHAND_V4_COMMIT,
  applyHermesSurfaceEnvironment,
  buildHermesPrompt,
  hermesArtifactToTrajectory,
  loadHermesArtifactDirectory,
  resolveHermesStartupProfile,
  resolveHermesToolSurface,
  validateHermesArtifact,
  validatePinnedStagehandV4Root,
  type HermesRunArtifact,
} from "../../framework/hermesRunner.js";

const taskSpec: TaskSpec = {
  id: "om2w-hard-1",
  instruction: "Find the assigned record and submit the requested value.",
  initUrl: "https://example.com/start",
};

describe("Hermes runner", () => {
  it("defaults to browser_exec and keeps Hermes browser ownership explicit", () => {
    expect(resolveHermesToolSurface()).toBe("hermes_browser_exec");
    expect(resolveHermesToolSurface("hermes_browser_legacy")).toBe("hermes_browser_legacy");
    expect(resolveHermesToolSurface("hermes_stagehand_batch")).toBe("hermes_stagehand_batch");
    expect(resolveHermesStartupProfile("hermes_browser_exec", "BROWSERBASE")).toBe(
      "tool_create_browserbase",
    );
    expect(() => resolveHermesStartupProfile("hermes_stagehand_batch", "LOCAL")).toThrow(
      /requires --env browserbase/,
    );
    expect(() => resolveHermesToolSurface("browse_cli")).toThrow(/Hermes harness supports/);
  });

  it("preserves OnlineMind2Web's assigned-site constraint in the prompt", () => {
    const prompt = buildHermesPrompt({
      dataset: "onlineMind2Web",
      taskId: taskSpec.id,
      startUrl: taskSpec.initUrl!,
      instruction: taskSpec.instruction,
    });
    expect(prompt).toBe(
      [
        "You are running a browser benchmark task.",
        "",
        "Dataset: onlineMind2Web",
        `Task ID: ${taskSpec.id}`,
        `Start URL: ${taskSpec.initUrl}`,
        "",
        "Instruction:",
        taskSpec.instruction,
        "",
        "ALWAYS OPERATE WITHIN THE PAGE OPENED BY THE USER, WHICHEVER TASK YOU ARE ATTEMPTING TO COMPLETE CAN BE ACCOMPLISHED WITHIN THE PAGE.",
        "Use only the browser tools provided by this Hermes run. Navigate to the Start URL before working on the task.",
        "Complete the task and put the requested result in your final response.",
      ].join("\n"),
    );
  });

  it("selects the full Browser Use skill for the public browser_exec arm", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
    applyHermesSurfaceEnvironment(env, "hermes_browser_exec", "/tmp/hermes");

    expect(env.HERMES_BENCHMARK_BROWSER_EXEC_ONLY).toBe("1");
    expect(env.HERMES_BENCHMARK_BROWSER_USE_DESCRIPTION).toBe("full");
    expect(env.HERMES_BENCHMARK_STATIC_BROWSER).toBeUndefined();
    expect(env.PATH).toContain("/tmp/hermes/.browser-use-node/node_modules/.bin");
    expect(env.PATH).toContain("/tmp/hermes/.browser-use-venv/bin");

    const legacyEnv: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
    applyHermesSurfaceEnvironment(legacyEnv, "hermes_browser_legacy", "/tmp/hermes");
    expect(legacyEnv.HERMES_BENCHMARK_STATIC_BROWSER).toBe("1");
    expect(legacyEnv.PATH).toContain("/tmp/hermes/.browser-use-node/node_modules/.bin");
  });

  it("accepts only a clean checkout at the pinned Stagehand V4 commit", () => {
    expect(PINNED_HERMES_BASE_COMMIT).toBe("e65664f512ded961ec7b2fdbeb4a88008f439866");
    expect(PINNED_STAGEHAND_V4_COMMIT).toBe("4186c7d98d2f325b6fc85b3f760111e6c390d703");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "stagehand-v4-pin-test-"));
    try {
      const sdkRoot = path.join(root, "packages", "sdk-python");
      fs.mkdirSync(sdkRoot, { recursive: true });
      fs.writeFileSync(path.join(sdkRoot, "README.md"), "pinned SDK\n", "utf8");
      execFileSync("git", ["init", "--quiet", root]);
      execFileSync("git", ["-C", root, "add", "."]);
      execFileSync("git", [
        "-C",
        root,
        "-c",
        "user.name=Stagehand Evals",
        "-c",
        "user.email=evals@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      ]);
      const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim();

      expect(validatePinnedStagehandV4Root(root, head)).toBe(root);
      expect(() =>
        validatePinnedStagehandV4Root(root, "0000000000000000000000000000000000000000"),
      ).toThrow(/expected pinned commit/);

      fs.writeFileSync(path.join(sdkRoot, "README.md"), "dirty SDK\n", "utf8");
      expect(() => validatePinnedStagehandV4Root(root, head)).toThrow(/local changes/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("converts Hermes state rows into evidence-backed Stagehand trajectory steps", () => {
    const screenshot = Buffer.from("fake-png");
    const artifact: HermesRunArtifact = {
      surface: "hermes_browser_exec",
      stdout: "record saved",
      stderr: "",
      exitCode: 0,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_tokens: 30,
        cache_write_tokens: 0,
        reasoning_tokens: 5,
        api_calls: 2,
        session_id: "session-1",
        completed: true,
      },
      toolCallCount: 1,
      innerUsage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        reasoning_tokens: 0,
        api_calls: 0,
      },
      messages: [
        {
          id: 1,
          role: "assistant",
          content: "I will inspect and submit the assigned record.",
          tool_call_id: null,
          tool_calls: JSON.stringify([
            {
              id: "call-1",
              function: {
                name: "browser_exec",
                arguments: JSON.stringify({ code: "open(startUrl); submit('value')" }),
              },
            },
          ]),
          tool_name: null,
          reasoning: "Use the assigned page.",
          reasoning_content: null,
        },
        {
          id: 2,
          role: "tool",
          content:
            '<untrusted_tool_result source="browser_exec">\nmetadata\n\n{"success":true,"output":{"saved":true}}\n</untrusted_tool_result>',
          tool_call_id: "call-1",
          tool_calls: null,
          tool_name: "browser_exec",
          reasoning: null,
          reasoning_content: null,
        },
        {
          id: 3,
          role: "assistant",
          content: "record saved",
          tool_call_id: null,
          tool_calls: null,
          tool_name: null,
          reasoning: null,
          reasoning_content: null,
        },
      ],
      stepObservations: [{ screenshot, url: "https://example.com/done" }],
      toolSchema: { bytes: 10_387, names: ["browser_exec"] },
      toolMetrics: [{ success: true, duration_ms: 12 }],
      finalObservation: { screenshot, url: "https://example.com/done" },
    };

    expect(() => validateHermesArtifact(artifact)).not.toThrow();
    expect(() =>
      validateHermesArtifact({
        ...artifact,
        surface: "hermes_stagehand_batch",
        toolSchema: { bytes: 10_461, names: ["browser_exec"] },
      }),
    ).not.toThrow();
    expect(() =>
      validateHermesArtifact({
        ...artifact,
        surface: "hermes_stagehand_batch",
        toolSchema: { bytes: 1_794, names: ["browser_exec"] },
      }),
    ).toThrow(/schema drifted/);
    expect(() =>
      validateHermesArtifact({ ...artifact, stepObservations: [] }),
    ).toThrow(/independently captured/);
    expect(() => validateHermesArtifact({ ...artifact, toolCallCount: 2 })).toThrow(
      /disagrees/,
    );
    expect(() =>
      validateHermesArtifact({
        ...artifact,
        stepObservations: [],
        toolMetrics: [{ success: false, duration_ms: 12 }],
      }),
    ).not.toThrow();

    const trajectory = hermesArtifactToTrajectory(artifact, taskSpec);
    expect(trajectory.task).toBe(taskSpec);
    expect(trajectory.status).toBe("complete");
    expect(trajectory.finalAnswer).toBe("record saved");
    expect(trajectory.finalObservation?.url).toBe("https://example.com/done");
    expect(trajectory.steps).toHaveLength(1);
    expect(trajectory.steps[0].actionName).toBe("browser_exec");
    expect(trajectory.steps[0].probeEvidence?.url).toBe("https://example.com/done");
    expect(trajectory.usage).toMatchObject({
      input_tokens: 100,
      output_tokens: 20,
      cached_input_tokens: 30,
      reasoning_tokens: 5,
    });
  });

  it("loads a completed retained artifact without launching Hermes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-retained-artifact-test-"));
    try {
      const hermesHome = path.join(root, "hermes-home");
      const evidenceDir = path.join(root, "evidence");
      const stepsDir = path.join(evidenceDir, "steps");
      fs.mkdirSync(hermesHome, { recursive: true });
      fs.mkdirSync(stepsDir, { recursive: true });
      fs.writeFileSync(
        path.join(root, "usage.json"),
        JSON.stringify({
          input_tokens: 10,
          output_tokens: 2,
          cache_read_tokens: 3,
          cache_write_tokens: 0,
          reasoning_tokens: 1,
          api_calls: 2,
          session_id: "session-1",
          completed: true,
          failed: false,
        }),
      );
      fs.writeFileSync(path.join(evidenceDir, "screenshot.png"), "final-shot");
      fs.writeFileSync(path.join(evidenceDir, "final-url.txt"), "https://example.com/done\n");
      fs.writeFileSync(path.join(stepsDir, "step-0001.png"), "step-shot");
      fs.writeFileSync(
        path.join(stepsDir, "step-0001.json"),
        JSON.stringify({
          action_index: 1,
          screenshot: "step-0001.png",
          final_url: "https://example.com/done",
        }),
      );

      const database = new DatabaseSync(path.join(hermesHome, "state.db"));
      database.exec(
        "CREATE TABLE sessions (id TEXT PRIMARY KEY, tool_call_count INTEGER, started_at TEXT);" +
          "CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, reasoning TEXT, reasoning_content TEXT);",
      );
      database
        .prepare("INSERT INTO sessions (id, tool_call_count, started_at) VALUES (?, ?, ?)")
        .run("session-1", 1, "2026-08-12T00:00:00Z");
      database
        .prepare(
          "INSERT INTO messages (id, session_id, role, content, tool_call_id, tool_calls, tool_name, reasoning, reasoning_content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          1,
          "session-1",
          "assistant",
          null,
          null,
          JSON.stringify([
            {
              id: "call-1",
              function: { name: "browser_exec", arguments: JSON.stringify({ code: "done()" }) },
            },
          ]),
          null,
          null,
          null,
        );
      database
        .prepare(
          "INSERT INTO messages (id, session_id, role, content, tool_call_id, tool_calls, tool_name, reasoning, reasoning_content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          2,
          "session-1",
          "tool",
          '{"success":true}',
          "call-1",
          null,
          "browser_exec",
          null,
          null,
        );
      database
        .prepare(
          "INSERT INTO messages (id, session_id, role, content, tool_call_id, tool_calls, tool_name, reasoning, reasoning_content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(3, "session-1", "assistant", "complete", null, null, null, null, null);
      database.close();

      const artifact = await loadHermesArtifactDirectory(root, "hermes_stagehand_batch");
      expect(artifact.exitCode).toBe(0);
      expect(artifact.toolCallCount).toBe(1);
      expect(artifact.messages).toHaveLength(3);
      expect(artifact.finalObservation?.url).toBe("https://example.com/done");
      expect(artifact.stepObservations?.filter(Boolean)).toHaveLength(1);
      expect(artifact.artifactDir).toBe(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
