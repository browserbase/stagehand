import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import type {
  CloseAgentArgs,
  SpawnExtraAgentArgs,
  WaitArgs,
} from "../protocol.js";
import {
  buildBrowseNamedSessionArgs,
  buildSubagentConfigFlags,
  runBrowseCli,
  spawnBrowseCli,
} from "../browseCli.js";
import {
  SUBAGENT_CONFIG_FILE,
  appendJsonLog,
  copyStateFiles,
  createSubagentWorkspaceLayout,
  ensureSubagentWorkspace,
  readRecentConversationEntries,
  readSubagentConfig,
  type SubagentWorkspaceLayout,
} from "./session.js";

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const RECENT_CONTEXT_LIMIT = 6;

const ManagedAgentStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "closed",
]);

export const ManagedAgentRecordSchema = z.object({
  id: z.string(),
  status: ManagedAgentStatusSchema,
  instruction: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

export type ManagedAgentRecord = z.infer<typeof ManagedAgentRecordSchema>;

type RunningManagedAgent = {
  id: string;
  layout: SubagentWorkspaceLayout;
  child: ReturnType<typeof spawnBrowseCli>;
  promise: Promise<unknown>;
};

const runningAgents = new Map<string, RunningManagedAgent>();
const closingAgents = new Set<string>();

function getAgentCacheKey(workspace: string, id: string): string {
  return `${path.resolve(workspace)}::${id}`;
}

function getManagedAgentLayout(
  workspace: string,
  id: string,
): SubagentWorkspaceLayout {
  return createSubagentWorkspaceLayout(workspace, id, path.join("agents", id));
}

function getRecordPath(layout: SubagentWorkspaceLayout): string {
  return path.join(layout.rootDir, "agent.json");
}

function parseJsonOutput(output: string): unknown {
  const text = output.trim();
  if (!text) {
    return null;
  }
  return JSON.parse(text);
}

async function writeAgentRecord(
  layout: SubagentWorkspaceLayout,
  record: ManagedAgentRecord,
): Promise<void> {
  await fs.mkdir(layout.rootDir, { recursive: true });
  await fs.writeFile(
    getRecordPath(layout),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
}

async function readAgentRecord(
  workspace: string,
  id: string,
): Promise<ManagedAgentRecord | null> {
  const layout = getManagedAgentLayout(workspace, id);
  try {
    const raw = await fs.readFile(getRecordPath(layout), "utf8");
    return ManagedAgentRecordSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function seedManagedAgentWorkspace(
  workspace: string,
  layout: SubagentWorkspaceLayout,
): Promise<void> {
  await ensureSubagentWorkspace(layout);
  const sourceSubagentDir = path.join(workspace, "subagent1");
  await copyStateFiles(sourceSubagentDir, layout.rootDir, [SUBAGENT_CONFIG_FILE]);
}

function buildForkedInstruction(
  contextEntries: Array<{ role: string; content: string }>,
  instruction: string,
): string {
  const context = contextEntries
    .map((entry) => `${entry.role.toUpperCase()}: ${entry.content.trim()}`)
    .join("\n\n");
  if (!context) {
    return instruction;
  }
  return [
    "Parent conversation context:",
    context,
    "",
    "Follow-up task:",
    instruction,
  ].join("\n");
}

function buildManagedAgentInstruction(instruction: string): string {
  return [
    "You are already running inside browse subagent.",
    "Use only the built-in browser/navigation/extraction tools available in this delegated subagent.",
    "Do not attempt to call functions_exec_command, shell commands, or browse CLI commands yourself.",
    "Complete the task directly with the browser tool surface you already have.",
    "",
    instruction,
  ].join("\n");
}

async function resolveManagedInstruction(
  workspace: string,
  input: SpawnExtraAgentArgs,
): Promise<string> {
  const instruction = input.fork_context
    ? buildForkedInstruction(
        await readRecentConversationEntries(workspace, RECENT_CONTEXT_LIMIT),
        input.instruction,
      )
    : input.instruction;

  return buildManagedAgentInstruction(instruction);
}

function spawnSubagentProcess(
  workspace: string,
  sessionId: string,
  instruction: string,
  configFlags: string[],
  maxSteps?: number,
): RunningManagedAgent["child"] {
  return spawnBrowseCli(
    [
      ...buildBrowseNamedSessionArgs(sessionId),
      "subagent",
      instruction,
      ...configFlags,
      "--max-steps",
      String(maxSteps ?? 20),
    ],
  );
}

export async function spawnManagedAgent(
  workspace: string,
  input: SpawnExtraAgentArgs,
): Promise<{ ok: true; id: string; status: "running" }> {
  const id = `agent-${randomUUID().slice(0, 8)}`;
  const layout = getManagedAgentLayout(workspace, id);
  await seedManagedAgentWorkspace(workspace, layout);

  const instruction = await resolveManagedInstruction(workspace, input);
  const config = await readSubagentConfig(layout);
  const record: ManagedAgentRecord = ManagedAgentRecordSchema.parse({
    id,
    status: "running",
    instruction,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  await writeAgentRecord(layout, record);

  const key = getAgentCacheKey(workspace, id);
  const child = spawnSubagentProcess(
    workspace,
    id,
    instruction,
    buildSubagentConfigFlags(config),
    input.maxSteps,
  );

  const promise = new Promise<unknown>((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", async (code: number | null) => {
      if (closingAgents.has(key)) {
        closingAgents.delete(key);
        runningAgents.delete(key);
        resolve(null);
        return;
      }

      if (code === 0) {
        try {
          const result = parseJsonOutput(stdout);
          const completed = ManagedAgentRecordSchema.parse({
            ...record,
            status: "completed",
            result,
            updated_at: new Date().toISOString(),
          });
          await writeAgentRecord(layout, completed);
          await appendJsonLog(layout, "agent.jsonl", {
            event: "completed",
            id,
            result,
          });
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          runningAgents.delete(key);
        }
        return;
      }

      const message = stderr.trim() || stdout.trim() || `browse exited with code ${code}`;
      const failed = ManagedAgentRecordSchema.parse({
        ...record,
        status: "failed",
        error: message,
        updated_at: new Date().toISOString(),
      });
      await writeAgentRecord(layout, failed);
      await appendJsonLog(layout, "agent.jsonl", {
        event: "failed",
        id,
        error: message,
      });
      runningAgents.delete(key);
      reject(new Error(message));
    });
  });

  runningAgents.set(key, { id, layout, child, promise });
  return { ok: true, id, status: "running" };
}

export async function waitForManagedAgents(
  workspace: string,
  input: WaitArgs,
): Promise<{
  ok: boolean;
  completed: boolean;
  timeout_ms: number;
  results: Array<{
    id: string;
    status: "completed" | "failed" | "running" | "closed" | "unknown";
    output?: unknown;
    error?: string;
  }>;
}> {
  const timeoutMs = input.timeout_ms ?? DEFAULT_WAIT_TIMEOUT_MS;
  const running = input.ids
    .map((id) => runningAgents.get(getAgentCacheKey(workspace, id)))
    .filter((value): value is RunningManagedAgent => Boolean(value));

  if (running.length > 0) {
    await Promise.race([
      Promise.allSettled(running.map((entry) => entry.promise)),
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      }),
    ]);
  }

  const results = await Promise.all(
    input.ids.map(async (id) => {
      const live = runningAgents.get(getAgentCacheKey(workspace, id));
      if (live) {
        return { id, status: "running" as const };
      }

      const record = await readAgentRecord(workspace, id);
      if (!record) {
        return {
          id,
          status: "unknown" as const,
          error: `Unknown task id: ${id}`,
        };
      }

      if (record.status === "completed") {
        return {
          id,
          status: "completed" as const,
          output: record.result,
        };
      }

      if (record.status === "failed") {
        return {
          id,
          status: "failed" as const,
          error: record.error,
        };
      }

      return {
        id,
        status: record.status,
      };
    }),
  );

  const doneStatuses = ["completed", "failed", "closed", "unknown"];
  return {
    ok: results.every((result) => doneStatuses.includes(result.status)),
    completed: results.every((result) => doneStatuses.includes(result.status)),
    timeout_ms: timeoutMs,
    results,
  };
}

export async function closeManagedAgent(
  workspace: string,
  input: CloseAgentArgs,
): Promise<{ ok: boolean; id: string; status: "closed" | "not_found" }> {
  const layout = getManagedAgentLayout(workspace, input.id);
  const record = await readAgentRecord(workspace, input.id);
  if (!record) {
    return { ok: false, id: input.id, status: "not_found" };
  }

  const running = runningAgents.get(getAgentCacheKey(workspace, input.id));
  if (running) {
    closingAgents.add(getAgentCacheKey(workspace, input.id));
    running.child.kill("SIGTERM");
    runningAgents.delete(getAgentCacheKey(workspace, input.id));
  }

  await runBrowseCli(
    [...buildBrowseNamedSessionArgs(input.id), "stop", "--force"],
  ).catch((): undefined => undefined);

  const closed = ManagedAgentRecordSchema.parse({
    ...record,
    status: "closed",
    updated_at: new Date().toISOString(),
  });
  await writeAgentRecord(layout, closed);
  return { ok: true, id: input.id, status: "closed" };
}

export async function closeAllManagedAgents(workspace: string): Promise<void> {
  const running = [...runningAgents.values()].filter((entry) =>
    entry.layout.rootDir.startsWith(path.resolve(workspace)),
  );
  await Promise.all(
    running.map(async (entry): Promise<void> => {
      closingAgents.add(getAgentCacheKey(workspace, entry.id));
      entry.child.kill("SIGTERM");
      runningAgents.delete(getAgentCacheKey(workspace, entry.id));
      await runBrowseCli(
        [...buildBrowseNamedSessionArgs(entry.id), "stop", "--force"],
      ).catch((): undefined => undefined);
    }),
  );
}
