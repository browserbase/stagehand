/**
 * Manifest loading and matrix expansion.
 *
 * Deliberately standalone (no imports from framework/) so it can be wired
 * into the planner/CLI without entangling this layer in harness internals —
 * the planner consumes `BenchmarkCombination[]` and stamps the triple into
 * run rows and Braintrust metadata.
 */
import fs from "node:fs";
import path from "node:path";
import {
  BenchmarkManifestSchema,
  combinationInvalidReason,
  type BenchmarkCombination,
  type ResolvedBenchmarkManifest,
} from "./schema.js";

export interface ExpandedBenchmark {
  manifest: ResolvedBenchmarkManifest;
  /** Valid (model × harness × toolSurface) rows, in manifest order. */
  combinations: BenchmarkCombination[];
  /** Cross-product points dropped by validity rules, with reasons. */
  skipped: Array<{
    model: string;
    harness: string;
    toolSurface: string;
    reason: string;
  }>;
}

export function expandManifest(
  manifest: ResolvedBenchmarkManifest,
): ExpandedBenchmark {
  const combinations: BenchmarkCombination[] = [];
  const skipped: ExpandedBenchmark["skipped"] = [];

  for (const model of manifest.matrix.models) {
    for (const harness of manifest.matrix.harnesses) {
      for (const toolSurface of manifest.matrix.toolSurfaces) {
        const reason = combinationInvalidReason(harness, toolSurface);
        if (reason) {
          skipped.push({ model, harness, toolSurface, reason });
          continue;
        }
        combinations.push({
          benchmark: manifest.name,
          model,
          harness,
          toolSurface,
          target: manifest.target,
          trials: manifest.trials,
        });
      }
    }
  }

  return { manifest, combinations, skipped };
}

function loadManifestFile(filePath: string): ResolvedBenchmarkManifest {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const parsed = BenchmarkManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid benchmark manifest ${filePath}: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

/** Load and expand every *.bench.json manifest in a directory. */
export function loadBenchmarksDir(dir: string): ExpandedBenchmark[] {
  const entries = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".bench.json"))
    .sort();
  return entries.map((f) =>
    expandManifest(loadManifestFile(path.join(dir, f))),
  );
}
