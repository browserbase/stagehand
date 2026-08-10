export type TargetKind =
  | "selector"
  | "coords"
  | "snapshot_ref"
  | "role_name"
  | "text"
  | "focused";

export type FocusedTarget = { kind: "focused" };

export type ActionTarget =
  | { kind: "selector"; value: string }
  | { kind: "coords"; x: number; y: number }
  | { kind: "snapshot_ref"; value: string }
  | { kind: "role_name"; role: string; name?: string }
  | { kind: "text"; text: string };

export type WaitSpec =
  | {
      kind: "selector";
      selector: string;
      timeoutMs?: number;
      state?: "attached" | "detached" | "visible" | "hidden";
    }
  | {
      kind: "timeout";
      timeoutMs: number;
    }
  | {
      kind: "load_state";
      state: "load" | "domcontentloaded" | "networkidle";
      timeoutMs?: number;
    };
