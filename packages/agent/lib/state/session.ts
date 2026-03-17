import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import {
  type AgentOptions,
  type AgentSubagentConfig,
  AgentSubagentConfigSchema,
  type BrowserId,
  BrowserIds,
  DEFAULT_INITIAL_SUBAGENT_COUNT,
  type ManagedAgentId,
  type UpdatePlanArgs,
  UpdatePlanArgsSchema,
} from "../protocol.js";

export const TOP_LEVEL_TODO_FILE = "TODO.md";
export const SESSION_CONFIG_FILE = "config.json";
export const SESSION_LLM_FILE = "llm.json";
export const SESSION_LOGS_DIR = "logs";
export const SESSION_PLAN_FILE = "plan.json";
export const SESSION_CONVERSATION_LOG_FILE = "conversation.jsonl";
export const SUBAGENT_CONFIG_FILE = "config.json";

export const SessionConfigSchema = z.object({
  initialSubagentCount: z.literal(DEFAULT_INITIAL_SUBAGENT_COUNT).default(
    DEFAULT_INITIAL_SUBAGENT_COUNT,
  ),
  systemPrompt: z.string().optional(),
  maxSteps: z.number().int().positive().optional(),
});

export type SessionConfig = z.infer<typeof SessionConfigSchema>;

export const ConversationEntrySchema = z.object({
  role: z.string(),
  content: z.string(),
  created_at: z.string(),
});

export type ConversationEntry = z.infer<typeof ConversationEntrySchema>;

export type SubagentWorkspaceLayout = {
  browserId: ManagedAgentId;
  rootDir: string;
  logsDir: string;
  todoPath: string;
  configPath: string;
};

export type WorkspaceLayout = {
  rootDir: string;
  todoPath: string;
  configPath: string;
  llmPath: string;
  logsDir: string;
  planPath: string;
  conversationLogPath: string;
  subagents: Record<BrowserId, SubagentWorkspaceLayout>;
};

export type SessionInitOptions = Pick<
  AgentOptions,
  "systemPrompt" | "maxSteps" | "subagents"
> & {
  workspace: string;
};

function isInitialBrowserId(value: ManagedAgentId): value is BrowserId {
  return BrowserIds.includes(value as BrowserId);
}

function defaultSubagentDirectoryName(browserId: ManagedAgentId): string {
  if (isInitialBrowserId(browserId)) {
    return `subagent${browserId}`;
  }
  return path.join("agents", browserId);
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

async function readJsonFile<T>(
  filePath: string,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return schema.parse(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

async function ensureTextFile(filePath: string, contents = ""): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, contents, "utf8");
  }
}

export function createSubagentWorkspaceLayout(
  workspaceRoot: string,
  browserId: ManagedAgentId,
  directoryName = defaultSubagentDirectoryName(browserId),
): SubagentWorkspaceLayout {
  const rootDir = path.join(workspaceRoot, directoryName);
  return {
    browserId,
    rootDir,
    logsDir: path.join(rootDir, SESSION_LOGS_DIR),
    todoPath: path.join(rootDir, TOP_LEVEL_TODO_FILE),
    configPath: path.join(rootDir, SUBAGENT_CONFIG_FILE),
  };
}

export async function ensureSubagentWorkspace(
  layout: SubagentWorkspaceLayout,
): Promise<SubagentWorkspaceLayout> {
  await fs.mkdir(layout.rootDir, { recursive: true });
  await fs.mkdir(layout.logsDir, { recursive: true });
  await ensureTextFile(
    layout.todoPath,
    `# Subagent ${layout.browserId} TODO\n\n`,
  );
  await ensureTextFile(layout.configPath, "{}\n");
  return layout;
}

