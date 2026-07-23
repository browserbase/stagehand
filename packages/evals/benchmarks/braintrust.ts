/**
 * Braintrust wiring for benchmark-matrix runs.
 *
 * Maps a BenchmarkCombination onto the runner's options so every experiment
 * is (a) named self-describingly — benchmark, harness, tool surface, model,
 * env, date — and (b) stamped with the full triple in experiment metadata,
 * making any two points of the matrix diffable in Braintrust.
 *
 * Kept free of framework/ imports (only types flow the other way:
 * runner.ts imports BenchmarkRunDescriptor + the name builder from here).
 */
import type {
  BenchmarkCombination,
  BenchmarkHarness,
  BenchmarkToolSurface,
} from "./schema.js";

/** The slice of a combination the runner carries through to Braintrust. */
export interface BenchmarkRunDescriptor {
  name: string;
  harness: BenchmarkHarness;
  toolSurface: BenchmarkToolSurface;
}

/**
 * SDK-comparison semantics fall out of the tool surface: the two SDK code
 * surfaces are exactly the `--sdk v3|v4` worlds; external surfaces
 * (playwright/cdp/MCP/CLI) have no Stagehand SDK in the loop.
 */
export function sdkForToolSurface(
  toolSurface: BenchmarkToolSurface,
): "v3" | "v4" | undefined {
  if (toolSurface === "understudy_code") return "v3";
  if (toolSurface === "v4_code") return "v4";
  return undefined;
}

/**
 * Experiment name for a benchmark run. Same segment conventions as the
 * SDK-comparison names (double-underscore, short model id, ISO date) so the
 * Braintrust experiment list sorts and scans uniformly.
 */
export function buildBenchmarkExperimentName(input: {
  benchmark: BenchmarkRunDescriptor;
  environment: string;
  model?: string;
  /** Injectable for deterministic tests; defaults to today (UTC). */
  date?: string;
}): string {
  const model = input.model
    ? input.model.includes("/")
      ? input.model.split("/").slice(1).join("/")
      : input.model
    : "multi";
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  return [
    input.benchmark.name,
    input.benchmark.harness,
    input.benchmark.toolSurface,
    input.environment.toLowerCase(),
    model,
    date,
  ].join("__");
}

/** Experiment-metadata fields for a benchmark run. */
export function benchmarkRunMetadata(
  benchmark: BenchmarkRunDescriptor,
): Record<string, unknown> {
  return {
    benchmark: benchmark.name,
    harness: benchmark.harness,
    toolSurface: benchmark.toolSurface,
  };
}

/**
 * Runner options for one point of the matrix. Spread this into the
 * `runEvals` call (task/target selection stays the caller's job — a suite
 * target maps to the existing `b:<suite>` resolution, a tasks target to
 * task names):
 *
 *   runEvals({ tasks, registry, ...benchmarkRunnerOptions(combination) })
 */
export function benchmarkRunnerOptions(combination: BenchmarkCombination): {
  modelOverride: string;
  harness: BenchmarkHarness;
  trials: number;
  sdk?: "v3" | "v4";
  benchmark: BenchmarkRunDescriptor;
} {
  const sdk = sdkForToolSurface(combination.toolSurface);
  return {
    modelOverride: combination.model,
    harness: combination.harness,
    trials: combination.trials,
    ...(sdk ? { sdk } : {}),
    benchmark: {
      name: combination.benchmark,
      harness: combination.harness,
      toolSurface: combination.toolSurface,
    },
  };
}
