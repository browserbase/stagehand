import spawn from "cross-spawn";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface RunCliOptions {
  executable?: string;
  cwd?: string;
  stdin?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export function runCli(args: string[], options: RunCliOptions = {}): Promise<CliResult> {
  return new Promise((resolvePromise, reject) => {
    const command = options.executable ?? process.execPath;
    const commandArgs = options.executable ? args : [join(repoRoot, "bin/run.js"), ...args];
    const child = spawn(command, commandArgs, {
      cwd: options.cwd ?? repoRoot,
      timeout: options.timeoutMs,
      killSignal: "SIGKILL",
      env: {
        ...process.env,
        BROWSE_DISABLE_UPDATE_CHECK: "1",
        NODE_ENV: "test",
        ...options.env,
      },
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });

    if (options.stdin !== undefined) {
      child.stdin?.on("error", () => {});
      child.stdin?.end(options.stdin);
    }

    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr!.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolvePromise({ exitCode, stdout, stderr });
    });
  });
}
