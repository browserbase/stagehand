import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const specPath = process.argv[2];
if (!specPath) throw new Error("Missing MCP process specification.");
const spec = JSON.parse(await readFile(specPath, "utf8")) as {
  command: string[];
  environment: Record<string, string>;
};
if (!Array.isArray(spec.command) || !spec.command[0]) throw new Error("Invalid MCP command.");
const base = Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot"]
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]!]),
);
const child = spawn(spec.command[0], spec.command.slice(1), {
  env: { ...base, ...spec.environment },
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
