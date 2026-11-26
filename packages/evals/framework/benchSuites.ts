export const BENCH_SUITE_NAMES = [
  "webvoyager",
  "onlineMind2Web",
  "webtailbench",
  "hardbenchmark",
  "odysseysbench",
] as const;

export type BenchSuiteName = (typeof BENCH_SUITE_NAMES)[number];

export function listBenchSuites(): BenchSuiteName[] {
  return [...BENCH_SUITE_NAMES];
}

export function benchSuiteTaskName(name: BenchSuiteName): `agent/${BenchSuiteName}` {
  return `agent/${name}`;
}

export function listBenchSuiteTaskNames(): string[] {
  return BENCH_SUITE_NAMES.map(benchSuiteTaskName);
}

export function isBenchSuite(value: string): value is BenchSuiteName {
  return (BENCH_SUITE_NAMES as readonly string[]).includes(value);
}
