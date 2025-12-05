import type { LogLine } from "../types/public";
import type { V3 } from "../v3";

export interface SessionStartResult {
  sessionId: string;
  available: boolean;
}

export interface CreateSessionParams {
  modelName: string;
  verbose?: 0 | 1 | 2;
  systemPrompt?: string;
  selfHeal?: boolean;
  domSettleTimeoutMs?: number;
  experimental?: boolean;
  browserbaseApiKey?: string;
  browserbaseProjectId?: string;
  browserbaseSessionID?: string;
  browserbaseSessionCreateParams?: Record<string, unknown>;
  waitForCaptchaSolves?: boolean;
  debugDom?: boolean;
  actTimeoutMs?: number;
  clientLanguage?: string;
  sdkVersion?: string;
}

export interface RequestContext {
  modelApiKey?: string;
  logger?: (message: LogLine) => void;
}

export interface SessionCacheConfig {
  maxCapacity?: number;
  ttlMs?: number;
}

export interface SessionStore {
  startSession(params: CreateSessionParams): Promise<SessionStartResult>;
  endSession(sessionId: string): Promise<void>;
  hasSession(sessionId: string): Promise<boolean>;
  getOrCreateStagehand(sessionId: string, ctx: RequestContext): Promise<V3>;
  createSession(sessionId: string, params: CreateSessionParams): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  updateCacheConfig?(config: SessionCacheConfig): void;
  getCacheConfig?(): SessionCacheConfig;
  destroy(): Promise<void>;
}

export interface StagehandServerOptions {
  port?: number;
  host?: string;
  sessionStore?: SessionStore;
}

export interface StagehandServerInstance {
  listen(port?: number): Promise<void>;
  close(): Promise<void>;
  getUrl(): string;
  getSessionStore(): SessionStore;
}
