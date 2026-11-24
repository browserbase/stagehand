import type { Action, ActResultData, Variables } from "@browserbasehq/stagehand-protocol/types";
import type { StagehandLogger } from "../../logger.js";
import type { Page } from "../../understudy/page.js";
import type { Progress } from "../../understudy/progress.js";
import { trimTrailingTextNode } from "../../utils.js";
import { actionNodes, buildPlans, choosePlan, evidence } from "./actionPlans.js";
import { verifyMenuOpened } from "./clickOwnerTarget.js";
import { recoverClickOwner } from "./clickOwner.js";
import { buildView } from "./tree.js";
import { namedHoverTarget } from "./hover.js";
import { actionContext } from "./actionContext.js";
import { readFacts } from "./actionFacts.js";
import { checkSelectedTarget } from "./actionTarget.js";
import { emailFill, redactor } from "./args.js";
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
    const planStarted = performance.now();
    const selected = await choosePlan(config, view, deps.instruction, {
      variables: deps.variables,
      threshold: ACTION_CONFIDENCE,
    });
    trace.push({
      node: "action_plan",
      ms: Math.round(performance.now() - planStarted),
      options: selected.plans.length,
      confidence: selected.confidence,
      accepted: !!selected.plan,
      choice: selected.plan?.id ?? "none_match",
      targetId: selected.plan?.nodeId ?? "",
    });
    if (!selected.plan) {
      const owner = await recoverClickOwner(config, deps, view, selected.plans);
      if (!owner) return { kind: "fallback", reason: "action_plan_abstained" };
      if (owner.changed) return failure("Selected click owner changed before dispatch");
      deps.progress.throwIfStopped();
      attempted = {
        selector: owner.selector,
        method: "click",
        arguments: [],
        description: owner.name,
      };
      const result = await deps.takeAction(attempted, owner.nodeId);
      if (
        result.success &&
        owner.menuId !== undefined &&
        !(await verifyMenuOpened(deps.page, owner.nodeId, owner.menuId, deps.progress))
      ) {
        return failure(
          "The click was dispatched, but the selected menu did not open.",
          result.actions,
        );
      }
      // A cached XPath cannot establish that the same listener still owns this click.
      return { kind: "done", result, noCache: true };
    }
    const plan = selected.plan;
    // A native listbox option can win a click even when the intended dropdown's
    // options were excluded. Let ordinary Act see all fields before dispatch.
    if (plan.method === "click" && facts[plan.nodeId]?.tag === "option")
      return { kind: "fallback", reason: "action_plan_native_option" };
    const nodes = actionNodes(view);
    const target = nodes.find((node) => node.id === plan.nodeId);
    const targetPath = view.xpathMap[plan.nodeId];
    const xpath = trimTrailingTextNode(targetPath);
    if (!target || !targetPath || !xpath)
      return { kind: "fallback", reason: "action_plan_missing_xpath" };
    const structural =
      plan.method !== "fill" ? actionContext(view, nodes, deps.instruction)?.(target) : undefined;
    const selector = `xpath=${xpath}`;
    const guard = await checkSelectedTarget(
      deps.page,
      selector,
      plan.nodeId,
      plan.method !== "fill",
      deps.progress,
    );
    if (guard.verdict !== "ok")
      return { kind: "fallback", reason: `action_plan_target_changed:${guard.verdict}` };
    const current = await deps.progress.run("revalidating action evidence", () =>
      deps.page.evaluate(readFacts, { [plan.nodeId]: targetPath }),
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
    if (
      plan.method === "fill" &&
      emailFill(deps.instruction) &&
      buildPlans(refreshedView, deps.instruction)[0]?.nodeId !== plan.nodeId
    )
      return { kind: "fallback", reason: "action_plan_evidence_changed" };
    const hover =
      plan.method === "hover" ? namedHoverTarget(deps.instruction, deps.variables) : undefined;
    if (hover && refreshedNodes.filter(hover).length !== 1)
      return { kind: "fallback", reason: "action_plan_evidence_changed" };
    if (plan.method === "hover" && !hover) {
      // A second element can become a valid match while the chosen element stays unchanged.
      const paths: Record<string, string> = {};
      const pointers = buildView(refreshedNodes, "pointer");
      const previousPointers = buildView(nodes, "pointer");
      if (
        pointers.length !== previousPointers.length ||
        pointers.some((node, i) => node.id !== previousPointers[i]!.id)
      )
        return { kind: "fallback", reason: "action_plan_evidence_changed" };
      for (const { id } of pointers) {
        const path = refreshedView.xpathMap[id];
        if (path !== view.xpathMap[id])
          return { kind: "fallback", reason: "action_plan_evidence_changed" };
        if (path) paths[id] = path;
      }
      const refreshedFacts = await deps.progress.run("revalidating hover candidates", () =>
        deps.page.evaluate(readFacts, paths),
      );
      if (
        Object.keys(paths).some(
          (id) => JSON.stringify(facts[id]) !== JSON.stringify(refreshedFacts[id]),
        )
      )
        return { kind: "fallback", reason: "action_plan_evidence_changed" };
      if (snapshot.combinedTree !== refreshed.combinedTree) {
        // With a truncated shortlist we cannot compare every competing plan.
        if (
          pointers.length > selected.plans.length ||
          JSON.stringify(
            buildPlans(refreshedView, deps.instruction, { variables: deps.variables }),
          ) !== JSON.stringify(selected.plans)
        )
          return { kind: "fallback", reason: "action_plan_evidence_changed" };
      }
    }
    const refreshedTarget = refreshedNodes.find((node) => node.id === plan.nodeId);
    if (structural) {
      const headingPaths: Record<string, string> = {};
      for (const { id, role } of refreshedNodes) {
        const path = refreshedView.xpathMap[id];
        if (role === "heading" && path) headingPaths[id] = path;
      }
      if (Object.keys(headingPaths).length) {
        const headingFacts = await deps.progress.run("revalidating action headings", () =>
          deps.page.evaluate(readFacts, headingPaths),
        );
        for (const id of Object.keys(headingPaths)) delete refreshedView.facts[id];
        Object.assign(refreshedView.facts, headingFacts);
      }
    }
    const refreshedContext =
      refreshedTarget && plan.method !== "fill"
        ? actionContext(refreshedView, refreshedNodes, deps.instruction)?.(refreshedTarget)
        : undefined;
    if (
      !refreshedTarget ||
      refreshedView.xpathMap[plan.nodeId] !== targetPath ||
      JSON.stringify(structural) !== JSON.stringify(refreshedContext) ||
      JSON.stringify(
        evidence(refreshedView, refreshedNodes, refreshedTarget, { context: refreshedContext }),
      ) !== JSON.stringify(plan.evidence)
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
