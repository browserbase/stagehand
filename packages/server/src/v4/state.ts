import { randomUUID } from "crypto";

import type {
  V4AgentRecord,
  V4AgentTaskRecord,
  V4BrowserRecord,
  V4LLMRecord,
  V4SessionRecord,
  V4StagehandStepRecord,
  V4TaskStatus,
  V4UnderstudyStepRecord,
} from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function toRecord<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

export class V4State {
  private readonly sessions = new Map<string, V4SessionRecord>();
  private readonly browsers = new Map<string, V4BrowserRecord>();
  private readonly llms = new Map<string, V4LLMRecord>();
  private readonly agents = new Map<string, V4AgentRecord>();
  private readonly stagehandSteps = new Map<string, V4StagehandStepRecord>();
  private readonly understudySteps = new Map<string, V4UnderstudyStepRecord>();

  listBrowsers(): V4BrowserRecord[] {
    return [...this.browsers.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  getBrowser(browserId: string): V4BrowserRecord | undefined {
    return this.browsers.get(browserId);
  }

  getBrowserByApiSessionId(apiSessionId: string): V4BrowserRecord | undefined {
    return this.listBrowsers().find((browser) => browser.apiSessionId === apiSessionId);
  }

  getFirstRunningBrowser(): V4BrowserRecord | undefined {
    return this.listBrowsers().find((browser) => browser.status === "running");
  }

  hasRunningBrowser(): boolean {
    return this.listBrowsers().some((browser) => browser.status === "running");
  }

  putBrowser(browser: V4BrowserRecord): void {
    this.browsers.set(browser.id, browser);
  }

  putSession(session: V4SessionRecord): void {
    this.sessions.set(session.id, session);
  }

  getSession(sessionId: string): V4SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): V4SessionRecord[] {
    return [...this.sessions.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  putLLM(llm: V4LLMRecord): void {
    this.llms.set(llm.id, llm);
  }

  getLLM(llmId: string): V4LLMRecord | undefined {
    return this.llms.get(llmId);
  }

  listLLMs(): V4LLMRecord[] {
    return [...this.llms.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  stopBrowser(browserId: string): V4BrowserRecord {
    const browser = this.browsers.get(browserId);
    if (!browser) {
      throw new Error(`Browser not found: ${browserId}`);
    }

    const updated: V4BrowserRecord = {
      ...browser,
      status: "stopped",
      exitedAt: nowIso(),
      updatedAt: nowIso(),
    };

    this.browsers.set(browserId, updated);
    return updated;
  }

  createAgent(input: {
    instruction?: string;
    browserId?: string;
    pageId?: string;
    llmId?: string;
    agentConfig?: Record<string, unknown>;
    id?: string;
  }): V4AgentRecord {
    const timestamp = nowIso();
    const agent: V4AgentRecord = {
      id: input.id ?? randomUUID(),
      status: "running",
      createdAt: timestamp,
      updatedAt: timestamp,
      browserId: input.browserId,
      pageId: input.pageId,
      llmId: input.llmId,
      instruction: input.instruction,
      agentConfig: input.agentConfig,
      tasks: {},
    };

    this.agents.set(agent.id, agent);
    return agent;
  }

  getAgent(agentId: string): V4AgentRecord | undefined {
    return this.agents.get(agentId);
  }

  listAgents(): V4AgentRecord[] {
    return [...this.agents.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  upsertAgent(agent: V4AgentRecord): void {
    this.agents.set(agent.id, agent);
  }

  createAgentTask(input: {
    agentId: string;
    id?: string;
    instruction: string;
  }): V4AgentTaskRecord {
    const agent = this.agents.get(input.agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${input.agentId}`);
    }

    const timestamp = nowIso();
    const task: V4AgentTaskRecord = {
      id: input.id ?? randomUUID(),
      instruction: input.instruction,
      status: "running",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const updatedAgent: V4AgentRecord = {
      ...agent,
      status: "running",
      updatedAt: timestamp,
      tasks: {
        ...agent.tasks,
        [task.id]: task,
      },
    };

    this.agents.set(agent.id, updatedAgent);
    return task;
  }

  updateAgentTask(input: {
    agentId: string;
    taskId: string;
    updater: (task: V4AgentTaskRecord) => V4AgentTaskRecord;
    statusAfter?: V4TaskStatus;
  }): V4AgentTaskRecord {
    const agent = this.agents.get(input.agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${input.agentId}`);
    }

    const existingTask = agent.tasks[input.taskId];
    if (!existingTask) {
      throw new Error(`Agent task not found: ${input.taskId}`);
    }

    const updatedTask = input.updater(existingTask);
    const updatedAgent: V4AgentRecord = {
      ...agent,
      status: input.statusAfter ?? agent.status,
      updatedAt: nowIso(),
      tasks: {
        ...agent.tasks,
        [updatedTask.id]: updatedTask,
      },
    };

    this.agents.set(agent.id, updatedAgent);
    return updatedTask;
  }

  putStagehandStep(step: V4StagehandStepRecord): void {
    this.stagehandSteps.set(step.stepId, step);
  }

  getStagehandStep(stepId: string): V4StagehandStepRecord | undefined {
    return this.stagehandSteps.get(stepId);
  }

  putUnderstudyStep(step: V4UnderstudyStepRecord): void {
    this.understudySteps.set(step.stepId, step);
  }

  getUnderstudyStep(stepId: string): V4UnderstudyStepRecord | undefined {
    return this.understudySteps.get(stepId);
  }

  snapshot(): {
    browsers: V4BrowserRecord[];
    llms: V4LLMRecord[];
    agents: V4AgentRecord[];
    stagehandSteps: V4StagehandStepRecord[];
    understudySteps: V4UnderstudyStepRecord[];
    agentTasksByAgent: Record<string, Record<string, V4AgentTaskRecord>>;
  } {
    const agents = this.listAgents();
    return {
      browsers: this.listBrowsers(),
      llms: this.listLLMs(),
      agents,
      stagehandSteps: [...this.stagehandSteps.values()],
      understudySteps: [...this.understudySteps.values()],
      agentTasksByAgent: Object.fromEntries(
        agents.map((agent) => [
          agent.id,
          toRecord(Object.values(agent.tasks)),
        ]),
      ),
    };
  }
}
