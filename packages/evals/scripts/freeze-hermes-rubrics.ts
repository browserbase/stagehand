import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { V3, type TaskSpec } from "stagehand-v3";

import { createVerifierEvaluator, resolveRubricTraced } from "../framework/verifierAdapter.js";
import { EvalLogger } from "../logger.js";

interface ManifestTask {
  task_id: string;
  confirmed_task: string;
  website: string;
}

interface ScaledManifest {
  schema_version: "1";
  suite: { id: string; task_count: number };
  grading: { primary_verifier: { model: string; rubric_policy: string } };
  tasks: ManifestTask[];
}

function requiredArg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  if (!value || value.startsWith("--")) throw new Error(`Missing required argument ${name}`);
  return value;
}

function optionalPositiveIntArg(name: string): number | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  if (!value) return undefined;
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(value);
}

function sha256(value: Uint8Array | string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readManifest(file: string, expectedSha256: string): ScaledManifest {
  const bytes = fs.readFileSync(file);
  const observed = sha256(bytes);
  if (observed !== expectedSha256) {
    throw new Error(`Manifest digest mismatch: expected ${expectedSha256}, observed ${observed}`);
  }
  const manifest = JSON.parse(bytes.toString("utf8")) as ScaledManifest;
  if (
    manifest.schema_version !== "1" ||
    !manifest.suite.id.startsWith("online-mind2web-paired-bd-") ||
    manifest.tasks.length !== manifest.suite.task_count ||
    manifest.grading.primary_verifier.rubric_policy !==
      "Generate and freeze every selected task rubric before either arm runs; reuse it byte-for-byte for B and D."
  ) {
    throw new Error("Manifest is not a frozen scaled B/D declaration");
  }
  return manifest;
}

async function main(): Promise<void> {
  const manifestPath = path.resolve(requiredArg("--manifest"));
  const manifestSha256 = requiredArg("--manifest-sha256");
  const cacheRoot = path.resolve(requiredArg("--cache-root"));
  const manifest = readManifest(manifestPath, manifestSha256);
  const firstBlock = optionalPositiveIntArg("--first-block") ?? 1;
  const lastBlock = optionalPositiveIntArg("--last-block") ?? manifest.tasks.length;
  if (firstBlock > lastBlock || lastBlock > manifest.tasks.length) {
    throw new Error("Rubric block range is outside the frozen manifest");
  }
  const tasks = manifest.tasks.slice(firstBlock - 1, lastBlock);
  process.env.EVAL_RUBRIC_CACHE_ROOT = cacheRoot;
  process.env.EVAL_VERIFIER_MODEL = manifest.grading.primary_verifier.model;

  const logger = new EvalLogger(true);
  const carrier = new V3({
    env: "LOCAL",
    logger: logger.log.bind(logger),
    disablePino: true,
    disableAPI: true,
    experimental: true,
    verbose: 0,
  });
  logger.init(carrier);
  const evaluator = createVerifierEvaluator(carrier);
  let cached = 0;
  let generated = 0;
  const identities: Array<Record<string, unknown>> = [];
  try {
    for (const task of tasks) {
      const taskSpec: TaskSpec = {
        id: task.task_id,
        instruction: task.confirmed_task,
        initUrl: task.website,
      };
      const resolved = await resolveRubricTraced(evaluator, {
        taskSpec,
        dataset: "onlineMind2Web",
        cacheRoot,
      });
      if (resolved.source === "cached") cached += 1;
      else generated += 1;
      identities.push({
        task_id: task.task_id,
        source: resolved.source,
        criterion_count: resolved.rubric.items.length,
        rubric_sha256: sha256(JSON.stringify(resolved.rubric)),
      });
      process.stderr.write(
        `[rubric-freeze] ${cached + generated}/${tasks.length} ${task.task_id} ${resolved.source}\n`,
      );
    }
  } finally {
    void carrier.close().catch(() => {});
  }

  const report = {
    schema_version: 1,
    suite_id: manifest.suite.id,
    manifest_sha256: manifestSha256,
    verifier_model: manifest.grading.primary_verifier.model,
    cache_root: cacheRoot,
    suite_task_count: manifest.tasks.length,
    first_block: firstBlock,
    last_block: lastBlock,
    task_count: tasks.length,
    cached,
    generated,
    identities,
  };
  const output = path.resolve(requiredArg("--output"));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = `${output}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, output);
  console.log(JSON.stringify({ task_count: tasks.length, cached, generated, output }));
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