export async function ensureWorkspaceLayout(
  rootDir: string,
): Promise<WorkspaceLayout> {
  await fs.mkdir(rootDir, { recursive: true });

  const todoPath = path.join(rootDir, TOP_LEVEL_TODO_FILE);
  const configPath = path.join(rootDir, SESSION_CONFIG_FILE);
  const llmPath = path.join(rootDir, SESSION_LLM_FILE);
  const logsDir = path.join(rootDir, SESSION_LOGS_DIR);
  const planPath = path.join(rootDir, SESSION_PLAN_FILE);
  const conversationLogPath = path.join(logsDir, SESSION_CONVERSATION_LOG_FILE);

  await ensureTextFile(todoPath, "# Workspace TODO\n");
  await ensureTextFile(configPath, "{}\n");
  await ensureTextFile(llmPath, "{}\n");
  await ensureTextFile(planPath, "{}\n");
  await fs.mkdir(logsDir, { recursive: true });
  await ensureTextFile(conversationLogPath, "");

  const subagents = {} as Record<BrowserId, SubagentWorkspaceLayout>;
  for (const browserId of BrowserIds) {
    const layout = createSubagentWorkspaceLayout(rootDir, browserId);
    await ensureSubagentWorkspace(layout);
    subagents[browserId] = layout;
  }

  return {
    rootDir,
    todoPath,
    configPath,
    llmPath,
    logsDir,
    planPath,
    conversationLogPath,
    subagents,
  };
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

export async function initializeSessionState(
  options: SessionInitOptions,
): Promise<WorkspaceLayout> {
  const layout = await ensureWorkspaceLayout(options.workspace);
  await writeSessionConfig(layout.rootDir, {
    initialSubagentCount: DEFAULT_INITIAL_SUBAGENT_COUNT,
    systemPrompt: options.systemPrompt,
    maxSteps: options.maxSteps,
  });
  return layout;
}

export async function readSessionConfig(workspace: string): Promise<SessionConfig> {
  return await readJsonFile(
    path.join(workspace, SESSION_CONFIG_FILE),
    SessionConfigSchema,
    SessionConfigSchema.parse({}),
  );
}

export async function writeSessionConfig(
  workspace: string,
  config: Partial<SessionConfig>,
): Promise<SessionConfig> {
  const existing = await readSessionConfig(workspace);
  const merged = SessionConfigSchema.parse({
    ...existing,
    ...config,
  });
  await writeJsonFile(path.join(workspace, SESSION_CONFIG_FILE), merged);
  return merged;
}

export async function readSubagentConfig(
  layout: SubagentWorkspaceLayout,
): Promise<AgentSubagentConfig> {
  return await readJsonFile(
    layout.configPath,
    AgentSubagentConfigSchema,
    AgentSubagentConfigSchema.parse({}),
  );
}

export async function writeSubagentConfig(
  layout: SubagentWorkspaceLayout,
  config: Partial<AgentSubagentConfig>,
): Promise<AgentSubagentConfig> {
  const existing = await readSubagentConfig(layout);
  const merged = AgentSubagentConfigSchema.parse({
    ...existing,
    ...config,
  });
  await writeJsonFile(layout.configPath, merged);
  return merged;
}

export async function writePlanState(
  workspace: string,
  plan: UpdatePlanArgs,
): Promise<UpdatePlanArgs> {
  const parsed = UpdatePlanArgsSchema.parse(plan);
  await writeJsonFile(path.join(workspace, SESSION_PLAN_FILE), parsed);
  return parsed;
}

export async function readPlanState(
  workspace: string,
): Promise<UpdatePlanArgs | null> {
  const value = await readJsonFile<UpdatePlanArgs | null>(
    path.join(workspace, SESSION_PLAN_FILE),
    UpdatePlanArgsSchema.nullable(),
    null,
  );
  return value;
}

export async function appendConversationEntry(
  workspace: string,
  entry: { role: string; content: string },
): Promise<void> {
  const conversationLogPath = path.join(
    workspace,
    SESSION_LOGS_DIR,
    SESSION_CONVERSATION_LOG_FILE,
  );
  const parsed = ConversationEntrySchema.parse({
    ...entry,
    created_at: new Date().toISOString(),
  });
  await fs.appendFile(conversationLogPath, `${JSON.stringify(parsed)}\n`, "utf8");
}

export async function readRecentConversationEntries(
  workspace: string,
  limit = 6,
): Promise<ConversationEntry[]> {
  const conversationLogPath = path.join(
    workspace,
    SESSION_LOGS_DIR,
    SESSION_CONVERSATION_LOG_FILE,
  );
  const raw = await fs.readFile(conversationLogPath, "utf8").catch(() => "");
  const parsed = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [ConversationEntrySchema.parse(JSON.parse(line))];
      } catch {
        return [];
      }
    });
  return parsed.slice(-limit);
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

export async function appendJsonLog(
  logsDirOrLayout: string | Pick<SubagentWorkspaceLayout, "logsDir">,
  fileName: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const logsDir =
    typeof logsDirOrLayout === "string"
      ? logsDirOrLayout
      : logsDirOrLayout.logsDir;
  const filePath = path.join(logsDir, fileName);
  const line = `${JSON.stringify({
    timestamp: new Date().toISOString(),
    ...payload,
  })}\n`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, line, "utf8");
}

export async function copyStateFiles(
  source: string,
  destination: string,
  fileNames: string[],
): Promise<void> {
  await fs.mkdir(destination, { recursive: true });
  await Promise.all(
    fileNames.map(async (fileName) => {
      const sourcePath = path.join(source, fileName);
      const destinationPath = path.join(destination, fileName);
      try {
        await fs.copyFile(sourcePath, destinationPath);
      } catch {
        // Ignore missing optional state files.
      }
    }),
  );
}
