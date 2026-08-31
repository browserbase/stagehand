import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface RunCliOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function runCli(
  args: string[],
  options: RunCliOptions = {},
): Promise<CliResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [join(repoRoot, "bin/run.js"), ...args],
      {
        cwd: options.cwd ?? repoRoot,
        env: {
          ...process.env,
          BROWSE_DISABLE_UPDATE_CHECK: "1",
          NODE_ENV: "test",
          ...options.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolvePromise({ exitCode, stdout, stderr });
    });
  });
}
