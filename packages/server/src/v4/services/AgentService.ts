import { StatusCodes } from "http-status-codes";

import { AppError } from "../../lib/errorHandler.js";
import {
  AgentCreateEvent,
  AgentGetEvent,
  AgentListEvent,
  AgentTaskCreateEvent,
  AgentTaskModifyEvent,
} from "../events.js";
import type { V4AgentRecord, V4AgentTaskRecord } from "../types.js";
import {
  getStagehandForBrowser,
  nowIso,
  resolveBrowserOrThrow,
  resolvePageForAction,
  type ServiceDeps,
} from "./base.js";

export class AgentService {
  constructor(private readonly deps: ServiceDeps) {
    this.deps.bus.on(AgentListEvent, this.onAgentListEvent.bind(this));
    this.deps.bus.on(AgentCreateEvent, this.onAgentCreateEvent.bind(this));
    this.deps.bus.on(AgentGetEvent, this.onAgentGetEvent.bind(this));
    this.deps.bus.on(
      AgentTaskCreateEvent,
      this.onAgentTaskCreateEvent.bind(this),
    );
    this.deps.bus.on(
      AgentTaskModifyEvent,
      this.onAgentTaskModifyEvent.bind(this),
    );
  }

  private async executeTask(input: {
    agentId: string;
    taskId: string;
    instruction: string;
    browserId?: string;
    sessionId?: string;
    pageId?: string;
    modelApiKey?: string;
    agentConfig?: Record<string, unknown>;
  }): Promise<{
    agent: V4AgentRecord;
    task: V4AgentTaskRecord;
    output?: string;
    actions?: unknown[];
    rawResult?: unknown;
  }> {
    const agent = this.deps.state.getAgent(input.agentId);
    if (!agent) {
      throw new AppError(`Agent not found: ${input.agentId}`, StatusCodes.NOT_FOUND);
    }

    const browser = resolveBrowserOrThrow(
      this.deps.state,
      input.browserId ?? agent.browserId,
      input.sessionId,
    );

    const stagehand = await getStagehandForBrowser(
      this.deps,
      browser,
      input.modelApiKey,
    );

    const page = await resolvePageForAction(stagehand, {
      pageId: input.pageId ?? agent.pageId,
    });

    const taskRunning = this.deps.state.updateAgentTask({
      agentId: input.agentId,
      taskId: input.taskId,
      updater: (task) => ({
        ...task,
        status: "running",
        updatedAt: nowIso(),
      }),
      statusAfter: "running",
    });

    try {
      const mergedAgentConfig = {
        ...(agent.agentConfig ?? {}),
        ...(input.agentConfig ?? {}),
      };

      const executionResult = await stagehand
        .agent(mergedAgentConfig as any)
        .execute({
        instruction: input.instruction,
        page,
      } as any);

      const rawResult: unknown =
        executionResult &&
        typeof executionResult === "object" &&
        "result" in executionResult &&
        executionResult.result instanceof Promise
          ? await executionResult.result
          : executionResult;

      const output =
        typeof (rawResult as { output?: unknown } | undefined)?.output ===
        "string"
          ? ((rawResult as { output?: string }).output ?? undefined)
          : typeof (rawResult as { message?: unknown } | undefined)?.message ===
              "string"
            ? ((rawResult as { message?: string }).message ?? undefined)
            : undefined;

      const actions = Array.isArray(
        (rawResult as { actions?: unknown[] } | undefined)?.actions,
      )
        ? ((rawResult as { actions?: unknown[] }).actions ?? undefined)
        : undefined;

      const completedTask = this.deps.state.updateAgentTask({
        agentId: input.agentId,
        taskId: taskRunning.id,
        updater: (task) => ({
          ...task,
          status: "completed",
          updatedAt: nowIso(),
          output,
          actions,
          result: rawResult,
          error: undefined,
        }),
        statusAfter: "completed",
      });

      const updatedAgent = this.deps.state.getAgent(input.agentId);
      if (!updatedAgent) {
        throw new AppError(`Agent not found: ${input.agentId}`, StatusCodes.NOT_FOUND);
      }

      return {
        agent: updatedAgent,
        task: completedTask,
        output,
        actions,
        rawResult,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      const failedTask = this.deps.state.updateAgentTask({
        agentId: input.agentId,
        taskId: taskRunning.id,
        updater: (task) => ({
          ...task,
          status: "failed",
          updatedAt: nowIso(),
          error: message,
        }),
        statusAfter: "failed",
      });

      const updatedAgent = this.deps.state.getAgent(input.agentId);
      if (!updatedAgent) {
        throw new AppError(`Agent not found: ${input.agentId}`, StatusCodes.NOT_FOUND);
      }

      return {
        agent: updatedAgent,
        task: failedTask,
        output: undefined,
        actions: undefined,
        rawResult: undefined,
      };
    }
  }

  private async onAgentListEvent(): Promise<{ agents: V4AgentRecord[] }> {
    return {
      agents: this.deps.state.listAgents(),
    };
  }

  private async onAgentCreateEvent(
    event: ReturnType<typeof AgentCreateEvent>,
  ): Promise<{
    agent: V4AgentRecord;
    task: V4AgentTaskRecord;
    output?: string;
    actions?: unknown[];
    rawResult?: unknown;
  }> {
    const payload = event as unknown as {
      agentId?: string;
      taskId?: string;
      instruction: string;
      agentConfig?: Record<string, unknown>;
      llmId?: string;
      sessionId?: string;
      browserId?: string;
      pageId?: string;
      modelApiKey?: string;
    };

    const browser = resolveBrowserOrThrow(
      this.deps.state,
      payload.browserId,
      payload.sessionId,
    );
    const agent = this.deps.state.createAgent({
      id: payload.agentId,
      instruction: payload.instruction,
      browserId: browser.id,
      pageId: payload.pageId,
      llmId: payload.llmId,
      agentConfig: payload.agentConfig,
    });

    const task = this.deps.state.createAgentTask({
      agentId: agent.id,
      id: payload.taskId,
      instruction: payload.instruction,
    });

    return this.executeTask({
      agentId: agent.id,
      taskId: task.id,
      instruction: payload.instruction,
      browserId: browser.id,
      pageId: payload.pageId,
      modelApiKey: payload.modelApiKey,
      agentConfig: payload.agentConfig,
    });
  }

  private async onAgentGetEvent(
    event: ReturnType<typeof AgentGetEvent>,
  ): Promise<{ agent: V4AgentRecord }> {
    const payload = event as unknown as { agentId: string };
    const agent = this.deps.state.getAgent(payload.agentId);
    if (!agent) {
      throw new AppError(`Agent not found: ${payload.agentId}`, StatusCodes.NOT_FOUND);
    }
    return { agent };
  }

  private async onAgentTaskCreateEvent(
    event: ReturnType<typeof AgentTaskCreateEvent>,
  ): Promise<{
    agent: V4AgentRecord;
    task: V4AgentTaskRecord;
    output?: string;
    actions?: unknown[];
    rawResult?: unknown;
  }> {
    const payload = event as unknown as {
      agentId: string;
      taskId?: string;
      instruction: string;
      agentConfig?: Record<string, unknown>;
      browserId?: string;
      sessionId?: string;
      pageId?: string;
      modelApiKey?: string;
    };

    const agent = this.deps.state.getAgent(payload.agentId);
    if (!agent) {
      throw new AppError(`Agent not found: ${payload.agentId}`, StatusCodes.NOT_FOUND);
    }

    const task = this.deps.state.createAgentTask({
      agentId: agent.id,
      id: payload.taskId,
      instruction: payload.instruction,
    });

    return this.executeTask({
      agentId: agent.id,
      taskId: task.id,
      instruction: payload.instruction,
      browserId: payload.browserId ?? agent.browserId,
      sessionId: payload.sessionId,
      pageId: payload.pageId ?? agent.pageId,
      modelApiKey: payload.modelApiKey,
      agentConfig: payload.agentConfig,
    });
  }

  private async onAgentTaskModifyEvent(
    event: ReturnType<typeof AgentTaskModifyEvent>,
  ): Promise<{ agent: V4AgentRecord; task: V4AgentTaskRecord }> {
    const payload = event as unknown as {
      agentId: string;
      taskId: string;
      method: "pause" | "resume" | "cancel";
      resumeAt?: string;
    };

    const targetStatus =
      payload.method === "pause"
        ? "paused"
        : payload.method === "resume"
          ? "running"
          : "cancelled";

    const task = this.deps.state.updateAgentTask({
      agentId: payload.agentId,
      taskId: payload.taskId,
      updater: (current) => ({
        ...current,
        status: targetStatus,
        updatedAt: nowIso(),
        resumeAt: payload.resumeAt,
      }),
      statusAfter: targetStatus,
    });

    const agent = this.deps.state.getAgent(payload.agentId);
    if (!agent) {
      throw new AppError(`Agent not found: ${payload.agentId}`, StatusCodes.NOT_FOUND);
    }

    return { agent, task };
  }
}
