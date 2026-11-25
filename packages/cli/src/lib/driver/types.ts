export type ConnectionTarget =
  | {
      chromeArgs?: string[];
      ignoreDefaultArgs?: boolean | string[];
      kind: "managed-local";
      headless: boolean;
    }
  | { kind: "remote"; verified?: boolean; proxies?: boolean }
  | { kind: "auto-connect" }
  | { kind: "cdp"; endpoint: string; targetId?: string };

export type RemoteConnectionTarget = Extract<ConnectionTarget, { kind: "remote" }>;

export interface BrowserbaseIdentity {
  browserbaseSessionId?: string;
  browserbaseSessionUrl?: string;
  browserbaseDebugUrl?: string;
}

export interface PageSummary {
  index: number;
  targetId?: string;
  title?: string;
  url: string;
}

export interface DriverStatus extends BrowserbaseIdentity {
  browserConnected: boolean;
  initError?: string;
  initialized: boolean;
  mode: ConnectionTarget["kind"];
  pages: PageSummary[];
  pid: number;
  selectedTargetId?: string;
  session: string;
  target: ConnectionTarget;
  title?: string;
  url?: string;
}

export interface OpenResult extends BrowserbaseIdentity {
  mode: ConnectionTarget["kind"];
  pages: PageSummary[];
  selectedTargetId?: string;
  session: string;
  title: string;
  url: string;
}
