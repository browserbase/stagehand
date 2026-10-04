import type { Trajectory, TrajectoryStep } from "./types.js";

export interface BrowserUse {
  used: boolean;
  rule: "recorded-server" | "legacy-name" | "none";
  stepIndex?: number;
}

function serverIdentity(step: TrajectoryStep): string | undefined {
  const args = step.actionArgs ?? {};
  for (const key of ["providerIdentifier", "serverName", "server", "mcpServer"]) {
    if (typeof args[key] === "string") return args[key];
  }
  return undefined;
}

/** Only old traces without server identity use names; bare `mcp` alone proves nothing. */
export function detectBrowserUse(steps: TrajectoryStep[]): BrowserUse {
  for (const [stepIndex, step] of steps.entries()) {
    if (step.toolOutput?.ok !== true) continue;
    const server = serverIdentity(step);
    if (server && /^(?:mcp__)?stagehand(?:[-_.:].*)?$/i.test(server))
      return { used: true, rule: "recorded-server", stepIndex };
  }
  for (const [stepIndex, step] of steps.entries()) {
    if (step.toolOutput?.ok !== true || serverIdentity(step)) continue;
    if (
      /^(?:run|snapshot|screenshot)$/.test(step.actionName) ||
      /(?:^|[.:_-])stagehand[.:_-]+(?:stagehand[-_])?(?:run|snapshot|screenshot)$/.test(
        step.actionName,
      )
    ) {
      return { used: true, rule: "legacy-name", stepIndex };
    }
  }
  return { used: false, rule: "none" };
}

export type FailureClass =
  | "browser_session_lost"
  | "step_budget"
  | "clarification_no_action"
  | "site_blocked"
  | "prompt_contract"
  /** Judge established from recorded site state that the goal could not be achieved (item not sold, out of stock, no online purchase). */
  | "goal_unachievable";
export interface ExecutionIssue {
  failureClass: FailureClass;
  stepIndex?: number;
  source: "tool-error" | "termination-reason" | "final-answer" | "judge";
}

export function executionIssues(trajectory: Trajectory): ExecutionIssue[] {
  const issues: ExecutionIssue[] = [];
  for (const [stepIndex, step] of trajectory.steps.entries()) {
    const text = [step.toolOutput?.error, JSON.stringify(step.toolOutput?.result)]
      .filter(Boolean)
      .join("\n");
    if (
      /Browser session lost|CDP (?:connection )?(?:closed|disconnected)|close(?:d| code)?[^\n]{0,15}1006/i.test(
        text,
      )
    ) {
      issues.push({ failureClass: "browser_session_lost", stepIndex, source: "tool-error" });
    } else if (
      step.toolOutput?.ok === false &&
      /captcha|bot.?wall|access denied|blocked by/i.test(text)
    ) {
      issues.push({ failureClass: "site_blocked", stepIndex, source: "tool-error" });
    }
  }
  const reason = trajectory.terminationReason ?? "";
  if (/step.?budget|max.?steps|step.?limit/i.test(reason))
    issues.push({ failureClass: "step_budget", source: "termination-reason" });
  if (
    /browser.?session.?lost/i.test(reason) &&
    !issues.some((x) => x.failureClass === "browser_session_lost")
  ) {
    issues.push({ failureClass: "browser_session_lost", source: "termination-reason" });
  }
  if (/prompt.?contract|result.?parse/i.test(reason))
    issues.push({ failureClass: "prompt_contract", source: "termination-reason" });
  if (
    !detectBrowserUse(trajectory.steps).used &&
    /(?:could|can|would) you (?:clarify|provide|confirm)|which .{0,80}\?|please (?:clarify|provide|confirm)/i.test(
      trajectory.finalAnswer ?? "",
    )
  ) {
    issues.push({ failureClass: "clarification_no_action", source: "final-answer" });
  }
  return issues;
}
