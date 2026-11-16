import type { Action, ActResultData, Variables } from "@browserbasehq/stagehand-protocol/types";
import type { StagehandLogger } from "../../logger.js";
import type { Page } from "../../understudy/page.js";
import type { Progress } from "../../understudy/progress.js";
import { resolveLocatorWithHops } from "../../understudy/deepLocator.js";
import { trimTrailingTextNode } from "../../utils.js";
import { actionNodes, choosePlan, evidence } from "./actionPlans.js";
import { readFacts } from "./actionFacts.js";
import { checkSelectedTarget } from "./actionTarget.js";
import { redactor, substituteVariables } from "./args.js";
import { ACTION_CONFIDENCE, type DecisionsConfig } from "./config.js";

export type DecisionsActDeps = {
  page: Page;
  logger: StagehandLogger;
  instruction: string;
  variables?: Variables;
  snapshotOptions: Parameters<Page["captureSnapshot"]>[0];
  progress: Progress;
  takeAction: (action: Action, expectedElementId?: string) => Promise<ActResultData>;
};
export type DecisionsActOutcome =
  | { kind: "done"; result: ActResultData; noCache?: boolean }
  | { kind: "fallback"; reason: string };

export async function runDecisionsAct(
  config: DecisionsConfig,
  deps: DecisionsActDeps,
): Promise<DecisionsActOutcome> {
  const trace: Record<string, unknown>[] = [];
  let attempted: Action | undefined;
  const failure = (reason: string, actions: Action[] = []): DecisionsActOutcome => ({
    kind: "done",
    noCache: true,
    result: { success: false, message: reason, actionDescription: deps.instruction, actions },
  });
  try {
    const snapshot = await deps.page.captureSnapshot(deps.snapshotOptions, deps.progress);
    const facts = await deps.progress.run("reading action evidence", () =>
      deps.page.evaluate(readFacts, snapshot.combinedXpathMap),
    );
    const view = {
      formattedTree: snapshot.combinedTree,
      xpathMap: snapshot.combinedXpathMap,
      urlMap: snapshot.combinedUrlMap,
      facts,
      editableIds: snapshot.combinedEditableIds ?? [],
      url: deps.page.url(),
    };
    deps.progress.throwIfStopped();
    const selected = await choosePlan(config, view, deps.instruction, {
      variables: deps.variables,
      threshold: ACTION_CONFIDENCE,
    });
    trace.push({
      node: "action_plan",
      ms: selected.response?.durationMs ?? 0,
      options: selected.plans.length,
      confidence: selected.confidence,
      accepted: !!selected.plan,
      choice: selected.plan?.id ?? "none_match",
      targetId: selected.plan?.nodeId ?? "",
    });
    if (!selected.plan) return { kind: "fallback", reason: "action_plan_abstained" };
    const plan = selected.plan;
    const target = actionNodes(view).find((node) => node.id === plan.nodeId);
    const xpath = trimTrailingTextNode(view.xpathMap[plan.nodeId]);
    if (!target || !xpath) return { kind: "fallback", reason: "action_plan_missing_xpath" };
    const selector = `xpath=${xpath}`;
    const guard = await checkSelectedTarget(
      deps.page,
      selector,
      plan.nodeId,
      plan.method === "click",
      deps.progress,
    );
    if (guard.verdict !== "ok")
      return { kind: "fallback", reason: `action_plan_target_changed:${guard.verdict}` };
    const current = await deps.progress.run("revalidating action evidence", () =>
      deps.page.evaluate(readFacts, { [plan.nodeId]: view.xpathMap[plan.nodeId]! }),
    );
    if (
      !current[plan.nodeId] ||
      JSON.stringify(current[plan.nodeId]) !== JSON.stringify(facts[plan.nodeId])
    )
      return { kind: "fallback", reason: "action_plan_evidence_changed" };
    // AX labels and surrounding headings can change without changing the selected element's DOM facts.
    const refreshed = await deps.page.captureSnapshot(deps.snapshotOptions, deps.progress);
    const refreshedView = {
      ...view,
      formattedTree: refreshed.combinedTree,
      xpathMap: refreshed.combinedXpathMap,
      editableIds: refreshed.combinedEditableIds ?? [],
      facts: { ...facts, ...current },
    };
    const refreshedNodes = actionNodes(refreshedView);
    const refreshedTarget = refreshedNodes.find((node) => node.id === plan.nodeId);
    if (
      !refreshedTarget ||
      refreshed.combinedXpathMap[plan.nodeId] !== view.xpathMap[plan.nodeId] ||
      JSON.stringify(evidence(refreshedView, refreshedNodes, refreshedTarget, true)) !==
        JSON.stringify(plan.evidence)
    )
      return { kind: "fallback", reason: "action_plan_evidence_changed" };
    deps.progress.throwIfStopped();
    attempted = {
      selector,
      method: plan.method,
      arguments: plan.arguments,
      description: target.name ? `${target.role}: ${target.name}` : target.role,
    };
    const result = await deps.takeAction(attempted, plan.nodeId);
    // Input may already have taken effect. Never re-run the instruction after this point.
    if (!result.success) return { kind: "done", result, noCache: true };
    if (plan.method === "fill") {
      const locator = await resolveLocatorWithHops(
        deps.page,
        deps.page.mainFrame(),
        selector,
        deps.progress,
      );
      const actual = await locator.inputValue(deps.progress);
      const expected = substituteVariables(plan.arguments[0]!, deps.variables);
      trace.push({ node: "verify_readback", match: actual === expected });
      if (actual !== expected) return failure("fill_readback_mismatch", result.actions);
    }
    return { kind: "done", result };
  } catch (error) {
    deps.progress.throwIfStopped();
    const reason = (redactor(deps.variables) ?? ((text: string) => text))(
      error instanceof Error ? error.message : String(error),
    );
    return attempted
      ? failure(`Action may have taken effect; automatic retry stopped: ${reason}`, [attempted])
      : { kind: "fallback", reason: `decision_error:${reason}` };
  } finally {
    deps.logger.debug("Decisions act trace", {
      category: "decisions",
      trace: JSON.stringify(trace),
    });
  }
}
