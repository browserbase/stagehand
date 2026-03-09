import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  type AgentSubagentConfig,
  type BrowserId,
  BrowserIds,
  DEFAULT_INITIAL_SUBAGENT_COUNT,
  type JsonObject,
  type SubagentTaskRecord,
  SubagentTaskRecordSchema,
} from "./protocol.js";

const execFileAsync = promisify(execFile);

export const TOP_LEVEL_TODO_FILE = "TODO.md";

export type SubagentWorkspaceLayout = {
  browserId: BrowserId;
  rootDir: string;
  chromeProfileDir: string;
  downloadsDir: string;
  logsDir: string;
  screenshotsDir: string;
  todoPath: string;
};

export type WorkspaceLayout = {
  rootDir: string;
  todoPath: string;
  subagents: Record<BrowserId, SubagentWorkspaceLayout>;
};

export type SubagentWorkspace = SubagentWorkspaceLayout;

export async function ensureWorkspaceLayout(
  rootDir: string,
): Promise<WorkspaceLayout> {
  await fs.mkdir(rootDir, { recursive: true });
  const todoPath = path.join(rootDir, TOP_LEVEL_TODO_FILE);
  await ensureTodoFile(todoPath, `# Workspace TODO\n`);

  const subagents = {} as Record<BrowserId, SubagentWorkspaceLayout>;
  for (const browserId of BrowserIds) {
    const subagentRoot = path.join(rootDir, `subagent${browserId}`);
    const layout: SubagentWorkspaceLayout = {
      browserId,
      rootDir: subagentRoot,
      chromeProfileDir: path.join(subagentRoot, "chrome_profile"),
      downloadsDir: path.join(subagentRoot, "downloads"),
      logsDir: path.join(subagentRoot, "logs"),
      screenshotsDir: path.join(subagentRoot, "screenshots"),
      todoPath: path.join(subagentRoot, TOP_LEVEL_TODO_FILE),
    };
    await fs.mkdir(layout.chromeProfileDir, { recursive: true });
    await fs.mkdir(layout.downloadsDir, { recursive: true });
    await fs.mkdir(layout.logsDir, { recursive: true });
    await fs.mkdir(layout.screenshotsDir, { recursive: true });
    await ensureTodoFile(
      layout.todoPath,
      `# Subagent ${browserId} TODO\n\n`,
    );
    subagents[browserId] = layout;
  }

  return { rootDir, todoPath, subagents };
}

async function ensureTodoFile(filePath: string, fallbackHeader: string) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, fallbackHeader, "utf8");
  }
}

export async function appendTopLevelTask(
  todoPath: string,
  instruction: string,
): Promise<string> {
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const block =
    `\n## ${id}\n` +
    `- created_at: ${timestamp}\n` +
    `- status: queued\n\n` +
    `${instruction.trim()}\n`;
  await fs.appendFile(todoPath, block, "utf8");
  return id;
}

export async function cloneSeedUserDataDir(
  sourceDir: string | undefined,
  destinationDir: string,
): Promise<void> {
  if (!sourceDir) {
    await fs.mkdir(destinationDir, { recursive: true });
    return;
  }

  await fs.rm(destinationDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destinationDir), { recursive: true });

  // Prefer CoW clone on macOS to keep startup cheap for seeded browser profiles.
  if (os.platform() === "darwin") {
    try {
      await execFileAsync("cp", ["-cR", sourceDir, destinationDir]);
      return;
    } catch {
      // Fall through to a portable recursive copy.
    }
  }

  // Hard-link copies are a cheap fallback when clonefile is unavailable.
  try {
    await execFileAsync("cp", ["-a", "-l", sourceDir, destinationDir]);
    return;
  } catch {
    // Fall through to fs.cp for platforms without hard-link cloning support.
  }

  await fs.cp(sourceDir, destinationDir, { recursive: true });
}

export function normalizeSubagentConfigs(
  subagents: AgentSubagentConfig[] | undefined,
): Array<AgentSubagentConfig & { browserId: BrowserId }> {
  return BrowserIds.slice(0, DEFAULT_INITIAL_SUBAGENT_COUNT).map(
    (browserId, index) => ({
      browserId,
      ...(subagents?.[index] ?? {}),
    }),
  );
}

