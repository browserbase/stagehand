import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { CommandExecutionError } from "./errors.js";

const require = createRequire(import.meta.url);

export interface CommandSpec {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  input?: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export async function runCommand(spec: CommandSpec): Promise<CommandResult> {
  const args = spec.args ?? [];

  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(spec.command, args, {
      cwd: spec.cwd,
      env: {
        ...process.env,
        ...(spec.env ?? {}),
      },
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(
        new CommandExecutionError(
          `Failed to start command: ${spec.command}`,
          {
            command: spec.command,
            args,
            exitCode: null,
            stdout,
            stderr: error instanceof Error ? `${stderr}${error.message}` : stderr,
          },
        ),
      );
    });

    child.on("close", (exitCode) => {
      if (exitCode !== 0) {
        reject(
          new CommandExecutionError(
            `Command exited with code ${exitCode}: ${spec.command}`,
            {
              command: spec.command,
              args,
              exitCode,
              stdout,
              stderr,
            },
          ),
        );
        return;
      }

      resolve({
        stdout,
        stderr,
        exitCode,
      });
    });

    if (spec.input) {
      child.stdin.write(spec.input);
    }
    child.stdin.end();
  });
}

export function resolvePackageBin(
  packageName: string,
  binName?: string,
): string {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const packageDir = path.dirname(packageJsonPath);
  const packageJson = require(packageJsonPath) as {
    bin?: string | Record<string, string>;
  };

  if (!packageJson.bin) {
    throw new Error(`Package ${packageName} does not expose a binary.`);
  }

  if (typeof packageJson.bin === "string") {
    return path.join(packageDir, packageJson.bin);
  }

  const resolvedBinName = binName ?? Object.keys(packageJson.bin)[0];
  if (!resolvedBinName || !packageJson.bin[resolvedBinName]) {
    throw new Error(
      `Package ${packageName} does not expose the binary ${binName ?? "<default>"}.`,
    );
  }

  return path.join(packageDir, packageJson.bin[resolvedBinName]);
}
