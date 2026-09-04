"use agent";

import { randomUUID } from "node:crypto";
import {
  init,
  observe,
  useModel,
  useTool,
  type Agent,
  type FlueEvent,
  type PromptUsage,
  type ToolDefinition,
} from "@flue/runtime";
import { start } from "@flue/runtime/node";
import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import {
  sanitizeErrorMessage,
  type HarnessLogger,
} from "@browserbasehq/stagehand-integrations/harness";

export type FlueSessionEvent = FlueEvent;
export type FlueToolDefinition = ToolDefinition;

export function defineFlueJsonTool(input: {
  name: string;
  description: string;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}): ToolDefinition {
  return defineTool({
    name: input.name,
    description: input.description,
    input: v.looseObject({}),
    async run({ data }) {
      return { output: await input.execute(data) };
    },
  });
}

export interface FlueTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface FlueSessionResult {
  events: FlueSessionEvent[];
  finalMessage: string;
  status: "completed" | "max_turns" | "sdk_error";
  stopReason?: string;
  tokenUsage: FlueTokenUsage;
  iterationError?: unknown;
}

export interface FlueRuntimeLike {
  stop(): Promise<void>;
}

export type StartFlueRuntime = (options: { agents: Agent[] }) => Promise<FlueRuntimeLike>;

export async function runFlueSession(input: {
  prompt: string;
  model: string;
  logger: HarnessLogger;
  signal?: AbortSignal;
  session: {
    tools: ToolDefinition[];
    instructions: string;
    maxToolSteps?: number;
  };
  startRuntime?: StartFlueRuntime;
  onToolResult?: (toolName: string, event: FlueSessionEvent) => void | Promise<void>;
}): Promise<FlueSessionResult> {
  const instanceId = `stagehand-eval-${randomUUID()}`;
  const events: FlueSessionEvent[] = [];
  const maxToolSteps = positiveInteger(input.session.maxToolSteps, 50);
  let toolSteps = 0;
  let budgetExceeded = false;
  let notifications = Promise.resolve();
  let runtime: FlueRuntimeLike | undefined;
  let iterationError: unknown;
  let finalMessage = "";
  let stopReason: string | undefined;

  function StagehandEvalAgent() {
    useModel(input.model);
    for (const tool of input.session.tools) useTool(tool);
    return input.session.instructions;
  }

  const agent = init(StagehandEvalAgent, { id: instanceId });
  const unsubscribe = observe((event, context) => {
    if (context.id !== instanceId) return;
    events.push(event);
    logFlueEvent(input.logger, event);
    if (event.type !== "tool") return;
    toolSteps += 1;
    if (typeof event.toolName === "string") {
      notifications = notifications.then(() => input.onToolResult?.(event.toolName, event));
    }
    if (toolSteps >= maxToolSteps) {
      budgetExceeded = true;
      void agent.abort();
    }
  });
  const forwardAbort = (): void => {
    void agent.abort();
  };
  input.signal?.addEventListener("abort", forwardAbort, { once: true });

  try {
    runtime = await (input.startRuntime ?? (start as StartFlueRuntime))({
      agents: [StagehandEvalAgent],
    });
    if (input.signal?.aborted) {
      await agent.abort();
      stopReason = sanitizeErrorMessage(stringifyError(input.signal.reason) || "aborted");
    } else {
      const receipt = await agent.dispatch(input.prompt);
      const reply = await agent.read(receipt);
      finalMessage = reply.text;
    }
    await notifications;
  } catch (error) {
    iterationError = error;
    if (budgetExceeded) stopReason = `tool-step budget exhausted (${maxToolSteps} steps)`;
    else if (input.signal?.aborted) {
      stopReason = sanitizeErrorMessage(stringifyError(input.signal.reason) || "aborted");
    } else stopReason = sanitizeErrorMessage(stringifyError(error));
    input.logger.warn({
      category: "flue",
      message: `Flue stopped before a normal result: ${stopReason}`,
      level: 0,
    });
  } finally {
    input.signal?.removeEventListener("abort", forwardAbort);
    unsubscribe();
    await agent.abort().catch((): undefined => undefined);
    await runtime?.stop().catch((): undefined => undefined);
  }

  return {
    events,
    finalMessage,
    status: budgetExceeded ? "max_turns" : iterationError ? "sdk_error" : "completed",
    ...(stopReason && { stopReason }),
    tokenUsage: collectFlueUsage(events),
    ...(iterationError !== undefined && { iterationError }),
  };
}

export function collectFlueUsage(events: FlueSessionEvent[]): FlueTokenUsage {
  const total = emptyUsage();
  for (const event of events) {
    if (event.type !== "turn" || !event.response.usage) continue;
    addUsage(total, event.response.usage);
  }
  return total;
}

export function buildFlueTranscript(events: FlueSessionEvent[]): string {
  return events
    .map((event) => {
      if (event.type === "thinking_delta") return `[reasoning] ${event.delta}`;
      if (event.type === "text_delta") return event.text;
      if (event.type === "tool_start") {
        return `[tool ${event.toolName}] ${safeStringify(event.args ?? {})}`;
      }
      if (event.type === "tool") {
        return `[tool result ${event.toolName}] ${safeStringify(event.result)}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function addUsage(target: FlueTokenUsage, usage: PromptUsage): void {
  target.inputTokens += finite(usage.input);
  target.outputTokens += finite(usage.output);
  target.cachedInputTokens += finite(usage.cacheRead);
  target.cacheCreationInputTokens += finite(usage.cacheWrite);
  target.totalTokens += finite(usage.totalTokens);
  target.costUsd += finite(usage.cost?.total);
}

function emptyUsage(): FlueTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function logFlueEvent(logger: HarnessLogger, event: FlueSessionEvent): void {
  if (event.type === "text_delta" || event.type === "thinking_delta") return;
  logger.log({ category: "flue", message: `Flue event: ${event.type}`, level: 2 });
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function stringifyError(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return safeStringify(value);
}
