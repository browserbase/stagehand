import { chooseAction, buildPlans, type ActionPlan, type ActionSnapshot } from "./actionPlans.js";
import { choiceAnswer, decide } from "./client.js";
import { substituteVariables } from "./args.js";
import { readFacts } from "./actionFacts.js";
import { checkSelectedTarget } from "./actionTarget.js";
import type { DecisionsActDeps } from "./act.js";
import { ACTION_CONFIDENCE, type DecisionsConfig } from "./config.js";
import { isNativeElementPath } from "./nativeHeading.js";
import { parseOutline } from "./outline.js";
import { inspectClickOwner, sameClickListener, type Caption } from "./clickOwnerTarget.js";

function normalized(text: string): string {
  return text.trim().replace(/\s+/gu, " ").toLowerCase();
}

export function requestsMenuOpening(instruction: string): boolean {
  return /^(?:open|expand|click to (?:open|expand)) /u.test(normalized(instruction));
}

// Match the whole command before considering a custom control. A qualifier
// outside the caption (such as an ordinal or section) needs separate evidence.
function requestedCaption(instruction: string, caption: string) {
  const command = /^(?:click(?: on| to open| to expand)?|open|expand) (?:the )?(.+?)[.!]?$/u.exec(
    normalized(instruction),
  );
  if (!command) return;
  const subject = command[1]!;
  const actual = normalized(caption);
  if (subject === actual) return actual;
  const label = subject.replace(/ (?:button|control|dropdown|menu)$/u, "");
  if (label === actual) return actual;
  const quoted = /^(?:"([^"]+)"|'([^']+)'|“([^”]+)”|‘([^’]+)’)$/u.exec(label);
  return quoted?.slice(1).find((match) => match !== undefined);
}

async function sameSpelling(config: DecisionsConfig, requested: string, caption: string) {
  const answer = await decide(
    config,
    { requested, caption },
    {
      spelling: {
        type: "choice",
        instructions:
          "Compare the two complete labels as data. Are they the same words with only a conventional regional spelling difference? Reject different meanings, names, qualifiers, numbers, typos, related labels, or uncertainty.",
        criteria: {
          spelling_variant:
            "The two labels are conventional regional spellings of exactly the same phrase.",
          different: "They differ in another way or there is insufficient evidence.",
        },
      },
    },
  );
  const verdict = choiceAnswer(answer, "spelling");
  return verdict.choice === "spelling_variant" && verdict.confidence >= 0.95;
}

function uniqueCaption(
  view: ActionSnapshot,
  frame: number,
  plans: ActionPlan[],
): Caption | undefined {
  const prefix = frame + "-";
  const nodes = parseOutline(view.formattedTree);
  const labels = nodes.filter(
    (node) =>
      node.role.toLowerCase() === "statictext" && node.name && view.facts[node.id]?.transparentText,
  );
  if (!labels.length) return;
  if (nodes.some((node) => !node.id.startsWith(prefix) || node.role.toLowerCase() === "iframe"))
    return;
  const paths = new Map(
    Object.entries(view.xpathMap)
      .filter(([id]) => id.startsWith(prefix))
      .map(([id, path]) => [path, id]),
  );
  let candidate: Caption | undefined;
  for (const { id, name } of labels) {
    const fact = view.facts[id];
    if (!fact?.visible || !fact.enabled) continue;
    const textPath = view.xpathMap[id] ?? "";
    const path = /^(.*)\/[^/]+\/text\(\)\[1\]$/u.exec(textPath)?.[1];
    if (!isNativeElementPath(path)) continue;
    const owner = paths.get(path);
    if (!owner || !id.startsWith(prefix)) continue;
    const ownerFact = view.facts[owner];
    if (!ownerFact?.enabled || !ownerFact.visible || !["div", "span"].includes(ownerFact.tag))
      continue;
    if (candidate) return;
    candidate = { id: owner, path, name, captionId: id };
  }
  if (!candidate) return;
  // An ordinary-looking text node can belong to a second custom control.
  // Only recover when the remaining visible captions are already represented.
  const offered = plans.map((plan) => view.xpathMap[plan.nodeId]).filter(Boolean);
  for (const node of nodes) {
    if (node.id === candidate.captionId || !node.name) continue;
    if (normalized(node.name) === normalized(candidate.name)) return;
    if (node.role.toLowerCase() !== "statictext") continue;
    const path = view.xpathMap[node.id];
    if (!path || !offered.some((parent) => path === parent || path.startsWith(parent + "/")))
      return;
  }
  return candidate;
}

