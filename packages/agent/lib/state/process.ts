import path from "node:path";
import {
  ProcessSessionManager,
  type ExecSessionSnapshot,
} from "../processSessions.js";
import type {
  ExecCommandArgs,
  ExecCommandResult,
  WriteStdinArgs,
  WriteStdinResult,
} from "../protocol.js";
import { getBrowseCliEnv } from "./llm.js";

const managers = new Map<string, ProcessSessionManager>();

function getManager(workspace: string): ProcessSessionManager {
  const key = path.resolve(workspace);
  const existing = managers.get(key);
  if (existing) {
    return existing;
  }
  const created = new ProcessSessionManager();
  managers.set(key, created);
  return created;
}

export async function execProcessCommand(
  workspace: string,
  args: ExecCommandArgs,
): Promise<ExecCommandResult> {
  return await getManager(workspace).execCommand(args, {
    workspace,
    env: await getBrowseCliEnv(workspace),
  });
}

export async function writeProcessStdin(
  workspace: string,
  args: WriteStdinArgs,
): Promise<WriteStdinResult> {
  return await getManager(workspace).writeStdin(args);
}

export async function closeProcessSessions(workspace?: string): Promise<void> {
  const entries = [...managers.entries()];
  await Promise.all(
    entries
      .filter(([key]) => (workspace ? key === path.resolve(workspace) : true))
      .map(async ([key, manager]) => {
        await manager.closeAll();
        managers.delete(key);
      }),
  );
}

export function getCachedExecSessions(
  workspace: string,
): ExecSessionSnapshot[] {
  return getManager(workspace).listSessions();
}
