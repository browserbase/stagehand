import { diffCombinedTrees } from "../../../understudy/a11y/snapshot/index.js";
import { quotedStrings } from "../args.js";
import { pickTarget, type Snapshot } from "../pick.js";
import { buildView, insideEditable, type OutlineNode, parseOutline } from "../tree.js";
import { fallback, focusIds } from "./outcomes.js";
import { describeLine, selectorFor, snapshot } from "./page.js";
import { act } from "./perform.js";
import type { DecisionsActDeps, Done, Fallback, PipelineContext } from "./types.js";

export const EDITABLE_ROLES = /\b(textbox|searchbox|combobox|spinbutton|textarea)\b/i;

const APPEAR_POLLS = 3;

const APPEAR_POLL_MS = 450;

const OPTION_LIKE = /\b(option|menuitem|menuitemradio|menuitemcheckbox|listitem|treeitem)\b/i;

export async function chooseFromAppeared(
  ctx: PipelineContext,
  before: Snapshot,
  triggerId: string,
  label: string,
  question: string,
  patience: "wait" | "once",
): Promise<Done | Fallback | { kind: "nothing_appeared" }> {
  const startedAt = Date.now();
  const waited = await waitForChoices(ctx.deps, patience === "wait");
  if (waited !== undefined) ctx.trace.push({ node: "await_choices", ms: waited });
  let after = await snapshot(ctx.deps);
  let filter = appearedFilter(before, after, triggerId);
  const ready = () =>
    buildView(after.nodes, "option").some((node) => filter(node) && OPTION_LIKE.test(node.role));
  for (let attempt = 0; patience === "wait" && attempt < APPEAR_POLLS && !ready(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, APPEAR_POLL_MS));
    after = await snapshot(ctx.deps);
    filter = appearedFilter(before, after, triggerId);
  }
  if (!hasAppeared(after, filter)) {
    ctx.trace.push({ node: `${label}_target`, ms: Date.now() - startedAt, options: 0 });
    return { kind: "nothing_appeared" };
  }

  const picked = await pickTarget(ctx, `${label}_target`, after, ["option", "broad"], question, {
    filter,
    quotedTargets: quotedStrings(ctx.instruction),
  });
  if (!picked.target)
    return fallback(`${label}_rejected:${picked.reason}`, undefined, focusIds(picked));
  const selector = selectorFor(after, picked.target);
  if (!selector) return fallback(`target_missing_xpath:${picked.target.id}`);
  return await act(
    ctx,
    { selector, description: describeLine(picked.target), method: "click", arguments: [] },
    { before: after, target: picked.target },
  );
}

const CHOICES_CAP_MS = 400;

async function waitForChoices(
  deps: DecisionsActDeps,
  expectChoices: boolean,
): Promise<number | undefined> {
  const startedAt = performance.now();
  try {
    await deps.page.mainFrame().evaluate(
      `new Promise((resolve) => {
          const cap = ${expectChoices ? CHOICES_CAP_MS : 50};
          const visible = () => [...document.querySelectorAll('[role="option"],[role="menuitem"],[role="menuitemradio"],[role="treeitem"],[role="listbox"] li,datalist option')]
            .some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; });
          let frames = 0, done = false;
          const finish = () => { if (!done) { done = true; resolve(true); } };
          const tick = () => { if (done) return; if (++frames >= 2 && (!${expectChoices} || visible())) finish(); else requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
          setTimeout(finish, cap);
        })`,
    );
    return Math.round(performance.now() - startedAt);
  } catch {
    return undefined;
  }
}

function appearedFilter(before: Snapshot, after: Snapshot, triggerId: string) {
  const appeared = new Set(
    parseOutline(diffCombinedTrees(before.tree, after.tree)).map((node) => node.id),
  );
  const trigger = before.nodes.find((node) => node.id === triggerId);
  return (node: OutlineNode) =>
    node.id !== triggerId &&
    appeared.has(node.id) &&
    !(EDITABLE_ROLES.test(node.role) && (!trigger || node.name === trigger.name)) &&
    !insideEditable(after.nodes, node);
}

function hasAppeared(after: Snapshot, filter: (node: OutlineNode) => boolean): boolean {
  return (
    buildView(after.nodes, "option").some(filter) || buildView(after.nodes, "broad").some(filter)
  );
}