export async function appendSubagentTaskRecord(
  todoPath: string,
  record: SubagentTaskRecord,
): Promise<void> {
  const serialized = JSON.stringify(record);
  const markdown =
    `\n<!-- subagent-task ${serialized} -->\n` +
    `## ${record.id} [${record.status}]\n` +
    `- browser_id: ${record.browser_id}\n` +
    `- updated_at: ${record.updated_at}\n\n` +
    `${record.instruction.trim()}\n`;
  await fs.appendFile(todoPath, markdown, "utf8");
}

export async function readSubagentTaskQueue(
  todoPath: string,
): Promise<SubagentTaskRecord[]> {
  const raw = await fs.readFile(todoPath, "utf8").catch(() => "");
  const matches = raw.matchAll(/<!-- subagent-task ([\s\S]*?) -->/g);
  const latestById = new Map<string, SubagentTaskRecord>();

  for (const match of matches) {
    const candidate = match[1]?.trim();
    if (!candidate) continue;
    try {
      const parsed = SubagentTaskRecordSchema.parse(JSON.parse(candidate));
      latestById.set(parsed.id, parsed);
    } catch {
      // Ignore malformed historical lines; newer records still reconstruct state.
    }
  }

  return [...latestById.values()].sort((left, right) =>
    left.created_at.localeCompare(right.created_at),
  );
}

export function createSubagentTaskRecord(input: {
  browser_id: BrowserId;
  instruction: string;
  expected_output_jsonschema?: JsonObject;
}): SubagentTaskRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    browser_id: input.browser_id,
    instruction: input.instruction,
    status: "queued",
    expected_output_jsonschema: input.expected_output_jsonschema,
    created_at: now,
    updated_at: now,
  };
}

export async function readTaskQueue(
  todoPath: string,
): Promise<SubagentTaskRecord[]> {
  return readSubagentTaskQueue(todoPath);
}

export async function writeTaskQueue(
  workspace: SubagentWorkspace,
  tasks: SubagentTaskRecord[],
): Promise<void> {
  await rewriteSubagentTodo(
    workspace,
    tasks.map(
      (task) =>
        `- [${task.status === "completed" ? "x" : " "}] ${task.status}: ${task.instruction}`,
    ),
  );

  for (const task of tasks) {
    await appendSubagentTaskRecord(workspace.todoPath, task);
  }
}

export async function ensureAgentWorkspace(input: {
  workspace: string;
  subagentCount?: number;
}): Promise<WorkspaceLayout> {
  if (
    input.subagentCount !== undefined &&
    input.subagentCount !== DEFAULT_INITIAL_SUBAGENT_COUNT
  ) {
    throw new Error(
      `packages/agent currently supports exactly ${DEFAULT_INITIAL_SUBAGENT_COUNT} initial subagents`,
    );
  }
  return await ensureWorkspaceLayout(input.workspace);
}

export async function appendTodoEntry(
  todoPath: string,
  entry: {
    title: string;
    status: "queued" | "running" | "completed" | "failed";
    body: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const createdAt = new Date().toISOString();
  const metadata = entry.metadata
    ? `\n- metadata: ${JSON.stringify(entry.metadata)}`
    : "";
  const block =
    `\n## ${entry.title}\n` +
    `- created_at: ${createdAt}\n` +
    `- status: ${entry.status}${metadata}\n\n` +
    `${entry.body.trim()}\n`;
  await fs.appendFile(todoPath, block, "utf8");
}

export async function rewriteSubagentTodo(
  workspace: SubagentWorkspace,
  lines: string[],
): Promise<void> {
  const content = `# Subagent ${workspace.browserId} TODO\n\n${lines.join("\n")}\n`;
  await fs.writeFile(workspace.todoPath, content, "utf8");
}

export async function appendJsonLog(
  workspace: SubagentWorkspace,
  fileName: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const filePath = path.join(workspace.logsDir, fileName);
  const line = `${JSON.stringify({
    timestamp: new Date().toISOString(),
    ...payload,
  })}\n`;
  await fs.appendFile(filePath, line, "utf8");
}
