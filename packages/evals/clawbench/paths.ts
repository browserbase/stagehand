import fs from "node:fs";
import path from "node:path";
import { getPackageRootDir } from "../runtimePaths.js";

export function getClawBenchDatasetRoot(): string {
  return path.join(getPackageRootDir(), "datasets", "clawbench");
}

export function getClawBenchCasesRoot(): string {
  return path.join(getClawBenchDatasetRoot(), "test-cases");
}

export function getClawBenchRuntimeRoot(): string {
  return path.join(getClawBenchDatasetRoot(), "runtime");
}

export function resolveClawBenchModelsYaml(): string {
  const explicit =
    process.env.EVAL_CLAWBENCH_MODELS_YAML ?? process.env.CLAWBENCH_MODELS_YAML;
  if (explicit) return path.resolve(explicit);

  const candidates = [
    path.join(getClawBenchDatasetRoot(), "models", "models.yaml"),
    path.resolve(process.cwd(), "../ClawBench/models/models.yaml"),
    path.resolve(process.cwd(), "models/models.yaml"),
    path.resolve(
      getPackageRootDir(),
      "..",
      "..",
      "..",
      "ClawBench",
      "models",
      "models.yaml",
    ),
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  return found ?? candidates[0];
}
