export type V4TaskStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface V4Metadata {
  requestId: string;
  timestamp: string;
  version: "v4";
  serviceMode: {
    understudy: string;
  };
}

export interface V4ResponseEnvelope<TResult = unknown> {
  id: string;
  error: null | {
    message: string;
    code?: string;
    details?: unknown;
  };
  result: TResult;
  metadata: V4Metadata;
}

export interface V4BrowserRecord {
  id: string;
  apiSessionId: string;
  sessionId: string;
  browserMode: "local" | "remote" | "browserbase";
  modelName: string;
  llmId?: string;
  region: string;
  status: "running" | "stopped";
  launchedAt: string;
  exitedAt: string | null;
  cdpUrl: string;
  browserVersion: string | null;
  browserName: string | null;
  publicIpAddress: string | null;
  memoryUsage: string | null;
  cpuUsage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface V4SessionRecord {
  id: string;
  browserId: string;
  modelName: string;
  llmId?: string;
  status: "initializing" | "running" | "failed";
  createdAt: string;
  updatedAt: string;
}

export interface V4LLMRecord {
  id: string;
  clientType: "aisdk" | "custom";
  mode: "dom" | "hybrid" | "cua";
  modelName: string;
  modelApiKey?: string;
  provider?: string;
  baseURL?: string;
  clientOptions?: Record<string, unknown>;
  status: "ready" | "failed";
  createdAt: string;
  updatedAt: string;
}

export interface V4AgentTaskRecord {
  id: string;
  status: V4TaskStatus;
  createdAt: string;
  updatedAt: string;
  instruction: string;
  output?: string;
  actions?: unknown[];
  result?: unknown;
  error?: string;
  resumeAt?: string;
}

export interface V4AgentRecord {
  id: string;
  status: V4TaskStatus;
  createdAt: string;
  updatedAt: string;
  browserId?: string;
  pageId?: string;
  llmId?: string;
  instruction?: string;
  agentConfig?: Record<string, unknown>;
  tasks: Record<string, V4AgentTaskRecord>;
}

export interface V4StagehandStepRecord {
  stepId: string;
  kind: "act" | "observe" | "extract";
  status: V4TaskStatus;
  browserId: string;
  pageId?: string;
  createdAt: string;
  updatedAt: string;
  result?: unknown;
  error?: string;
  logs?: string[];
}

export interface V4UnderstudyStepRecord {
  stepId: string;
  kind:
    | "act"
    | "click"
    | "fill"
    | "type"
    | "press"
    | "scroll"
    | "scrollIntoView"
    | "scrollByPixelOffset"
    | "mouseWheel"
    | "nextChunk"
    | "prevChunk"
    | "selectOptionFromDropdown"
    | "hover"
    | "doubleClick"
    | "dragAndDrop"
    | "screenshot";
  status: V4TaskStatus;
  browserId: string;
  pageId: string;
  createdAt: string;
  updatedAt: string;
  result?: unknown;
  error?: string;
}
