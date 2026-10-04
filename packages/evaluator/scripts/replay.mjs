// Frozen-manifest replay. Never writes into source trajectory directories.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { Evaluator, loadTrajectoryFromDisk, resolveVerifierConfig } from "../dist/index.js";

const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    out: { type: "string" },
    model: { type: "string" },
    jobs: { type: "string", default: "3" },
    "rubric-overrides": { type: "string" },
  },
});
// Rubric overrides (e.g. clarified v1.2 rubrics) replace the hydrated rubric by task id at judge
// time; saved trajectory files are never modified. Stamped into run.json for provenance.
const rubricOverrides = values["rubric-overrides"]
  ? JSON.parse(await fs.readFile(values["rubric-overrides"], "utf8"))
  : null;
if (!values.manifest || !values.out || !values.model)
  throw new Error("Required: --manifest --out --model");
const manifestBytes = await fs.readFile(values.manifest);
const rows = JSON.parse(manifestBytes);
const jobs = Number(values.jobs);
if (!Number.isInteger(jobs) || jobs < 1 || jobs > 8)
  throw new Error("--jobs must be an integer from 1 to 8");
await fs.mkdir(values.out); // Existing output is an error, preventing accidental overwrite.
const hash = (data) => createHash("sha256").update(data).digest("hex");
const dist = new URL("../dist/", import.meta.url);
const builtFiles = (await fs.readdir(dist, { recursive: true }))
  .filter((name) => name.endsWith(".js"))
  .sort();
const buildHash = hash(
  Buffer.concat(
    await Promise.all(
      builtFiles.map(async (name) =>
        Buffer.concat([Buffer.from(name + "\0"), await fs.readFile(new URL(name, dist))]),
      ),
    ),
  ),
);
const config = resolveVerifierConfig();
const dependencyVersions = Object.fromEntries(
  await Promise.all(
    ["ai", "@ai-sdk/google", "@ai-sdk/openai", "zod", "sharp"].map(async (name) => {
      const metadata = JSON.parse(
        await fs.readFile(new URL(`../node_modules/${name}/package.json`, import.meta.url)),
      );
      return [name, metadata.version];
    }),
  ),
);
await fs.writeFile(
  path.join(values.out, "run.json"),
  JSON.stringify(
    {
      model: values.model,
      rubricOverrides: rubricOverrides
        ? {
            path: values["rubric-overrides"],
            sha256: createHash("sha256").update(JSON.stringify(rubricOverrides)).digest("hex"),
            tasks: Object.keys(rubricOverrides).length,
          }
        : null,
      manifest: values.manifest,
      manifestSha256: hash(manifestBytes),
      rows: rows.length,
      buildSha256: buildHash,
      replayScriptSha256: hash(await fs.readFile(new URL(import.meta.url))),
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      dependencyVersions,
      config,
      rubricModel: process.env.VERIFIER_RUBRIC_MODEL ?? values.model,
      commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      startedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
await new Evaluator({ modelName: values.model }).validate(); // Fail before starting a batch.
let next = 0;
const results = [];
await Promise.all(
  Array.from({ length: jobs }, async () => {
    while (next < rows.length) {
      const index = next++,
        row = rows[index],
        started = Date.now(),
        trace = [],
        usage = [];
      let result, error;
      try {
        for (const [name, expected] of Object.entries(row.files ?? {})) {
          if (hash(await fs.readFile(path.join(row.run, name))) !== expected)
            throw new Error(`Source hash changed: ${name}`);
        }
        const trajectory = await loadTrajectoryFromDisk(row.run);
        if (row.generateRubric) delete trajectory.task.precomputedRubric;
        if (rubricOverrides && rubricOverrides[trajectory.task.id])
          trajectory.task.precomputedRubric = rubricOverrides[trajectory.task.id];
        const evaluator = new Evaluator({
          modelName: values.model,
          logger: (line) => trace.push(line),
          onUsage: (u) => usage.push(u),
          config,
        });
        result = await evaluator.verify(trajectory);
      } catch (e) {
        error = e.message;
      }
      const record = {
        id: row.id ?? row.run,
        taskId: row.taskId,
        result,
        error,
        durationMs: Date.now() - started,
        usage,
      };
      await fs.writeFile(path.join(values.out, `${index}.json`), JSON.stringify(record, null, 2));
      await fs.writeFile(
        path.join(values.out, `${index}.trace.jsonl`),
        trace.map((x) => JSON.stringify(x)).join("\n") + "\n",
      );
      results.push(record);
      process.stdout.write(
        JSON.stringify({
          completed: results.length,
          total: rows.length,
          index,
          outcome: result?.outcomeSuccess,
          error,
          durationMs: record.durationMs,
        }) + "\n",
      );
    }
  }),
);
const summaries = {};
for (const [title, confirmed] of [
  ["confirmed-only primary", true],
  ["all-confidence sensitivity", false],
]) {
  const counts = { TP: 0, TN: 0, FP: 0, FN: 0, unlabeled: 0, errors: 0, unresolved: 0 };
  for (const row of rows) {
    const actual = results.find((r) => r.id === (row.id ?? row.run));
    if (actual.error || (actual.result.health && actual.result.health.status !== "healthy")) {
      counts.errors++;
      continue;
    }
    if (actual.result.outcomeState === "unresolved") counts.unresolved++;
    if (typeof row.label !== "boolean" || (confirmed && row.confidence !== "high")) {
      counts.unlabeled++;
      continue;
    }
    const prediction = actual.result.outcomeSuccess;
    counts[(prediction === row.label ? "T" : "F") + (prediction ? "P" : "N")]++;
  }
  summaries[title] = {
    ...counts,
    FPR: counts.FP + counts.TN ? counts.FP / (counts.FP + counts.TN) : null,
    FNR: counts.FN + counts.TP ? counts.FN / (counts.FN + counts.TP) : null,
  };
}
await fs.writeFile(
  path.join(values.out, "summary.json"),
  JSON.stringify({ completedAt: new Date().toISOString(), summaries }, null, 2),
);
process.stdout.write(JSON.stringify(summaries) + "\n");
