import { spawnSync } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cliRoot = join(root, "packages/cli");
const binary = join(cliRoot, "bin/run.js");
const output =
  process.env.BROWSE_TIMING_OUTPUT ?? join(tmpdir(), `browse-startup-timing-${process.platform}`);
const env = {
  ...process.env,
  NODE_ENV: "test",
  BROWSE_DISABLE_UPDATE_CHECK: "1",
  BROWSE_LOAD_DOTENV: "0",
  DO_NOT_TRACK: "1",
};
const probes = [
  { name: "Node empty process", args: ["-e", ""] },
  { name: "Browse --version", args: [binary, "--version"] },
  { name: "Browse cloud fetch --help", args: [binary, "cloud", "fetch", "--help"] },
];
const results = [];
for (const probe of probes) {
  const samples = [];
  for (let attempt = 1; attempt <= 5; attempt++) {
    const start = performance.now();
    // Match runCli: direct Node execution, CLI cwd, and captured stdout/stderr.
    const result = spawnSync(process.execPath, probe.args, {
      cwd: cliRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 30_000,
    });
    const elapsedMs = Math.round((performance.now() - start) * 10) / 10;
    const failed = result.status !== 0 || Boolean(result.error);
    samples.push({
      elapsedMs,
      exitCode: result.status,
      ...(failed
        ? {
            error: result.error?.message,
            signal: result.signal,
            stdout: result.stdout,
            stderr: result.stderr,
          }
        : {}),
    });
    console.log(`${probe.name}, run ${attempt}: ${elapsedMs}ms (exit ${result.status})`);
    if (failed) {
      console.error(result.error?.message ?? result.stderr);
      process.exitCode = 1;
    }
  }
  const sorted = samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
  results.push({
    name: probe.name,
    args: probe.args,
    firstMs: samples[0].elapsedMs,
    medianMs: sorted[2],
    samples,
  });
}
const report = {
  platform: process.platform,
  node: process.version,
  executable: process.execPath,
  cpu: cpus()[0]?.model,
  revision: process.env.GITHUB_SHA,
  results,
};
const summary = [
  `## Browse startup timing (${process.platform})`,
  `Node: ${process.version}. CPU: ${report.cpu}.`,
  "",
  "Five fresh processes per probe; median includes all five. First means the first measured invocation after building, not a cold machine. Times include execution and shutdown.",
  "",
  "| Probe | First (ms) | Median (ms) | All samples (ms) | Exit codes |",
  "| --- | ---: | ---: | --- | --- |",
  ...results.map(
    (result) =>
      `| ${result.name} | ${result.firstMs} | ${result.medianMs} | ${result.samples.map((sample) => sample.elapsedMs).join(", ")} | ${result.samples.map((sample) => sample.exitCode ?? "null").join(", ")} |`,
  ),
  "",
].join("\n");
await mkdir(output, { recursive: true });
await writeFile(join(output, "timings.json"), JSON.stringify(report, null, 2) + "\n");
await writeFile(join(output, "summary.md"), summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
