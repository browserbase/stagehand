import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const commandMaxBuffer = 16 * 1024 * 1024;

export class StagehandArtifactPackCommandError extends Error {
  name = "StagehandArtifactPackCommandError";

  constructor() {
    super("Stagehand sandbox artifact preparation failed.");
  }
}

export async function runArtifactPackCommand(file, args, cwd) {
  try {
    return await execFileAsync(file, args, { cwd, maxBuffer: commandMaxBuffer });
  } catch {
    throw new StagehandArtifactPackCommandError();
  }
}
