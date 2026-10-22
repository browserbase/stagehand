import { createHash, randomUUID } from "node:crypto";

export type Decision = {
  id: string;
  reason: string;
  status: "pending" | "returned" | "approved" | "rejected";
  values: Record<string, string>;
};

export type State = {
  browser: { sessionId: string; expiresAt: number } | null;
  decision: Decision | null;
  attempted: boolean;
  confirmed: boolean;
};

export interface Store {
  read(): Promise<State>;
  update(change: (state: State) => void): Promise<void>;
}

export const initialState = (): State => ({
  browser: null,
  decision: null,
  attempted: false,
  confirmed: false,
});

export function requestDecision(
  state: State,
  reason: string,
  values: Record<string, string> = {},
  id: string = randomUUID(),
) {
  if (state.decision?.id === id || state.decision?.status === "pending") return state.decision;
  state.decision = { id, reason, values, status: "pending" };
  return state.decision;
}

export function decide(state: State, id: string, status: Decision["status"]) {
  if (!state.decision || state.decision.id !== id) throw new Error("Unknown decision ID");
  if (state.decision.status === status) return;
  if (
    state.decision.status !== "pending" &&
    !(state.decision.status === "approved" && status === "returned")
  )
    throw new Error("This decision is already settled");
  if (status === "pending") throw new Error("Choose a decision");
  state.decision.status = status;
}

export function fingerprint(values: Record<string, string>) {
  return createHash("sha256")
    .update(
      JSON.stringify(Object.entries(values).sort(([left], [right]) => left.localeCompare(right))),
    )
    .digest("hex");
}

export function authorizeSubmit(state: State, actual: Record<string, string>) {
  if (state.attempted) throw new Error("Submission already attempted. Reconcile; do not retry.");
  if (state.decision?.status !== "approved") throw new Error("Explicit approval is required");
  if (fingerprint(actual) !== fingerprint(state.decision.values)) {
    throw new Error("Form changed. A new approval is required.");
  }
}
