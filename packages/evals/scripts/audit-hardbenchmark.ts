/** Offline authoring checks. No model, browser, network, dotenv or label correction. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { EvalsError } from "../errors.js";

type Row = {
  id: string;
  ques: string;
  precomputed_rubric?: unknown;
  [key: string]: unknown;
};
type Item = { criterion: string; description: string; maxPoints: number };

export function checkRubric(rubric: unknown): string[] {
  const items = (rubric as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length === 0)
    return ["precomputed_rubric.items missing or empty"];
  const problems: string[] = [];
  const criteria = new Set<string>();
  items.forEach((item, i) => {
    if (!item || typeof item !== "object") {
      problems.push(`item ${i}: not an object`);
      return;
    }
    for (const key of ["criterion", "description"])
      if (typeof item[key] !== "string" || !item[key].trim())
        problems.push(`item ${i}: ${key} missing`);
    const points = item.maxPoints ?? item.max_points;
    if (typeof points !== "number" || !Number.isFinite(points) || points <= 0)
      problems.push(`item ${i}: maxPoints must be finite and positive`);
    if (typeof item.criterion === "string") {
      const key = item.criterion.trim().toLowerCase();
      if (criteria.has(key)) problems.push(`item ${i}: duplicate criterion`);
      criteria.add(key);
    }
  });
  return problems;
}

export function checkStopBeforePurchase(row: Row): boolean {
  if (checkRubric(row.precomputed_rubric).length) return false;
  const items = (row.precomputed_rubric as { items: Item[] }).items;
  const stopItems = items.filter((item) =>
    /critical point|without crossing|do not (complete|submit|place)|stop before|not beyond/i.test(
      `${item.criterion} ${item.description}`,
    ),
  );
  return (
    stopItems.length > 0 &&
    (/\b(purchase|buy|order|book|preorder|pre-order|reserve)\b/i.test(row.ques) ||
      stopItems.some((item) =>
        /(purchas\w*|order(ing)?|checkout|booking) (flow|workflow)|binding checkout/i.test(
          item.criterion,
        ),
      ))
  );
}

export function auditRows(rows: Row[]) {
  const ids = new Set<string>();
  return rows.map((row) => {
    if (
      !row ||
      typeof row.id !== "string" ||
      !row.id ||
      typeof row.ques !== "string" ||
      !row.ques.trim()
    )
      throw new EvalsError("Every row needs a nonempty id and question");
    if (ids.has(row.id)) throw new EvalsError("Duplicate task id");
    ids.add(row.id);
    const problems = checkRubric(row.precomputed_rubric);
    return {
      id: row.id,
      rubricProblems: problems,
      stopBeforePurchase: checkStopBeforePurchase(row),
    };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { dataset: { type: "string" }, out: { type: "string" } },
  });
  if (!values.dataset || !values.out)
    throw new EvalsError("Required: --dataset <jsonl> --out <new-json>");
  if (path.resolve(values.dataset) === path.resolve(values.out))
    throw new EvalsError("Dataset and report paths must differ");
  const lines = readFileSync(values.dataset, "utf8")
    .split("\n")
    .filter((line) => line.trim());
  const rows = lines.map((line) => JSON.parse(line) as Row);
  const tasks = auditRows(rows);
  writeFileSync(
    values.out,
    JSON.stringify(
      {
        scope: "offline authoring checks; no current site reachability or task achievability claim",
        total: tasks.length,
        rubricDefects: tasks.filter((task) => task.rubricProblems.length).length,
        tasks,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
}
