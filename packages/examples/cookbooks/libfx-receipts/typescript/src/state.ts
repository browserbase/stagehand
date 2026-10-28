import { randomUUID } from "node:crypto";

export type Decision = {
  id: string;
  reason: string;
  status: "pending" | "returned" | "approved" | "rejected";
  values: Record<string, string>;
};

export type State = {
  browser: { sessionId: string; expiresAt: number } | null;
  decision: Decision | null;
  calls: number;
  sources: string[];
  receipts: { url: string; records: Record<string, string>[] }[];
};

export interface Store {
  read(): Promise<State>;
  update(change: (state: State) => void): Promise<void>;
}

export const initialState = (): State => ({
  browser: null,
  decision: null,
  calls: 0,
  sources: [],
  receipts: [],
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

export function assertBrowserControl(state: State) {
  if (state.decision?.status === "pending")
    throw new Error("Human owns the browser. Return control first.");
}

export function reserveBrowserCall(state: State, executionId: string) {
  assertBrowserControl(state);
  if (state.calls >= 20) {
    requestDecision(
      state,
      "Browser work limit reached. Inspect the current page in Live View, then return control to continue the saved task.",
      {},
      `limit:${executionId}`,
    );
    return false;
  }
  state.calls++;
  return true;
}

export function returnControl(state: State, id: string) {
  const pending = state.decision?.status === "pending";
  decide(state, id, "returned");
  if (pending) state.calls = 0;
}

export function progress(state: State) {
  const pendingSources = state.sources.filter(
    (url) => !state.receipts.some((entry) => entry.url === url),
  );
  const completedSources = state.sources.length - pendingSources.length;
  const counts = { completedSources, pendingSources };
  if (state.decision?.status === "pending")
    return {
      ...counts,
      phase: "awaiting_human",
      nextAction:
        "Run pnpm --filter stagehand-cookbook-libfx-receipts start resume, complete the human step in Live View, then type Done.",
    };
  if (state.sources.length === 0)
    return {
      ...counts,
      phase: "not_started",
      nextAction: "Set RECEIPT_URLS and run pnpm --filter stagehand-cookbook-libfx-receipts start.",
    };
  if (pendingSources.length === 0)
    return {
      ...counts,
      phase: "complete",
      nextAction:
        "Run pnpm --filter stagehand-cookbook-libfx-receipts start cleanup to release the browser.",
    };
  return {
    ...counts,
    phase: "collecting",
    nextAction:
      "Run pnpm --filter stagehand-cookbook-libfx-receipts start resume to continue incomplete sources. Saved receipts will be reused.",
  };
}