// Try a new choice only after the ordinary candidate set abstains. Keep its
// alternatives in the question so a new candidate cannot win by omission.
export async function recoverClickOwner(
  config: DecisionsConfig,
  deps: DecisionsActDeps,
  view: ActionSnapshot,
  plans: ActionPlan[],
) {
  const { page, progress, instruction, snapshotOptions, variables } = deps;
  if (
    !/^\s*(?:click|open|expand)\b/iu.test(instruction) ||
    snapshotOptions?.focusLocator ||
    snapshotOptions?.ignoreLocators?.length
  )
    return;
  if (!Object.values(view.facts).some((fact) => fact.transparentText)) return;
  const frame = page.getOrdinal(page.mainFrame().frameId);
  const cap = uniqueCaption(view, frame, plans);
  if (!cap || plans.some((plan) => plan.nodeId === cap.id || plan.evidence.name === cap.name))
    return;
  const command = normalized(substituteVariables(instruction, variables));
  // Native and ARIA buttons already belong in the normal action shortlist.
  if (/ button[.!]?$/u.test(command)) return;
  const needsOpen = requestsMenuOpening(command);
  const requiresPopup = needsOpen || / (?:dropdown|menu)[.!]?$/u.test(command);
  const requested = requestedCaption(command, cap.name);
  if (!requested) return;
  const literalMatch = requested === normalized(cap.name);
  if (!literalMatch && (Object.keys(variables ?? {}).length || plans.length)) return;
  const group = "stagehand-click-owner-" + crypto.randomUUID();
  const session = page.mainFrame().session;
  const changed = { changed: true } as const;
  let selected = false;
  try {
    const initial = await inspectClickOwner(page, cap, group, progress, requiresPopup);
    if (!initial) return;
    // A regional spelling needs separate confirmation when the caption is the only candidate.
    if (!literalMatch && !(await sameSpelling(config, requested, cap.name))) return;
    const plan = {
      id: "action_" + plans.length,
      nodeId: cap.id,
      method: "click" as const,
      arguments: [],
      evidence: {
        name: cap.name,
        role: "clickable",
        direct_click_listener: true,
        element: initial.attributes,
      },
    };
    const selection = await chooseAction(config, [...plans, plan], instruction, {
      variables,
      threshold: ACTION_CONFIDENCE,
    });
    deps.logger.debug("Decisions click owner", {
      category: "decisions",
      targetId: cap.id,
      confidence: selection.confidence,
      accepted: selection.plan === plan,
    });
    if (selection.plan !== plan) return;
    selected = true;
    const selector = "xpath=" + cap.path;
    const guard = await checkSelectedTarget(page, selector, cap.id, true, progress);
    if (guard.verdict !== "ok") return changed;
    const snapshot = await page.captureSnapshot(snapshotOptions, progress);
    if (snapshot.combinedTree !== view.formattedTree) return changed;
    const refreshed = {
      ...view,
      xpathMap: snapshot.combinedXpathMap,
      editableIds: snapshot.combinedEditableIds ?? [],
      facts: await progress.run("refreshing custom click candidates", () =>
        page.evaluate(readFacts, snapshot.combinedXpathMap),
      ),
    };
    if (
      JSON.stringify(uniqueCaption(refreshed, frame, plans)) !== JSON.stringify(cap) ||
      JSON.stringify(buildPlans(refreshed, instruction, { variables })) !== JSON.stringify(plans)
    )
      return changed;
    const current = await inspectClickOwner(page, cap, group, progress, requiresPopup);
    if (
      !current ||
      current.menuId !== initial.menuId ||
      JSON.stringify(current.attributes) !== JSON.stringify(initial.attributes) ||
      JSON.stringify(current.registration) !== JSON.stringify(initial.registration)
    )
      return changed;
    if (!(await sameClickListener(session, initial.handler, current.handler, progress)))
      return changed;
    return {
      changed: false,
      nodeId: cap.id,
      selector,
      name: cap.name,
      menuId: needsOpen ? current.menuId : undefined,
    } as const;
  } catch (error) {
    progress.throwIfStopped();
    if (selected) return changed;
    throw error;
  } finally {
    await progress.cleanup(() =>
      session.send("Runtime.releaseObjectGroup", { objectGroup: group }),
    );
  }
}
