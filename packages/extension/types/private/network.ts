import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "../../understudy/cdp.js";
import type { SessionNetworkCapture } from "../../understudy/sessionNetworkCapture.js";
import type { Response } from "../../understudy/response.js";

export type NetworkRequestInfo = {
  sessionId: string;
  requestId: string;
  requestKey: string;
  frameId?: string;
  loaderId?: string;
  url?: string;
  timestamp: number;
  resourceType?: Protocol.Network.ResourceType;
  documentRequest: boolean;
};

export type TrackedSession = {
  session: CDPSessionLike;
  capture: SessionNetworkCapture;
  childMainFrameId?: string;
  unfinishedRequests: Map<string, NetworkRequestInfo>;
  detach: () => void;
};

export type PendingDocumentCompletion = {
  session: CDPSessionLike;
  frameId: string;
  requestId: string;
  error: Error | null;
  requestRetired?: boolean;
};

export type DocumentIdentity = {
  requestId: string;
  loaderId?: string;
  frameId?: string;
};

export interface NetworkObserver {
  onRequestStarted?(info: NetworkRequestInfo): void;
  onRequestFinished?(info: NetworkRequestInfo): void;
  onRequestFailed?(info: NetworkRequestInfo): void;
  onResponse?(response: Response): void;
}

export type WaitForIdleOptions = {
  startTime?: number;
  timeout: number;
  idleTimeMs?: number;
  filter?: (info: NetworkRequestInfo) => boolean;
  totalBudgetMs?: number;
};

export const DEFAULT_IDLE_WAIT = 500;
export const IGNORED_RESOURCE_TYPES = new Set<Protocol.Network.ResourceType | undefined>([
  "EventSource",
  "WebSocket",
]);

export type WaitForIdleHandle = {
  promise: Promise<void>;
  dispose: () => void;
};
