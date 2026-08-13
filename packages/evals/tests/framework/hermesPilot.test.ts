import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  hermesPilotVerifierSucceeded,
  readValidVerifierSidecar,
  resolveEffectiveHermesPilotRecord,
  summarizeHermesPilotRecords,
  type HermesPilotRecordContext,
} from "../../framework/hermesPilotReporting.js";
import { getPackageRootDir } from "../../runtimePaths.js";

interface Mind2WebRow {
  task_id: string;
  level: string;
  website: string;
}

describe("Hermes OnlineMind2Web hard pilot", () => {
  it("requires zero evidence-insufficient criteria for a benchmark pass", () => {
    expect(
      hermesPilotVerifierSucceeded(
        { outcome: true, process_score: 1, evidence_insufficient_count: 0 },
        "both",
      ),
    ).toBe(true);
    expect(
      hermesPilotVerifierSucceeded(
        { outcome: true, process_score: 1, evidence_insufficient_count: 1 },
        "both",
      ),
    ).toBe(false);
  });

  it("freezes ten curated hard tasks across unique hosts and a balanced model split", () => {
    const packageRoot = getPackageRootDir();
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(packageRoot, "pilots", "hermes-online-mind2web-hard-v1.json"),
        "utf8",
      ),
    ) as {
      selection: { count: number };
      task_ids: string[];
      arms: Array<{ tool: string }>;
      task_model_pairs: Array<{ task_id: string; model: string }>;
      verifier_model: string;
      verifier_selection: {
        methodology_target: string;
        methodology_target_status: string;
        selected_fallback: string;
      };
      rubric_policy: string;
      success_mode: string;
      timeout_seconds: number;
      dataset_file_sha256: string;
      run_plan: Array<{ task_id: string; model: string; arm_order: string[] }>;
      canary_plan: { task_id: string; model: string; arm_order: string[] };
    };
    const rows = fs
      .readFileSync(
        path.join(packageRoot, "datasets", "onlineMind2Web", "onlineMind2Web.jsonl"),
        "utf8",
      )
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as Mind2WebRow);
    const byId = new Map(rows.map((row) => [row.task_id, row]));
    const selected = manifest.task_ids
      .map((id) => byId.get(id))
      .filter((row): row is Mind2WebRow => Boolean(row));

    expect(manifest.task_ids).toHaveLength(10);
    expect(selected.map((row) => row.task_id)).toEqual(manifest.task_ids);
    expect(new Set(selected.map((row) => new URL(row.website).hostname)).size).toBe(10);
    expect(selected.every((row) => row.level === "hard")).toBe(true);
    expect(manifest.arms.map((arm) => arm.tool)).toEqual([
      "hermes_browser_legacy",
      "hermes_browser_exec",
      "hermes_stagehand_batch",
    ]);
    expect(manifest.task_model_pairs.map((pair) => pair.task_id)).toEqual(manifest.task_ids);
    expect(manifest.task_model_pairs.filter((pair) => pair.model.includes("opus"))).toHaveLength(5);
    expect(manifest.task_model_pairs.filter((pair) => pair.model.includes("kimi"))).toHaveLength(5);
    expect(manifest.verifier_model).toBe("gateway/google/gemini-2.5-flash");
    expect(manifest.verifier_selection).toMatchObject({
      methodology_target: "gateway/openai/o4-mini",
      methodology_target_status: "unavailable_through_vercel_ai_gateway",
      selected_fallback: "gateway/google/gemini-2.5-flash",
    });
    expect(manifest.rubric_policy).toContain("reuse byte-identical cached rubric");
    expect(manifest.success_mode).toBe("both");
    expect(manifest.timeout_seconds).toBe(1800);
    expect(manifest.dataset_file_sha256).toBe(
      "d10a837d6ea67349dca8541cd697eb2636ff61b937ba0f09596f775e1b327b30",
    );
    expect(manifest.run_plan).toHaveLength(10);
    expect(manifest.run_plan.map((row) => row.task_id)).toEqual(manifest.task_ids);
    expect(manifest.run_plan.flatMap((row) => row.arm_order)).toHaveLength(30);
    expect(manifest.run_plan.map((row) => row.arm_order.join(""))).toEqual([
      "ABD",
      "BDA",
      "DAB",
      "ABD",
      "BDA",
      "DAB",
      "ABD",
      "BDA",
      "DAB",
      "ABD",
    ]);
    expect(manifest.canary_plan.arm_order).toEqual(["A", "B", "D"]);

    const instructions = fs.readFileSync(path.join(packageRoot, "HERMES_PILOT.md"), "utf8");
    expect(instructions).not.toContain(" eval -- run ");
    expect(
      instructions.match(/pnpm --filter @browserbasehq\/stagehand-evals eval run/g),
    ).toHaveLength(1);
    expect(
      instructions.match(
        /pnpm --filter @browserbasehq\/stagehand-evals benchmark:hermes-public-hard/g,
      ),
    ).toHaveLength(4);
  });

  it("reports a valid verifier sidecar as the effective result without mutating provenance", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-pilot-reporting-"));
    try {
      const trajectoryDir = path.join(root, "trajectory");
      fs.mkdirSync(trajectoryDir);
      const rawRecord: Record<string, unknown> = {
        status: "error",
        accuracy: null,
        verifier_graded: false,
        cost_usd: 0.42,
      };
      fs.writeFileSync(
        path.join(root, "verifier-result.json"),
        `${JSON.stringify({
          schema_version: 1,
          task_id: "task-1",
          surface: "hermes_stagehand_batch",
          verifier_model: "gateway/google/gemini-2.5-flash",
          outcome: true,
          process_score: 1,
          criterion_count: 4,
          evidence_insufficient_count: 0,
          trajectory_dir: trajectoryDir,
        })}\n`,
      );
      const context: HermesPilotRecordContext = {
        record: rawRecord,
        runDir: root,
        identity: {
          taskId: "task-1",
          surface: "hermes_stagehand_batch",
          verifierModel: "gateway/google/gemini-2.5-flash",
        },
        successMode: "both",
      };

      expect(readValidVerifierSidecar(context)).toMatchObject({ outcome: true, process_score: 1 });
      expect(resolveEffectiveHermesPilotRecord(context)).toMatchObject({
        regraded: true,
        record: {
          status: "verified_passed",
          accuracy: true,
          verifier_graded: true,
          outcome: true,
          process_score: 1,
        },
      });
      expect(rawRecord).toEqual({
        status: "error",
        accuracy: null,
        verifier_graded: false,
        cost_usd: 0.42,
      });
      expect(summarizeHermesPilotRecords([context], "canary")).toEqual({
        phase: "canary",
        records: 1,
        effective_statuses: { verified_passed: 1 },
        effective_accuracy: { graded: 1, passed: 1, failed: 0, ungraded: 0, rate: 1 },
        raw_statuses: { error: 1 },
        regraded_records: 1,
        total_cost_usd: 0.42,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when a verifier sidecar has the wrong identity or incomplete fields", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-pilot-reporting-"));
    try {
      const trajectoryDir = path.join(root, "trajectory");
      fs.mkdirSync(trajectoryDir);
      const context: HermesPilotRecordContext = {
        record: { status: "error" },
        runDir: root,
        identity: {
          taskId: "task-1",
          surface: "hermes_browser_exec",
          verifierModel: "gateway/google/gemini-2.5-flash",
        },
        successMode: "both",
      };
      const sidecar = {
        schema_version: 1,
        task_id: "task-1",
        surface: "hermes_stagehand_batch",
        verifier_model: "gateway/google/gemini-2.5-flash",
        outcome: true,
        process_score: 1,
        criterion_count: 4,
        evidence_insufficient_count: 0,
        trajectory_dir: trajectoryDir,
      };
      fs.writeFileSync(path.join(root, "verifier-result.json"), JSON.stringify(sidecar));
      expect(() => readValidVerifierSidecar(context)).toThrow(
        "Verifier regrade identity mismatch at surface",
      );

      fs.writeFileSync(
        path.join(root, "verifier-result.json"),
        JSON.stringify({ ...sidecar, surface: "hermes_browser_exec", criterion_count: null }),
      );
      expect(() => summarizeHermesPilotRecords([context], "canary")).toThrow(
        "Verifier regrade is incomplete",
      );

      fs.writeFileSync(
        path.join(root, "verifier-result.json"),
        JSON.stringify({ ...sidecar, surface: "hermes_browser_exec", criterion_count: 0 }),
      );
      expect(() => summarizeHermesPilotRecords([context], "canary")).toThrow(
        "Verifier regrade is incomplete",
      );

      fs.writeFileSync(
        path.join(root, "verifier-result.json"),
        JSON.stringify({
          ...sidecar,
          surface: "hermes_browser_exec",
          evidence_insufficient_count: 1,
        }),
      );
      expect(resolveEffectiveHermesPilotRecord(context)).toMatchObject({
        regraded: true,
        record: { status: "verified_failed", accuracy: false },
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
