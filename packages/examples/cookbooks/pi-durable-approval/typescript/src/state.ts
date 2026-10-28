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
  confirmed: boolean;
};

export interface Store {
  read(): Promise<State>;
  update(change: (state: State) => void): Promise<void>;
}

export const initialState = (): State => ({ browser: null, decision: null, confirmed: false });

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

export function approveOrder(state: State, id: string, actual: Record<string, string>) {
  if (!state.decision || state.decision.id !== id) throw new Error("Unknown decision ID");
  if (fingerprint(actual) !== fingerprint(state.decision.values))
    throw new Error("Form changed. Request fresh approval.");
  decide(state, id, "approved");
}

export function progress(state: State) {
  if (state.confirmed)
    return {
      phase: "confirmed",
      nextAction:
        "Run pnpm --filter stagehand-cookbook-pi-durable-approval start cleanup to release the browser.",
    };
  if (state.decision?.status === "rejected")
    return {
      phase: "rejected",
      nextAction:
        "Run pnpm --filter stagehand-cookbook-pi-durable-approval start cleanup. The order was not submitted by the agent.",
    };
  if (state.decision?.status === "pending")
    return {
      phase: "awaiting_approval",
      nextAction:
        "Run pnpm --filter stagehand-cookbook-pi-durable-approval start resume to review the saved proposal.",
    };
  if (state.decision?.status === "approved")
    return {
      phase: "awaiting_human_submission",
      nextAction:
        "Run pnpm --filter stagehand-cookbook-pi-durable-approval start resume, submit in Live View, then type Done.",
    };
  if (state.decision?.status === "returned")
    return {
      phase: "awaiting_verification",
      nextAction:
        "Run pnpm --filter stagehand-cookbook-pi-durable-approval start resume to verify the human's submission.",
    };
  return {
    phase: "preparing",
    nextAction:
      "Run pnpm --filter stagehand-cookbook-pi-durable-approval start resume to continue preparing the proposal.",
  };
}
