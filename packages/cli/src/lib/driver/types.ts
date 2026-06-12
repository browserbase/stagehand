export type ConnectionTarget =
  | {
      chromeArgs?: string[];
      ignoreDefaultArgs?: boolean | string[];
      kind: "managed-local";
      headless: boolean;
    }
  | { kind: "remote" }
  | { kind: "auto-connect" }
  | { kind: "cdp"; endpoint: string; targetId?: string };

export interface PageSummary {
  index: number;
  targetId?: string;
  title?: string;
  url: string;
}

export interface DriverStatus {
  browserConnected: boolean;
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

export interface OpenResult {
  mode: ConnectionTarget["kind"];
  pages: PageSummary[];
  selectedTargetId?: string;
  session: string;
  title: string;
  url: string;
}
