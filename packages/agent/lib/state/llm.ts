import fs from "node:fs/promises";
import path from "node:path";
import {
  getAISDKLanguageModel,
  type ClientOptions,
} from "@browserbasehq/stagehand";
import { z } from "zod/v4";
import type { AgentOptions, JsonObject } from "../protocol.js";
import { SESSION_LLM_FILE, SESSION_LOGS_DIR } from "./session.js";

export const LlmConfigSchema = z.object({
  modelName: z.string().optional(),
  clientOptions: z.record(z.string(), z.unknown()).optional(),
});

export type LlmConfig = z.infer<typeof LlmConfigSchema>;

export const LlmMessageLogEntrySchema = z.object({
  direction: z.enum(["request", "response"]),
  scope: z.string(),
  payload: z.unknown(),
  created_at: z.string(),
});

export type LlmMessageLogEntry = z.infer<typeof LlmMessageLogEntrySchema>;

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

export async function readLlmConfig(scopeDir: string): Promise<LlmConfig> {
  return await readJsonFile(
    path.join(scopeDir, SESSION_LLM_FILE),
    LlmConfigSchema,
    {},
  );
}

export async function writeLlmConfig(
  scopeDir: string,
  config: Partial<LlmConfig>,
): Promise<LlmConfig> {
  const existing = await readLlmConfig(scopeDir);
  const merged = LlmConfigSchema.parse({
    ...existing,
    ...config,
    clientOptions: {
      ...existing.clientOptions,
      ...config.clientOptions,
    },
  });
  await writeJsonFile(path.join(scopeDir, SESSION_LLM_FILE), merged);
  return merged;
}

export async function resolveTopLevelLlmConfig(
  workspace: string,
  options: Pick<AgentOptions, "modelName" | "clientOptions">,
): Promise<{ modelName: string; clientOptions?: ClientOptions }> {
  const persisted = await readLlmConfig(workspace);
  return {
    modelName: persisted.modelName ?? options.modelName,
    clientOptions: (persisted.clientOptions ??
      options.clientOptions) as ClientOptions | undefined,
  };
}

export async function hydrateTopLevelLanguageModel(
  workspace: string,
  options: Pick<AgentOptions, "modelName" | "clientOptions">,
): Promise<{
  modelName: string;
  clientOptions?: ClientOptions;
  model: ReturnType<typeof getAISDKLanguageModel>;
}> {
  const resolved = await resolveTopLevelLlmConfig(workspace, options);
  const firstSlash = resolved.modelName.indexOf("/");
  if (firstSlash <= 0 || firstSlash >= resolved.modelName.length - 1) {
    throw new Error(
      `modelName must use provider/model format, received ${resolved.modelName}`,
    );
  }

  const provider = resolved.modelName.slice(0, firstSlash);
  const modelName = resolved.modelName.slice(firstSlash + 1);

  return {
    modelName: resolved.modelName,
    clientOptions: resolved.clientOptions,
    model: getAISDKLanguageModel(provider, modelName, resolved.clientOptions),
  };
}

export async function appendLlmMessageLog(
  scopeDir: string,
  entry: {
    direction: "request" | "response";
    scope: string;
    payload: JsonObject | string | unknown[];
  },
): Promise<void> {
  const logPath = path.join(scopeDir, SESSION_LOGS_DIR, "llm_messages.jsonl");
  const parsed = LlmMessageLogEntrySchema.parse({
    ...entry,
    created_at: new Date().toISOString(),
  });
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `${JSON.stringify(parsed)}\n`, "utf8");
}

export async function getBrowseCliEnv(
  workspace: string,
): Promise<Record<string, string>> {
  const persisted = await readLlmConfig(workspace);
  const env = { ...process.env } as Record<string, string>;
  const modelName = persisted.modelName;

  if (modelName && !env.BROWSE_MODEL) {
    env.BROWSE_MODEL = modelName;
  }
  if (modelName && !env.BROWSE_EXECUTION_MODEL) {
    env.BROWSE_EXECUTION_MODEL = modelName;
  }

  return env;
}
