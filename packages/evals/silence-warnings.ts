/**
 * Silence noisy third-party warnings at process start.
 *
 * ESM evaluates imported modules in depth-first order. Keep this module
 * free of any imports so it runs before anything else in the CLI — in
 * particular before `braintrust`, which otherwise emits
 * `console.warn("OpenTelemetry packages are not installed. …")` at
 * import-time.
 *
 * This file MUST be imported first in packages/evals/cli.ts.
 */

const originalWarn = console.warn.bind(console);

const SUPPRESS_PATTERNS: RegExp[] = [
  /OpenTelemetry packages are not installed/,
];

console.warn = (...args: unknown[]): void => {
  const first = args[0];
  if (typeof first === "string") {
    for (const pattern of SUPPRESS_PATTERNS) {
      if (pattern.test(first)) return;
    }
  }
  originalWarn(...args);
};

export {};
