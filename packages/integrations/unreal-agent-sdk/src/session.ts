import { spawn, type ChildProcess } from "node:child_process";
import { sanitizeErrorMessage } from "@browserbasehq/stagehand-integrations/harness";

export interface UnrealEvent {
  Sequence?: number;
  Kind?: string;
  Data?: unknown;
  type?: string;
  message?: string;
}

export interface UnrealToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status?: string;
  result?: string;
}

export interface UnrealUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface UnrealSessionResult {
  events: UnrealEvent[];
  toolCalls: UnrealToolCall[];
  finalMessage: string;
  status: "completed" | "sdk_error" | "aborted";
  stopReason?: string;
  tokenUsage: UnrealUsage;
  exitCode: number | null;
  iterationError?: unknown;
}

export interface UnrealProcessInput {
  bin: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  stdin: string;
  signal?: AbortSignal;
}

export type UnrealProcessRunner = (input: UnrealProcessInput) => Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  aborted: boolean;
}>;

export interface UnrealSessionInput {
  prompt: string;
  model: string;
  workspace: string;
  env: Record<string, string>;
  signal?: AbortSignal;
  bin?: string;
  runProcess?: UnrealProcessRunner;
  systemPrompt?: string;
}

const emptyUsage = (): UnrealUsage => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
});

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function normalizeUnrealModel(model: string): { provider: string; model: string } {
  const slash = model.indexOf("/");
  if (slash < 1) return { provider: "openai", model };
  const provider = model.slice(0, slash);
  const id = model.slice(slash + 1);
  if (!id || !["openai", "openrouter", "fireworks", "ollama", "openai-codex"].includes(provider)) {
    throw new Error(`Unsupported Unreal Agent model: ${model}`);
  }
  return { provider, model: id };
}

export function parseUnrealEvents(
  stdout: string,
): Omit<UnrealSessionResult, "status" | "exitCode"> {
  const events: UnrealEvent[] = [];
  const toolCalls: UnrealToolCall[] = [];
  const byId = new Map<string, UnrealToolCall>();
  const usage = emptyUsage();
  let finalMessage = "";
  let stopReason: string | undefined;
  for (const [index, line] of stdout.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let event: UnrealEvent;
    try {
      event = JSON.parse(line) as UnrealEvent;
    } catch {
      throw new Error(`Invalid Unreal Agent JSONL at line ${index + 1}`);
    }
    if (!record(event)) throw new Error(`Invalid Unreal Agent event at line ${index + 1}`);
    events.push(event);
    if (event.type === "error") {
      stopReason = text(event.message) ?? "Unreal Agent error";
      continue;
    }
    const data = record(event.Data);
    if (event.Kind === "model_response") {
      const response = record(data?.Response);
      const output = response?.Output;
      if (Array.isArray(output)) {
        for (const rawItem of output) {
          const item = record(rawItem);
          const value = record(item?.Data);
          if (item?.Type === "message" && value?.Role === "assistant") {
            finalMessage = text(value.Text) ?? finalMessage;
          }
          if (item?.Type === "tool_call") {
            const id = text(value?.CallID);
            if (!id) continue;
            let args: Record<string, unknown> = {};
            try {
              args = record(JSON.parse(text(value?.Arguments) ?? "{}")) ?? {};
            } catch {
              args = { raw: text(value?.Arguments) ?? "" };
            }
            const call: UnrealToolCall = { id, name: text(value?.Name) ?? "unknown", args };
            toolCalls.push(call);
            byId.set(id, call);
          }
        }
      }
      const rawUsage = record(response?.Usage);
      usage.inputTokens += count(rawUsage?.InputTokens);
      usage.cachedInputTokens += count(rawUsage?.CachedInputTokens);
      usage.outputTokens += count(rawUsage?.OutputTokens);
      usage.reasoningOutputTokens += count(rawUsage?.ReasoningTokens);
    }
    if (event.Kind === "tool_call_status") {
      const call = byId.get(text(data?.CallID) ?? "");
      if (call) {
        const status = record(data?.Status);
        call.status = text(status?.Error) ? "error" : "submitted";
        call.result = text(status?.Error);
      }
    }
  }
  return { events, toolCalls, finalMessage, stopReason, tokenUsage: usage };
}

export const runUnrealProcess: UnrealProcessRunner = (input) =>
  new Promise((resolve, reject) => {
    if (input.signal?.aborted) {
      resolve({ stdout: "", stderr: "", exitCode: null, aborted: true });
      return;
    }
    let child: ChildProcess;
    try {
      child = spawn(input.bin, input.args, {
        cwd: input.cwd,
        env: input.env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = "";
    let stderr = "";
    let aborted = false;
    let timer: NodeJS.Timeout | undefined;
    const abort = () => {
      aborted = true;
      if (child.pid && process.platform !== "win32") {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      } else child.kill("SIGTERM");
      timer = setTimeout(() => {
        if (child.pid && process.platform !== "win32") {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        } else child.kill("SIGKILL");
      }, 2_000);
      timer.unref();
    };
    input.signal?.addEventListener("abort", abort, { once: true });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(input.stdin);
    child.once("error", (error) => {
      input.signal?.removeEventListener("abort", abort);
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode) => {
      input.signal?.removeEventListener("abort", abort);
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, aborted });
    });
  });

export async function runUnrealSession(input: UnrealSessionInput): Promise<UnrealSessionResult> {
  const { provider, model } = normalizeUnrealModel(input.model);
  const request = {
    prompt: input.prompt,
    model,
    ...(input.systemPrompt && { system_prompt: input.systemPrompt }),
    disallowed_tools: ["ViewImage", "SkillUse"],
  };
  let processResult;
  try {
    processResult = await (input.runProcess ?? runUnrealProcess)({
      bin: input.bin ?? process.env.EVAL_UNREAL_AGENT_PATH ?? "unreal-agent-runner",
      args: [
        "-workspace",
        input.workspace,
        "-session-directory",
        `${input.workspace}/sessions`,
        "-log-directory",
        `${input.workspace}/logs`,
      ],
      cwd: input.workspace,
      env: { ...input.env, UNREAL_HARNESS_LLM_PROVIDER: provider },
      stdin: JSON.stringify(request),
      signal: input.signal,
    });
  } catch (error) {
    return {
      events: [],
      toolCalls: [],
      finalMessage: "",
      status: "sdk_error",
      exitCode: null,
      tokenUsage: emptyUsage(),
      iterationError: error,
      stopReason: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
    };
  }
  let parsed;
  try {
    parsed = parseUnrealEvents(processResult.stdout);
  } catch (error) {
    return {
      events: [],
      toolCalls: [],
      finalMessage: "",
      status: "sdk_error",
      exitCode: processResult.exitCode,
      tokenUsage: emptyUsage(),
      iterationError: error,
      stopReason: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
    };
  }
  const status = processResult.aborted
    ? "aborted"
    : processResult.exitCode === 0 && !parsed.stopReason
      ? "completed"
      : "sdk_error";
  return {
    ...parsed,
    status,
    exitCode: processResult.exitCode,
    ...(status !== "completed" && {
      iterationError:
        processResult.stderr || parsed.stopReason || "Unreal Agent exited unsuccessfully",
    }),
    stopReason:
      parsed.stopReason ??
      (status === "sdk_error"
        ? sanitizeErrorMessage(processResult.stderr.trim() || `Exit code ${processResult.exitCode}`)
        : undefined),
  };
}
