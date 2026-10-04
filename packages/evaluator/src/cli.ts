#!/usr/bin/env node
import { parseArgs } from "node:util";
import fs from "node:fs/promises";
import { Evaluator } from "./evaluator.js";
import { loadTrajectoryFromDisk, normalizeRubric } from "./trajectory.js";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      model: { type: "string" },
      json: { type: "boolean" },
      out: { type: "string" },
      rubric: { type: "string" },
      trace: { type: "string" },
      help: { type: "boolean" },
      "generate-rubric": { type: "boolean" },
    },
  });
  if (values.help) {
    process.stdout.write(
      "stagehand-evaluator <trajectory-directory> [--model provider/model] [--rubric file] [--out file] [--trace file] [--json]\n",
    );
    return;
  }
  if (positionals.length !== 1) throw new Error("Expected one saved trajectory directory");
  const trajectory = await loadTrajectoryFromDisk(positionals[0]);
  if (values.rubric) {
    trajectory.task.precomputedRubric = normalizeRubric(
      JSON.parse(await fs.readFile(values.rubric, "utf8")),
    );
    if (!trajectory.task.precomputedRubric) throw new Error("Invalid rubric file");
  }
  if (values["generate-rubric"]) delete trajectory.task.precomputedRubric;
  const trace: unknown[] = [];
  const evaluator = new Evaluator({
    modelName: values.model,
    logger: (line) => trace.push(line),
    onUsage: (usage) => trace.push({ type: "usage", usage }),
  });
  const result = await evaluator.verify(trajectory);
  const output = JSON.stringify(result, null, 2) + "\n";
  if (values.out) await fs.writeFile(values.out, output, { flag: "wx" });
  if (values.trace)
    await fs.writeFile(values.trace, trace.map((x) => JSON.stringify(x)).join("\n") + "\n", {
      flag: "wx",
    });
  process.stdout.write(output);
  if (result.health?.status === "error" || result.health?.status === "degraded")
    process.exitCode = 2;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Evaluator failed: ${message}\n`);
  process.stdout.write(
    JSON.stringify({
      outcomeSuccess: false,
      outcomeState: "unresolved",
      health: { schemaVersion: 1, status: "error", errors: [{ stage: "cli", message }] },
    }) + "\n",
  );
  process.exitCode = 1;
});
