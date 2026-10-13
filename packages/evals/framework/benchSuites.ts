/**
 * The one list of agent benchmark suites.
 *
 * Discovery registers one virtual task per name here, and the CLI parser
 * and help list them. Kept dependency-free so they can import it without
 * pulling the suite builders (and their dataset readers) into REPL startup.
 * `benchPlanner.ts` maps each name to its builder with a `satisfies` check, so
 * adding a suite here without a builder fails typecheck instead of silently
 * planning nothing.
 */

export const BENCH_SUITE_NAMES = [
  "webvoyager",
  "onlineMind2Web",
  "webtailbench",
  "hardbenchmark",
  "odysseysbench",
] as const;

export type BenchSuiteName = (typeof BENCH_SUITE_NAMES)[number];

/** Short names as used by `b:<name>` and `EVAL_<NAME>_LIMIT`. */
export function listBenchSuites(): BenchSuiteName[] {
  return [...BENCH_SUITE_NAMES];
}

/** Discovered task name for a suite (`agent/webvoyager`). */
export function benchSuiteTaskName(name: BenchSuiteName): `agent/${BenchSuiteName}` {
  return `agent/${name}`;
}

/** Task names in registry order: `agent/webvoyager, agent/onlineMind2Web, …`. */
export function listBenchSuiteTaskNames(): string[] {
  return BENCH_SUITE_NAMES.map(benchSuiteTaskName);
}

export function isBenchSuite(value: string): value is BenchSuiteName {
  return (BENCH_SUITE_NAMES as readonly string[]).includes(value);
}
