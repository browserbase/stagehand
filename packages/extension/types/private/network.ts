import type { Protocol } from "devtools-protocol";
import type { Response } from "../../understudy/response.js";

/** Metadata tracked for each network request currently in-flight. */
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

/** Consumers implement only the network transitions they need. */
export interface NetworkObserver {
  onRequestStarted?(info: NetworkRequestInfo): void;
  onRequestFinished?(info: NetworkRequestInfo): void;
  onRequestFailed?(info: NetworkRequestInfo): void;
  onResponse?(response: Response): void;
}

/** Options for the idle waiter helper. */
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

/** The handle returned by the network manager idle helper. */
export type WaitForIdleHandle = {
  promise: Promise<void>;
  dispose: () => void;
};
